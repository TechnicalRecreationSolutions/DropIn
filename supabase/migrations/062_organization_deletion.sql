-- =============================================================================
-- Migration 062: Deleting an organization
-- =============================================================================
-- `org:delete` has existed in src/lib/auth/roles.ts since migration 055 and
-- has never had a single call site, a policy or a route behind it. The Settings
-- section gives it one, so this migration supplies the control it was always
-- missing.
--
-- There is deliberately **no DELETE policy on organizations**. Row-level
-- security can express "you are the owner of this row" but not "and you typed
-- its name" or "and you are not still being billed for it", and the
-- publishable key is in the browser bundle — a policy alone would mean any
-- owner could wipe the organization with one PostgREST call and no
-- confirmation anywhere. So deletion goes through one SECURITY DEFINER
-- function that owns every precondition, exactly as `transfer_ownership()`
-- (055 §8) owns the ownership hand-off.
--
-- What the function guarantees:
--
--   1. The caller is the CURRENT OWNER of that organization. Not a manager —
--      `org:delete` is in the owner-only group with billing and ownership
--      transfer, because those are the three powers that can end an org.
--   2. The typed name matches. A speed bump, not a control, but the same one
--      used for ownership transfer and for the same shape of action.
--   3. No live subscription. Deleting the row drops `subscriptions` with it
--      (ON DELETE CASCADE) while Stripe keeps charging the card, and the
--      webhook that would have corrected it arrives to find no org. Cancelling
--      first is the only order that does not produce a bill for a product that
--      no longer exists.
--
-- Everything else is already handled: every table carrying `org_id` declares
-- `REFERENCES organizations(id) ON DELETE CASCADE` (verified across all 40 of
-- them), so one DELETE takes facilities, departments, schedule groups,
-- sessions, spaces, templates, maps, staff, invitations, notices, readings,
-- analytics and the activity log with it.
--
-- **Two things this does NOT delete**, both by necessity rather than choice:
--
--   - **Storage.** Logos and photos live in the `org-media` bucket under
--     `{orgId}/...` (migration 030) and Postgres FKs do not reach into it.
--     DELETE /api/organizations removes that prefix with the service-role
--     client immediately after this function returns. Storage is not
--     transactional with the database, so the order matters: the row goes
--     first, and an orphaned image is a wasted byte rather than a live public
--     URL for an organization that believes it is gone.
--   - **Auth users.** A person may belong to other organizations, and their
--     account is theirs, not the org's. They keep it and land on onboarding.
--
-- Rollback: supabase/rollbacks/062_organization_deletion.sql
-- Verified by: scripts/verify/verify-bc.mjs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_organization(
  p_org_id       UUID,
  p_confirm_name TEXT
) RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_name   TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  -- Read the name and prove the org exists in one go. No RLS applies inside a
  -- SECURITY DEFINER function, so the ownership check below is doing the whole
  -- job and must come before anything is acted on.
  SELECT name INTO v_name FROM organizations WHERE id = p_org_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = '42704';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
     WHERE org_id = p_org_id AND user_id = v_caller AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the owner can delete this organization'
      USING ERRCODE = '42501';
  END IF;

  -- btrim on both sides only. Case is NOT folded: "type the name exactly" is
  -- the whole point of the confirmation, and a case-insensitive compare makes
  -- it a formality.
  IF btrim(p_confirm_name) IS DISTINCT FROM btrim(v_name) THEN
    RAISE EXCEPTION 'The organization name does not match'
      USING ERRCODE = '22023';
  END IF;

  -- A subscription Stripe still considers live. 'canceled', 'incomplete_expired'
  -- and 'paused' are all terminal or unbilled and do not block.
  IF EXISTS (
    SELECT 1 FROM subscriptions
     WHERE org_id = p_org_id
       AND status IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete')
  ) THEN
    RAISE EXCEPTION 'Cancel the subscription in Billing before deleting the organization'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM organizations WHERE id = p_org_id;
END;
$fn$;

-- `authenticated` only. `anon` holding EXECUTE would mean the function's own
-- auth.uid() check is the only thing between a stranger and this call; there is
-- no reason for the grant to exist at all.
REVOKE ALL ON FUNCTION public.delete_organization(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_organization(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.delete_organization(UUID, TEXT) IS
  'Owner-only, name-confirmed, refuses while a live subscription exists. The only path that deletes an organization — there is no DELETE policy on the table.';
