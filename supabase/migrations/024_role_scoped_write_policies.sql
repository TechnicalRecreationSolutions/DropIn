-- =============================================================================
-- Migration 024: Role-scoped write policies (SECURITY — HIGH)
-- =============================================================================
-- Migration 001 documents the role model on org_memberships:
--
--   owner:  full control, set only at org creation (never via UI)
--   admin:  ...
--   member: read + schedule editing only
--
-- The RLS policies never implemented the last line. Every resource table
-- carried `FOR ALL USING (org_id = ANY(public.user_org_ids()))` with no role
-- predicate, so a `member` had full INSERT/UPDATE/DELETE on facilities,
-- departments, schedule groups, spaces, session templates, facility maps and
-- widget config.
--
-- The API routes do check `owner|admin` on all of those — but the publishable
-- key is in the browser bundle, so a member can skip the API and call PostgREST
-- directly. The control existed at one layer only; this migration adds the
-- second, which is where it is actually enforceable.
--
-- SHAPE OF THE FIX
-- Postgres RLS policies are permissive and OR'd together. Each structural table
-- already has a `*_public_read_*` policy whose predicate includes
-- `org_id = ANY(public.user_org_ids())`, so members keep SELECT through that
-- policy even after the FOR ALL policy is narrowed to owner/admin. Only
-- session_templates and session_template_spaces lacked such a policy, so they
-- get an explicit member-read policy below.
--
-- DELIBERATELY UNCHANGED: sessions, session_exceptions and session_spaces keep
-- `FOR ALL` for any member. That is the "schedule editing" the role model grants
-- members, and it matches the API — POST/PATCH /api/sessions check membership
-- but not role.
--
-- BEHAVIOUR CHANGE (the one user-visible consequence)
-- src/components/schedule-group/ScheduleGroupForm.tsx writes `schedule_groups`
-- directly from the browser rather than through an API route (see the note in
-- src/app/api/schedule-groups/route.ts). It is the only direct client write in
-- the app. After this migration a `member` using that form gets an RLS error
-- instead of a saved row. That is the intended outcome — creating a schedule
-- group is structural, not schedule editing — but it is a real UX change, and
-- the form surfaces it as a generic save failure rather than "you don't have
-- permission". Worth a follow-up if you ever have non-admin staff.
--
-- Rollback: supabase/rollbacks/024_role_scoped_write_policies.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: does the current user hold a managing role in this org?
-- -----------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.org_can_manage(UUID) IS
  'True when the current user is an owner or admin of the given org. Use for '
  'structural writes (facilities, departments, schedule groups, spaces, '
  'templates, maps, widget config). Schedule content is member-writable and '
  'should use user_org_ids() instead.';

-- -----------------------------------------------------------------------------
-- Structural tables: narrow FOR ALL to owner/admin.
-- Member SELECT survives via each table's existing *_public_read_* policy.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "facilities_members_crud" ON facilities;
CREATE POLICY "facilities_managers_crud" ON facilities FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "departments_members_crud" ON departments;
CREATE POLICY "departments_managers_crud" ON departments FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "schedule_groups_members_crud" ON schedule_groups;
CREATE POLICY "schedule_groups_managers_crud" ON schedule_groups FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "spaces_members_crud" ON spaces;
CREATE POLICY "spaces_managers_crud" ON spaces FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "facility_maps_members_crud" ON facility_maps;
CREATE POLICY "facility_maps_managers_crud" ON facility_maps FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "space_hotspots_members_crud" ON space_hotspots;
CREATE POLICY "space_hotspots_managers_crud" ON space_hotspots FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "map_context_elements_members_crud" ON map_context_elements;
CREATE POLICY "map_context_elements_managers_crud" ON map_context_elements FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

-- -----------------------------------------------------------------------------
-- session_templates / session_template_spaces had no read policy other than the
-- FOR ALL one being replaced, so members need an explicit SELECT policy or the
-- template rail goes blank for them.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "session_templates_members_crud" ON session_templates;
CREATE POLICY "session_templates_members_read" ON session_templates FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());
CREATE POLICY "session_templates_managers_crud" ON session_templates FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

DROP POLICY IF EXISTS "session_template_spaces_members_crud" ON session_template_spaces;
CREATE POLICY "session_template_spaces_members_read" ON session_template_spaces FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());
CREATE POLICY "session_template_spaces_managers_crud" ON session_template_spaces FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));

-- -----------------------------------------------------------------------------
-- widget_configs: writes are owner/admin per /api/widget-config. The overly
-- broad `widget_configs_public_read USING (TRUE)` policy is finding M1 and is
-- addressed separately — this migration only touches the write side.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "widget_configs_members_update" ON widget_configs;
DROP POLICY IF EXISTS "widget_configs_members_insert" ON widget_configs;
CREATE POLICY "widget_configs_managers_update" ON widget_configs FOR UPDATE
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));
CREATE POLICY "widget_configs_managers_insert" ON widget_configs FOR INSERT
  WITH CHECK (public.org_can_manage(org_id));
