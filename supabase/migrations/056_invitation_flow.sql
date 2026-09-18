-- =============================================================================
-- Migration 056: Invitation flow
-- =============================================================================
-- Makes `staff_invitations` do the job it was created for in migration 001 and
-- has never once performed: getting a second person into an organization.
--
-- Design doc: docs/PLAN-staff-roles.md §6. Depends on migration 055.
--
-- THE CONSTRAINT THAT SHAPES ALL OF THIS  (migration 023, CRITICAL)
-- An RLS USING clause is evaluated per row against the SESSION, not against the
-- caller's WHERE. So "only if you supplied the secret" cannot be written as a
-- policy — a policy of `USING (accepted_at IS NULL)` plus a client-side
-- `.eq('token', t)` narrows the RESPONSE, not the GRANT, and hands every
-- pending invitation on the platform to anyone holding the publishable key.
-- That is exactly what migration 023 found and deleted.
--
-- The replacement, which 023 specified in its own comment and this migration
-- implements: look the invitation up inside a SECURITY DEFINER function, so the
-- token is a function ARGUMENT that must be known up front rather than a filter
-- applied after the grant.
--
-- NEVER re-add a public SELECT policy to staff_invitations.
--
-- Rollback: supabase/rollbacks/056_invitation_flow.sql
-- =============================================================================


-- =============================================================================
-- 1. INVITATION SCOPES
-- =============================================================================
-- An invitation has to carry the scope the person will land with. Without it,
-- every accepted invitation leaves a coordinator or aux staffer with zero
-- scopes — which under 055 §4 means zero access — and someone has to go and
-- fix it by hand. Mirrors membership_scopes exactly, including the exclusive
-- arc, so accept_invitation() is a straight copy.
-- =============================================================================

CREATE TABLE invitation_scopes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES staff_invitations(id) ON DELETE CASCADE,
  -- Denormalized for RLS, same reason as membership_scopes.
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  facility_id   UUID REFERENCES facilities(id)  ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invitation_scopes_exactly_one_target
    CHECK (num_nonnulls(department_id, facility_id) = 1),
  UNIQUE (invitation_id, department_id),
  UNIQUE (invitation_id, facility_id)
);

ALTER TABLE invitation_scopes ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_invitation_scopes_invitation ON invitation_scopes(invitation_id);

COMMENT ON TABLE invitation_scopes IS
  'The scope an invitation confers on acceptance, copied verbatim into '
  'membership_scopes by accept_invitation(). Deliberately NOT publicly '
  'readable: invitation_by_token() returns a count, never the rows, so the '
  'accept screen can say "2 departments" without naming an org''s internal '
  'structure to an unauthenticated caller.';


-- =============================================================================
-- 2. WHO MAY INVITE
-- =============================================================================
-- Migration 002's `invitations_admin_all` reads org_role(org_id) IN
-- ('owner','admin') — a role value that no longer exists after 055. Replace it.
--
-- Coordinators may invite AUX STAFF ONLY, and only into their own facilities.
-- The role restriction is enforced here; the scope restriction is enforced on
-- invitation_scopes below, because the two live on different tables and RLS
-- cannot see across them in one policy. Together they are sufficient: a
-- coordinator can create an aux invitation, but every scope row they attach
-- must be a facility they already hold, and an invitation with no scope rows
-- confers nothing (055 §4).
--
-- This is the thing that makes staff management scale past the owner. Hiring a
-- seasonal lifeguard must not be a ticket for the person who owns the billing.
-- =============================================================================

DROP POLICY IF EXISTS "invitations_admin_all" ON staff_invitations;

CREATE POLICY "invitations_managers_all" ON staff_invitations FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

CREATE POLICY "invitations_coordinator_read" ON staff_invitations FOR SELECT
  USING (public.org_role_is(org_id, ARRAY['coordinator']));

CREATE POLICY "invitations_coordinator_insert" ON staff_invitations FOR INSERT
  WITH CHECK (
    role = 'aux'
    AND public.org_role_is(org_id, ARRAY['coordinator'])
    AND invited_by = auth.uid()
  );

-- Revoking: a coordinator may withdraw an invitation they themselves sent, and
-- nobody else's.
CREATE POLICY "invitations_coordinator_delete" ON staff_invitations FOR DELETE
  USING (
    public.org_role_is(org_id, ARRAY['coordinator'])
    AND invited_by = auth.uid()
  );

-- invitation_scopes: managers anywhere in their org; coordinators only within
-- the facilities they already hold. The `facility_id = ANY(...)` test is what
-- stops a coordinator inviting an aux staffer into a building they have no
-- authority over, and it is why the role check above is not sufficient alone.
CREATE POLICY "invitation_scopes_read_own_org" ON invitation_scopes FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE POLICY "invitation_scopes_managers_write" ON invitation_scopes FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

CREATE POLICY "invitation_scopes_coordinator_write" ON invitation_scopes FOR ALL
  USING (
    public.org_role_is(org_id, ARRAY['coordinator'])
    AND facility_id = ANY(public.user_scope_facility_ids())
  )
  WITH CHECK (
    public.org_role_is(org_id, ARRAY['coordinator'])
    AND facility_id = ANY(public.user_scope_facility_ids())
  );

CREATE POLICY "invitation_scopes_superadmin_all" ON invitation_scopes FOR ALL
  USING (public.is_superadmin());


-- =============================================================================
-- 3. LOOKUP BY TOKEN
-- =============================================================================
-- Implemented as migration 023 prescribed. Note what it does NOT return: no
-- token, no email, no scope rows, no ids of anything internal. Only what the
-- accept screen renders.
--
-- `scope_count` exists so the screen can say "2 departments" without naming
-- them to an unauthenticated caller — enough for the invitee to tell a
-- correct invitation from a mistaken one, and nothing more.
--
-- This is a guessing oracle by nature. The token is 32 random bytes from
-- gen_random_bytes(), so guessing is not a practical attack, but
-- GET /api/invitations/[token] is rate-limited anyway because it costs nothing
-- to do so.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.invitation_by_token(p_token TEXT)
RETURNS TABLE (
  org_name    TEXT,
  org_logo_url TEXT,
  role        TEXT,
  email       TEXT,
  scope_count INTEGER,
  expires_at  TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    o.name,
    o.logo_url,
    i.role,
    -- The invited address is returned MASKED ("j••••@example.com"), not in
    -- full. The accept screen has to tell someone signed in as the wrong
    -- account which address the invitation is for, and a mask does that
    -- without turning a guessed token into a way to harvest staff addresses.
    regexp_replace(i.email, '^(.)[^@]*(@.*)$', '\1' || '••••' || '\2'),
    (SELECT COUNT(*)::INTEGER FROM invitation_scopes s WHERE s.invitation_id = i.id),
    i.expires_at
  FROM staff_invitations i
  JOIN organizations o ON o.id = i.org_id
  WHERE i.token       = p_token
    AND i.accepted_at IS NULL
    AND i.expires_at  > NOW();
$$;

REVOKE ALL ON FUNCTION public.invitation_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invitation_by_token(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.invitation_by_token(TEXT) IS
  'Accept-screen lookup. SECURITY DEFINER so the token is an ARGUMENT, not a '
  'row filter — see migration 023 for why a SELECT policy cannot express this. '
  'Returns no token, no scope rows and only a masked email. Never replace this '
  'with a public SELECT policy on staff_invitations.';


-- =============================================================================
-- 4. ACCEPT
-- =============================================================================
-- One function, one transaction. The failure modes of doing this in several
-- round trips are both bad and both silent:
--
--   membership created, scopes not  → signed in with zero access (recoverable)
--   token consumed, membership not  → locked out, NOT recoverable without
--                                     someone with database access
--
-- EMAIL RE-VALIDATION is not optional. The invitation was sent to an address;
-- the accepting session must own that address. Without this check, forwarding
-- the link — or an invite email landing in a shared inbox — hands anyone a
-- membership. auth.users is read here rather than auth.jwt()->>'email' because
-- the JWT's copy can be stale after an address change.
-- =============================================================================

-- The OUT parameters are named joined_* rather than org_id/role on purpose: a
-- RETURNS TABLE column shadows same-named table columns inside plpgsql, and
-- every unqualified `org_id` or `role` in the body below would then raise an
-- ambiguity error at runtime — on the accept path, where it is least welcome.
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token TEXT)
RETURNS TABLE (joined_org_id UUID, joined_role TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user       UUID := auth.uid();
  v_user_email TEXT;
  v_inv        staff_invitations%ROWTYPE;
  v_membership UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept an invitation'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.email INTO v_user_email FROM auth.users u WHERE u.id = v_user;

  -- FOR UPDATE: two clicks on the accept button, or a double-submitted form,
  -- would otherwise both pass the accepted_at check and race.
  SELECT * INTO v_inv
    FROM staff_invitations
   WHERE token = p_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invitation link is not valid' USING ERRCODE = '22023';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation has already been used' USING ERRCODE = '22023';
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'This invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF lower(v_user_email) IS DISTINCT FROM lower(v_inv.email) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address'
      USING ERRCODE = '42501';
  END IF;

  -- Already a member of this org: consume the token and report the membership
  -- they already have, rather than erroring. Someone clicking an old link
  -- twice should land in the app, not on a failure page.
  SELECT m.id INTO v_membership
    FROM org_memberships m
   WHERE m.org_id = v_inv.org_id AND m.user_id = v_user;

  IF v_membership IS NULL THEN
    INSERT INTO org_memberships (org_id, user_id, role, invited_by, email)
    VALUES (v_inv.org_id, v_user, v_inv.role, v_inv.invited_by, v_user_email)
    RETURNING id INTO v_membership;

    -- Scopes come across verbatim. An invitation with none produces a
    -- membership with none, which under 055 §4 can reach nothing — the invite
    -- UI is what prevents that being sent, not this function.
    INSERT INTO membership_scopes (membership_id, org_id, department_id, facility_id)
    SELECT v_membership, v_inv.org_id, s.department_id, s.facility_id
      FROM invitation_scopes s
     WHERE s.invitation_id = v_inv.id;
  END IF;

  UPDATE staff_invitations SET accepted_at = NOW() WHERE id = v_inv.id;

  RETURN QUERY SELECT v_inv.org_id, v_inv.role;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;


-- =============================================================================
-- 5. LEAVE AN ORGANIZATION
-- =============================================================================
-- 055 §7 blocks self-modification on org_memberships outright, which is what
-- stops self-promotion — but it also means nobody can resign. This is the
-- deliberate exception, kept separate from "a manager removed you" so the two
-- stay distinguishable in the UI and in the activity log.
--
-- The owner cannot leave. Transfer ownership first; an org with no owner has
-- nobody who can pay for it or delete it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.leave_organization(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
    FROM org_memberships
   WHERE org_id = p_org_id AND user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this organization' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'Transfer ownership before leaving this organization'
      USING ERRCODE = '42501';
  END IF;

  -- membership_scopes cascades on membership_id.
  DELETE FROM org_memberships WHERE org_id = p_org_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.leave_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_organization(UUID) TO authenticated;


-- =============================================================================
-- 6. A TRAP WORTH KNOWING BEFORE YOU BUILD THE ACCEPT SCREEN
-- =============================================================================
-- Nothing in the schema stops a user belonging to several organizations, and
-- accept_invitation() will happily add a second membership.
--
-- But the app has no org switcher. getOrgContext() (src/lib/auth/session.ts)
-- and getRouteMembership() (src/lib/auth/membership.ts) both resolve the
-- "active" org as `ORDER BY joined_at ASC LIMIT 1` — a rule those two files
-- document and deliberately share.
--
-- So someone who already owns an org and then accepts an invitation to another
-- one will keep landing in their FIRST org, with no indication the second
-- exists. Nothing is corrupted and nothing leaks; it just silently appears not
-- to have worked.
--
-- The accept screen must say so plainly when the invitee already has a
-- membership, rather than showing a success state that looks like a bug.
-- Building a real org switcher is the fix, and it is out of scope here.
-- =============================================================================


-- =============================================================================
-- 7. VERIFICATION
-- =============================================================================
-- Run after applying:
--
--   -- anon must get nothing from the table itself (regression guard on 023)
--   SET ROLE anon;
--   SELECT count(*) FROM staff_invitations;            -- expect 0
--   RESET ROLE;
--
--   -- the function is the only way in, and returns no secrets
--   SELECT * FROM public.invitation_by_token('nope');  -- expect 0 rows
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename IN ('staff_invitations','invitation_scopes')
--    ORDER BY tablename, policyname;
-- =============================================================================
