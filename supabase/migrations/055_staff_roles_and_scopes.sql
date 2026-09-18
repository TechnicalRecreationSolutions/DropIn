-- =============================================================================
-- Migration 055: Staff roles and scopes
-- =============================================================================
-- Turns a one-account-per-organization product into a multi-account one.
--
-- Design doc: docs/PLAN-staff-roles.md. Read §4 before changing anything here.
--
-- THE ROLE LADDER
--   owner        the signup account. Billing, org deletion, ownership transfer.
--                Immune to removal or demotion by anyone else. Exactly one.
--   manager      org-wide operational authority. Everything except the four
--                owner-only powers above.
--   coordinator  scoped to one or more DEPARTMENTS. Total authority inside
--                them, nothing outside.
--   aux          scoped to one or more FACILITIES. Read-only: the internal
--                staff schedule and the public schedule. Writes nothing, ever.
--
-- `admin` and `member` are retired. Measured 2026-09-18, the database holds
-- 2 memberships and both are `owner` — there is not a single `admin` or
-- `member` row. The UPDATEs below are written anyway so this migration is
-- correct against any database, not just this one.
--
-- THE RULE EVERYTHING DEPENDS ON
--   An empty scope grants NOTHING. It never grants everything.
-- A coordinator with zero departments can write nothing; an aux with zero
-- facilities can see nothing. Every helper below returns FALSE on an empty
-- scope. "Empty means unrestricted" is how authorization systems fail open,
-- and it fails open silently — nobody reports seeing too much.
--
-- Rollback: supabase/rollbacks/055_staff_roles_and_scopes.sql
-- =============================================================================


-- =============================================================================
-- 1. ROLES
-- =============================================================================

ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_role_check;

UPDATE org_memberships SET role = 'manager'     WHERE role = 'admin';
UPDATE org_memberships SET role = 'coordinator' WHERE role = 'member';

ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_role_check
  CHECK (role IN ('owner', 'manager', 'coordinator', 'aux'));

-- An invitation can never mint an owner. Ownership moves by explicit transfer
-- only (see 8, below), never by emailing someone a link.
ALTER TABLE staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_check;

UPDATE staff_invitations SET role = 'manager'     WHERE role = 'admin';
UPDATE staff_invitations SET role = 'coordinator' WHERE role = 'member';

ALTER TABLE staff_invitations ADD CONSTRAINT staff_invitations_role_check
  CHECK (role IN ('manager', 'coordinator', 'aux'));

ALTER TABLE staff_invitations ALTER COLUMN role SET DEFAULT 'aux';


-- =============================================================================
-- 2. IDENTITY ON THE MEMBERSHIP ROW
-- =============================================================================
-- auth.users is not readable through RLS, so a staff list cannot join to it to
-- show who anyone is. Migration 038 already solved this for the activity log by
-- SNAPSHOTTING auth.users.email onto the row rather than joining live. Same
-- approach, same reasoning: the snapshot stays readable after the auth user is
-- deleted, which is exactly what a staff list needs in order to say "removed".
-- =============================================================================

ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS email        TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN org_memberships.email IS
  'Snapshot of auth.users.email at join time, NOT a live join — auth.users is '
  'unreadable under RLS. Written once by accept_invitation() (migration 056). '
  'Deliberately not kept in sync: this is who joined, not who they are now.';

-- Backfill the existing owners so the staff list is not blank on day one.
UPDATE org_memberships m
   SET email = u.email
  FROM auth.users u
 WHERE u.id = m.user_id
   AND m.email IS NULL;


-- =============================================================================
-- 3. SCOPES
-- =============================================================================
-- One table with an exclusive arc, rather than two tables or a polymorphic
-- (scope_type, scope_id) pair.
--
--   vs two tables: the staff UI reads "this person's scope" as one query, and a
--   future grain is a column here rather than a third table.
--
--   vs polymorphic: these are REAL foreign keys. Deleting a department cleans
--   up after itself and an orphaned scope row is impossible to create. A
--   polymorphic scope_id can reference nothing and no constraint can tell.
--
-- The two UNIQUE constraints coexist because Postgres treats NULLs as distinct
-- by default (NULLS DISTINCT), so the department constraint does not collide
-- with a membership's several facility rows. Do NOT add NULLS NOT DISTINCT to
-- either one — it would silently limit a person to a single scope.
-- =============================================================================

CREATE TABLE membership_scopes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES org_memberships(id) ON DELETE CASCADE,
  -- Denormalized so RLS can check org without joining back through membership.
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Exactly one of these is set. department_id scopes a coordinator;
  -- facility_id scopes aux staff.
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  facility_id   UUID REFERENCES facilities(id)  ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_scopes_exactly_one_target
    CHECK (num_nonnulls(department_id, facility_id) = 1),
  UNIQUE (membership_id, department_id),
  UNIQUE (membership_id, facility_id)
);

ALTER TABLE membership_scopes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE membership_scopes IS
  'What a coordinator or aux staffer can reach. EMPTY GRANTS NOTHING — see '
  'docs/PLAN-staff-roles.md §4. ON DELETE CASCADE on department_id means '
  'deleting a department silently strips it from every coordinator scoped to '
  'it; if it was their only one they drop to zero access. Correct, and '
  'invisible — the department delete UI must warn, and the staff list must '
  'flag any membership with zero scopes.';

CREATE INDEX idx_membership_scopes_membership ON membership_scopes(membership_id);
CREATE INDEX idx_membership_scopes_org        ON membership_scopes(org_id);
CREATE INDEX idx_membership_scopes_department ON membership_scopes(department_id)
  WHERE department_id IS NOT NULL;
CREATE INDEX idx_membership_scopes_facility   ON membership_scopes(facility_id)
  WHERE facility_id IS NOT NULL;


-- =============================================================================
-- 4. HELPER FUNCTIONS
-- =============================================================================
-- All STABLE SECURITY DEFINER with a pinned search_path, matching the existing
-- helpers from migrations 002 and 024.
--
-- STABLE matters for more than correctness here: Postgres may cache a STABLE
-- function's result within a statement per distinct argument, and these run
-- per row on session reads. A week of sessions belongs to a handful of
-- schedule groups, so the distinct-argument count stays small.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- org_can_manage() is REDEFINED, not replaced.
--
-- One CREATE OR REPLACE silently changes the effective policy on NINE tables:
-- facilities, departments, schedule_groups, spaces, facility_maps,
-- space_hotspots, map_context_elements, session_templates and widget_configs
-- (all from migration 024), plus schedule_week_reviews (037) and tags (050).
--
-- That leverage is exactly what migration 024 built it for. It is also why
-- verify-al.mjs must point at every one of those tables rather than a sample.
--
-- The change: 'admin' becomes 'manager'. Coordinators are deliberately NOT
-- included — structural writes (creating a facility, redrawing a floorplan,
-- rebranding the widget) are org-wide acts. The widget in particular is ONE
-- ROW PER ORG since migration 045, so a coordinator editing it would
-- rebrand every facility in the organization.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_can_manage(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
     WHERE user_id = auth.uid()
       AND org_id  = p_org_id
       AND role IN ('owner', 'manager')
  );
$$;

COMMENT ON FUNCTION public.org_can_manage(UUID) IS
  'True when the current user is an owner or MANAGER of the given org. Gates '
  'structural writes org-wide: facilities, departments, spaces, maps, '
  'templates, widget config, tags. Coordinators are excluded on purpose — '
  'their authority is department-scoped and runs through '
  'can_write_department(). Was owner|admin before migration 055.';


-- -----------------------------------------------------------------------------
-- The department ids a coordinator holds. Empty array for every other role —
-- owners and managers do not need scopes and must never be filtered by one.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_scope_department_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT s.department_id
        FROM membership_scopes s
        JOIN org_memberships m ON m.id = s.membership_id
       WHERE m.user_id = auth.uid()
         AND s.department_id IS NOT NULL
    ),
    '{}'::UUID[]
  );
$$;


-- -----------------------------------------------------------------------------
-- The facility ids the caller can see.
--
-- For aux staff this is their explicit facility scopes. For a coordinator it is
-- DERIVED from the facilities containing their departments — nobody maintains
-- two lists, and the two can never drift apart. The union covers a membership
-- that somehow holds both grains.
--
-- Owners and managers get an empty array, which callers must read as "not
-- scoped" rather than "sees nothing". That asymmetry is confined to
-- can_read_facility() below, which checks org_can_manage() FIRST — no other
-- caller should interpret this array on its own.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_scope_facility_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT s.facility_id
        FROM membership_scopes s
        JOIN org_memberships m ON m.id = s.membership_id
       WHERE m.user_id = auth.uid()
         AND s.facility_id IS NOT NULL
      UNION
      SELECT d.facility_id
        FROM membership_scopes s
        JOIN org_memberships m ON m.id = s.membership_id
        JOIN departments d     ON d.id = s.department_id
       WHERE m.user_id = auth.uid()
         AND s.department_id IS NOT NULL
    ),
    '{}'::UUID[]
  );
$$;


-- -----------------------------------------------------------------------------
-- Write authority over one department's contents.
--
-- Owner/manager anywhere in the org, or a coordinator holding this exact
-- department. A coordinator with no scopes matches nothing and gets FALSE —
-- the fail-closed default from §4, expressed as ordinary set membership rather
-- than as a special case anyone could forget to write.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_department(p_department_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT p_department_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM departments d
         WHERE d.id = p_department_id
           AND public.org_can_manage(d.org_id)
      )
      OR p_department_id = ANY(public.user_scope_department_ids())
    );
$$;

COMMENT ON FUNCTION public.can_write_department(UUID) IS
  'Write authority over a department''s contents: owner/manager of its org, or '
  'a coordinator scoped to it. NULL returns FALSE — a department-less row is '
  'owner/manager territory, reached through org_can_manage() instead.';


-- -----------------------------------------------------------------------------
-- The same question, asked about a schedule group.
--
-- schedule_groups.department_id is NULLABLE — migration 011 made it so on
-- purpose and that is still correct. `Pickleball Open Play` has no department
-- today. Such a group resolves to can_write_department(NULL) = FALSE for a
-- coordinator, so it stays owner/manager-only.
--
-- That is the right default and the wrong experience: the schedule is simply
-- absent with no explanation. docs/PLAN-staff-roles.md §7 covers the UI that
-- has to ship alongside it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_write_schedule_group(p_schedule_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM schedule_groups sg
     WHERE sg.id = p_schedule_group_id
       AND (
         public.org_can_manage(sg.org_id)
         OR public.can_write_department(sg.department_id)
       )
  );
$$;


-- -----------------------------------------------------------------------------
-- Read authority over a facility's internal data.
--
-- org_can_manage() is checked FIRST so an owner/manager never falls through to
-- the scope array, which is empty for them (see user_scope_facility_ids()).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_facility(p_facility_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM facilities f
     WHERE f.id = p_facility_id
       AND public.org_can_manage(f.org_id)
  )
  OR p_facility_id = ANY(public.user_scope_facility_ids());
$$;


-- -----------------------------------------------------------------------------
-- Generic role test, so policies stop hand-rolling `org_role(x) IN (...)`.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_role_is(p_org_id UUID, p_roles TEXT[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
     WHERE user_id = auth.uid()
       AND org_id  = p_org_id
       AND role    = ANY(p_roles)
  );
$$;


-- =============================================================================
-- 5. THE HOLE THIS CLOSES  (the reason this migration is SECURITY work)
-- =============================================================================
-- Migration 024 deliberately left sessions, session_exceptions and
-- session_spaces as `FOR ALL USING (org_id = ANY(user_org_ids()))`, because at
-- the time "any member may edit the schedule" was the intended model. It said
-- so explicitly, and it was right.
--
-- Under the new model that same policy is a privilege escalation. An aux
-- staffer IS a member. The publishable key is in the browser bundle. Without
-- the change below, a lifeguard could DELETE every session in the organization
-- through PostgREST without ever loading the dashboard.
--
-- Reads of plain `sessions` deliberately stay at org_id = ANY(user_org_ids()):
-- that is the hot path for every schedule render, and it is internal scheduling
-- data for an org the reader works at. Facility narrowing for aux staff is a
-- presentation concern, applied in /api/sessions/expand.
--
-- session_internal is the exception and IS narrowed in RLS — holder_name is a
-- rental customer's name, the only genuinely sensitive field in the schema.
-- =============================================================================

-- sessions ---------------------------------------------------------------------
DROP POLICY IF EXISTS "sessions_members_crud" ON sessions;

CREATE POLICY "sessions_scoped_write" ON sessions FOR ALL
  USING (public.can_write_schedule_group(schedule_group_id))
  WITH CHECK (public.can_write_schedule_group(schedule_group_id));

-- The SELECT side (sessions_public_read_active, last rewritten by 046) already
-- grants org members read via `org_id = ANY(public.user_org_ids())`, so
-- narrowing the FOR ALL policy above does not blind anyone. Verified in
-- verify-al.mjs rather than assumed.

-- session_exceptions -----------------------------------------------------------
DROP POLICY IF EXISTS "exceptions_members_crud" ON session_exceptions;

CREATE POLICY "session_exceptions_scoped_write" ON session_exceptions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = session_exceptions.session_id
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = session_exceptions.session_id
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  );

-- session_spaces ---------------------------------------------------------------
DROP POLICY IF EXISTS "session_spaces_members_crud" ON session_spaces;

CREATE POLICY "session_spaces_scoped_write" ON session_spaces FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = session_spaces.session_id
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = session_spaces.session_id
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  );

-- NOT session_features: that table was dropped outright by migration 036
-- (the events/brochure teardown). Do not add it back here.

-- session_internal -------------------------------------------------------------
-- Both sides narrow. The SELECT side is the point: holder_name is a rental
-- customer's name ("Island Swimming", "Lane rental — J. Okafor"), and an aux
-- staffer at one building has no business reading another building's.
DROP POLICY IF EXISTS "session_internal_members_crud" ON session_internal;

CREATE POLICY "session_internal_scoped_read" ON session_internal FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
        JOIN schedule_groups sg ON sg.id = s.schedule_group_id
       WHERE s.id = session_internal.session_id
         AND public.can_read_facility(sg.facility_id)
    )
  );

CREATE POLICY "session_internal_scoped_write" ON session_internal FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = session_internal.session_id
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = session_internal.session_id
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  );

-- schedule_week_reviews --------------------------------------------------------
-- Was org_can_manage() (migration 037), which after this migration means
-- owner|manager and would lock coordinators out of approving their own weeks.
DROP POLICY IF EXISTS "schedule_week_reviews_managers_write" ON schedule_week_reviews;

CREATE POLICY "schedule_week_reviews_scoped_write" ON schedule_week_reviews FOR ALL
  USING (public.can_write_schedule_group(schedule_group_id))
  WITH CHECK (public.can_write_schedule_group(schedule_group_id));

-- session_conflict_dismissals --------------------------------------------------
-- Keyed by a PAIR of sessions. Authority over either one is enough: a conflict
-- that straddles two departments has to be dismissable by someone, and
-- requiring both would make a cross-department conflict permanently stuck.
DROP POLICY IF EXISTS "session_conflict_dismissals_members_crud" ON session_conflict_dismissals;

CREATE POLICY "session_conflict_dismissals_scoped_write" ON session_conflict_dismissals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id IN (session_conflict_dismissals.session_a_id,
                      session_conflict_dismissals.session_b_id)
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id IN (session_conflict_dismissals.session_a_id,
                      session_conflict_dismissals.session_b_id)
         AND public.can_write_schedule_group(s.schedule_group_id)
    )
  );

CREATE POLICY "session_conflict_dismissals_members_read"
  ON session_conflict_dismissals FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());


-- =============================================================================
-- 6. COORDINATOR WRITE PATHS
-- =============================================================================
-- Section 4 narrowed org_can_manage() to owner|manager, which by itself locks
-- coordinators out of the three tables they must be able to write. Each gets a
-- second, department-scoped policy alongside the manager one. RLS policies are
-- permissive and OR'd, so this widens rather than replaces.
-- =============================================================================

-- schedule_groups: a coordinator owns the schedules in their departments,
-- including creating, publishing and deleting them.
--
-- Migration 024 warned that ScheduleGroupForm.tsx wrote this table DIRECTLY
-- from the browser, and would therefore surface an RLS refusal as a generic
-- save failure. **That is no longer true** — checked 2026-09-18: the form
-- posts to /api/schedule-groups, `createClient` from lib/supabase/client
-- survives in only LoginForm and SidebarProfile, and there is no direct client
-- write to any resource table left in the app. So a coordinator refused here
-- gets the route's own explanation, not a shrug. 024's warning was accurate
-- when written and has simply been overtaken.
CREATE POLICY "schedule_groups_coordinator_crud" ON schedule_groups FOR ALL
  USING (public.can_write_department(department_id))
  WITH CHECK (public.can_write_department(department_id));

-- spaces: a coordinator manages the spaces belonging to their departments.
-- spaces.department_id is nullable (migration 012) and 11 of 23 rows are NULL
-- today — those stay owner/manager-only, per §7 of the design doc.
CREATE POLICY "spaces_coordinator_crud" ON spaces FOR ALL
  USING (public.can_write_department(department_id))
  WITH CHECK (public.can_write_department(department_id));

-- session_templates: same, and same NULL caveat (migration 042).
CREATE POLICY "session_templates_coordinator_crud" ON session_templates FOR ALL
  USING (public.can_write_department(department_id))
  WITH CHECK (public.can_write_department(department_id));

CREATE POLICY "session_template_spaces_coordinator_crud" ON session_template_spaces FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM session_templates t
       WHERE t.id = session_template_spaces.session_template_id
         AND public.can_write_department(t.department_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM session_templates t
       WHERE t.id = session_template_spaces.session_template_id
         AND public.can_write_department(t.department_id)
    )
  );

-- departments: a coordinator may rename and describe their own department,
-- but NOT create or delete one. UPDATE only, and the WITH CHECK stops them
-- reassigning it to a facility they do not hold.
CREATE POLICY "departments_coordinator_update" ON departments FOR UPDATE
  USING (public.can_write_department(id))
  WITH CHECK (public.can_write_department(id));


-- =============================================================================
-- 7. MEMBERSHIP POLICIES — three bugs that have never been exercised
-- =============================================================================
-- Migration 002's membership policies were written for an invite flow that
-- never shipped. Nothing has ever inserted, updated or deleted one of these
-- rows through RLS, so none of the three has ever been hit in production.
-- They all become reachable the moment /dashboard/staff exists.
--
--   1. There is NO UPDATE policy at all, so changing a role is impossible
--      except by delete-and-reinsert (which loses joined_at and the scopes).
--   2. memberships_admin_delete lets a manager delete the OWNER — under the
--      new names, a takeover.
--   3. Nothing prevents self-modification: a manager could promote themselves,
--      or a coordinator widen their own scope.
-- =============================================================================

DROP POLICY IF EXISTS "memberships_admin_write"  ON org_memberships;
DROP POLICY IF EXISTS "memberships_admin_delete" ON org_memberships;

-- INSERT: owner/manager only, never creating an owner. In practice
-- accept_invitation() (migration 056) is the only writer — it is SECURITY
-- DEFINER and bypasses this — but the policy is the backstop for anything that
-- reaches PostgREST directly.
CREATE POLICY "memberships_managers_insert" ON org_memberships FOR INSERT
  WITH CHECK (
    public.org_can_manage(org_id)
    AND role <> 'owner'
  );

-- UPDATE: new, and the reason role changes are possible at all.
--   - only owner/manager may do it
--   - the OWNER row is untouchable (transfer_ownership() handles that, and it
--     is SECURITY DEFINER so it is not bound by this)
--   - nobody may edit their OWN row, at any level: that is self-promotion
--   - the new role may not be 'owner': no sideways route to ownership
CREATE POLICY "memberships_managers_update" ON org_memberships FOR UPDATE
  USING (
    public.org_can_manage(org_id)
    AND role    <> 'owner'
    AND user_id <> auth.uid()
  )
  WITH CHECK (
    public.org_can_manage(org_id)
    AND role    <> 'owner'
    AND user_id <> auth.uid()
  );

-- DELETE: same protections. Leaving voluntarily is a separate, explicit path
-- (POST /api/staff/members/leave), not this policy — so that "remove someone"
-- and "resign" stay distinguishable in the activity log and in the UI.
CREATE POLICY "memberships_managers_delete" ON org_memberships FOR DELETE
  USING (
    public.org_can_manage(org_id)
    AND role    <> 'owner'
    AND user_id <> auth.uid()
  );

-- membership_scopes: readable inside the org, writable only by owner/manager,
-- and NEVER by the person being scoped — otherwise a coordinator could grant
-- themselves every department and scoping would mean nothing.
CREATE POLICY "membership_scopes_read_own_org" ON membership_scopes FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE POLICY "membership_scopes_managers_write" ON membership_scopes FOR ALL
  USING (
    public.org_can_manage(org_id)
    AND EXISTS (
      SELECT 1 FROM org_memberships m
       WHERE m.id = membership_scopes.membership_id
         AND m.user_id <> auth.uid()
    )
  )
  WITH CHECK (
    public.org_can_manage(org_id)
    AND EXISTS (
      SELECT 1 FROM org_memberships m
       WHERE m.id = membership_scopes.membership_id
         AND m.user_id <> auth.uid()
    )
  );

CREATE POLICY "membership_scopes_superadmin_all" ON membership_scopes FOR ALL
  USING (public.is_superadmin());


-- =============================================================================
-- 8. OWNERSHIP TRANSFER
-- =============================================================================
-- The only way an owner row changes hands. SECURITY DEFINER because §7's
-- policies make the owner row untouchable by design — this function is the
-- deliberate exception, and it is the whole reason those policies can be
-- absolute rather than full of carve-outs.
--
-- Demote-then-promote in ONE statement: there is never zero owners and never
-- two, even if the connection dies mid-call.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.transfer_ownership(
  p_org_id       UUID,
  p_new_owner_id UUID
) RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
     WHERE org_id = p_org_id AND user_id = v_caller AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the current owner can transfer ownership';
  END IF;

  IF p_new_owner_id = v_caller THEN
    RAISE EXCEPTION 'You already own this organization';
  END IF;

  -- The recipient must already be a member. Transferring to a stranger would
  -- mean minting a membership and handing over an org in one unreviewable step.
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
     WHERE org_id = p_org_id AND user_id = p_new_owner_id
  ) THEN
    RAISE EXCEPTION 'The new owner must already be a member of this organization';
  END IF;

  UPDATE org_memberships
     SET role = CASE
                  WHEN user_id = v_caller       THEN 'manager'
                  WHEN user_id = p_new_owner_id THEN 'owner'
                END
   WHERE org_id = p_org_id
     AND user_id IN (v_caller, p_new_owner_id);

  -- The outgoing owner keeps no scopes: they are a manager now, and a manager
  -- is org-wide. A stale coordinator scope would be dead weight that the staff
  -- list would render as a contradiction.
  DELETE FROM membership_scopes s
   USING org_memberships m
   WHERE s.membership_id = m.id
     AND m.org_id = p_org_id
     AND m.user_id = v_caller;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_ownership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_ownership(UUID, UUID) TO authenticated;


-- =============================================================================
-- 9. VERIFICATION
-- =============================================================================
-- Run after applying. Expect: roles constraint lists 4 values, membership_scopes
-- exists and is empty, org_can_manage mentions 'manager', and both existing
-- owners have an email snapshot.
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'org_memberships_role_check';
--
--   SELECT role, email IS NOT NULL AS has_email, count(*)
--     FROM org_memberships GROUP BY 1, 2;
--
--   SELECT prosrc LIKE '%manager%' AS redefined
--     FROM pg_proc WHERE proname = 'org_can_manage';
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('sessions','session_internal','session_spaces',
--                        'session_exceptions',
--                        'schedule_week_reviews','session_conflict_dismissals',
--                        'org_memberships','membership_scopes')
--    ORDER BY tablename, policyname;
-- =============================================================================
