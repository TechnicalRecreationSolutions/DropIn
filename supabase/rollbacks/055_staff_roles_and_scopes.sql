-- =============================================================================
-- ROLLBACK for Migration 055
-- =============================================================================
-- ⚠️  Returns the org to a single-tier staff model and REOPENS the hole that
-- 055 §5 closed: every org member regains full write on sessions,
-- session_spaces, session_exceptions and session_internal, straight from the
-- browser with the publishable key. If any `aux` or `coordinator` membership
-- exists when you run this, that person becomes able to delete the entire
-- organization's schedule.
--
-- So: remove or demote every non-owner membership FIRST.
--
--   SELECT id, email, role FROM org_memberships WHERE role <> 'owner';
--
-- Run this only if 055 broke a legitimate owner workflow and you need working
-- software while you diagnose it. Re-apply 055 afterwards.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Coordinator write paths (055 §6) — remove before the roles they depend on.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "schedule_groups_coordinator_crud"        ON schedule_groups;
DROP POLICY IF EXISTS "spaces_coordinator_crud"                 ON spaces;
DROP POLICY IF EXISTS "session_templates_coordinator_crud"      ON session_templates;
DROP POLICY IF EXISTS "session_template_spaces_coordinator_crud" ON session_template_spaces;
DROP POLICY IF EXISTS "departments_coordinator_update"          ON departments;

-- -----------------------------------------------------------------------------
-- 2. Schedule-content policies — back to "any member may edit the schedule".
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "sessions_scoped_write" ON sessions;
CREATE POLICY "sessions_members_crud" ON sessions FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "session_exceptions_scoped_write" ON session_exceptions;
CREATE POLICY "exceptions_members_crud" ON session_exceptions FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "session_spaces_scoped_write" ON session_spaces;
CREATE POLICY "session_spaces_members_crud" ON session_spaces FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "session_internal_scoped_read"  ON session_internal;
DROP POLICY IF EXISTS "session_internal_scoped_write" ON session_internal;
CREATE POLICY "session_internal_members_crud" ON session_internal FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "schedule_week_reviews_scoped_write" ON schedule_week_reviews;
CREATE POLICY "schedule_week_reviews_managers_write" ON schedule_week_reviews FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "session_conflict_dismissals_scoped_write" ON session_conflict_dismissals;
DROP POLICY IF EXISTS "session_conflict_dismissals_members_read" ON session_conflict_dismissals;
CREATE POLICY "session_conflict_dismissals_members_crud" ON session_conflict_dismissals FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

-- -----------------------------------------------------------------------------
-- 3. Membership policies — back to migration 002's (including its three bugs:
--    no UPDATE policy, a manager may delete the owner, and self-modification
--    is unguarded. That is what "rollback" means here.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "memberships_managers_insert" ON org_memberships;
DROP POLICY IF EXISTS "memberships_managers_update" ON org_memberships;
DROP POLICY IF EXISTS "memberships_managers_delete" ON org_memberships;

CREATE POLICY "memberships_admin_write" ON org_memberships FOR INSERT
  WITH CHECK (
    org_id = ANY(public.user_org_ids())
    AND public.org_role(org_id) IN ('owner', 'admin')
    AND role != 'owner'
  );

CREATE POLICY "memberships_admin_delete" ON org_memberships FOR DELETE
  USING (
    org_id = ANY(public.user_org_ids())
    AND public.org_role(org_id) IN ('owner', 'admin')
  );

-- -----------------------------------------------------------------------------
-- 4. Ownership transfer and the scope table.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.transfer_ownership(UUID, UUID);

DROP POLICY IF EXISTS "membership_scopes_read_own_org"     ON membership_scopes;
DROP POLICY IF EXISTS "membership_scopes_managers_write"   ON membership_scopes;
DROP POLICY IF EXISTS "membership_scopes_superadmin_all"   ON membership_scopes;
DROP TABLE IF EXISTS membership_scopes;

-- -----------------------------------------------------------------------------
-- 5. Helper functions. org_can_manage() is RESTORED to owner|admin, which is
--    what the nine tables from migration 024 read.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.can_write_schedule_group(UUID);
DROP FUNCTION IF EXISTS public.can_write_department(UUID);
DROP FUNCTION IF EXISTS public.can_read_facility(UUID);
DROP FUNCTION IF EXISTS public.user_scope_department_ids();
DROP FUNCTION IF EXISTS public.user_scope_facility_ids();
DROP FUNCTION IF EXISTS public.org_role_is(UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.org_can_manage(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
     WHERE user_id = auth.uid()
       AND org_id  = p_org_id
       AND role IN ('owner', 'admin')
  );
$$;

-- -----------------------------------------------------------------------------
-- 6. Roles. Anything still holding a 055-only role is mapped back; `aux` has no
--    pre-055 equivalent and becomes `member`, which is MORE authority than it
--    had. Deleting those memberships instead is the safer choice — see the
--    warning at the top.
-- -----------------------------------------------------------------------------
ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_role_check;

UPDATE org_memberships SET role = 'admin'  WHERE role = 'manager';
UPDATE org_memberships SET role = 'member' WHERE role IN ('coordinator', 'aux');

ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

ALTER TABLE staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_check;

UPDATE staff_invitations SET role = 'admin'  WHERE role = 'manager';
UPDATE staff_invitations SET role = 'member' WHERE role IN ('coordinator', 'aux');

ALTER TABLE staff_invitations ADD CONSTRAINT staff_invitations_role_check
  CHECK (role IN ('admin', 'member'));

ALTER TABLE staff_invitations ALTER COLUMN role SET DEFAULT 'member';

-- The email/display_name snapshot columns are left in place deliberately:
-- dropping them destroys the only record of who joined, and they are inert.
