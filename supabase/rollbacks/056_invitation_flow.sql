-- =============================================================================
-- ROLLBACK for Migration 056
-- =============================================================================
-- Removes the invitation flow. Existing memberships are untouched — anyone
-- already inside the org stays inside it. Only the ability to add someone new
-- goes away, which returns the product to where it was before 056: one account
-- per organization, plus whoever 056 already let in.
--
-- ⚠️  Do NOT "restore" migration 002's `invitations_public_read_by_token`
-- policy. It is the CRITICAL finding migration 023 deleted: it hands every
-- pending invitation on the platform, tokens included, to any holder of the
-- publishable key. It is not restored below and must not be added back.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP FUNCTION IF EXISTS public.accept_invitation(TEXT);
DROP FUNCTION IF EXISTS public.invitation_by_token(TEXT);
DROP FUNCTION IF EXISTS public.leave_organization(UUID);

DROP POLICY IF EXISTS "invitation_scopes_read_own_org"      ON invitation_scopes;
DROP POLICY IF EXISTS "invitation_scopes_managers_write"    ON invitation_scopes;
DROP POLICY IF EXISTS "invitation_scopes_coordinator_write" ON invitation_scopes;
DROP POLICY IF EXISTS "invitation_scopes_superadmin_all"    ON invitation_scopes;
DROP TABLE IF EXISTS invitation_scopes;

DROP POLICY IF EXISTS "invitations_managers_all"        ON staff_invitations;
DROP POLICY IF EXISTS "invitations_coordinator_read"    ON staff_invitations;
DROP POLICY IF EXISTS "invitations_coordinator_insert"  ON staff_invitations;
DROP POLICY IF EXISTS "invitations_coordinator_delete"  ON staff_invitations;

-- Migration 002's manager-side policy, rewritten for the role names migration
-- 055 introduced. If 055 has ALSO been rolled back, change 'manager' to
-- 'admin' here or this policy matches nobody.
CREATE POLICY "invitations_managers_all" ON staff_invitations FOR ALL
  USING (
    org_id = ANY(public.user_org_ids())
    AND public.org_role(org_id) IN ('owner', 'manager')
  );

-- Pending invitations are now unredeemable — there is no accept function left.
-- Clear them so nobody is left holding a link that silently does nothing.
DELETE FROM staff_invitations WHERE accepted_at IS NULL;
