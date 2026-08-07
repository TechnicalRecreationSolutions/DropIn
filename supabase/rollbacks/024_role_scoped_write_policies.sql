-- =============================================================================
-- ROLLBACK for Migration 024
-- =============================================================================
-- ⚠️  Restores full CRUD for the `member` role on every structural table,
-- contradicting the role model documented in migration 001 and bypassable
-- straight from the browser with the publishable key.
--
-- Run this only if 024 broke a legitimate owner/admin workflow and you need
-- working software while you diagnose it. Re-apply 024 afterwards.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP POLICY IF EXISTS "facilities_managers_crud" ON facilities;
CREATE POLICY "facilities_members_crud" ON facilities FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "departments_managers_crud" ON departments;
CREATE POLICY "departments_members_crud" ON departments FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "schedule_groups_managers_crud" ON schedule_groups;
CREATE POLICY "schedule_groups_members_crud" ON schedule_groups FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "spaces_managers_crud" ON spaces;
CREATE POLICY "spaces_members_crud" ON spaces FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "facility_maps_managers_crud" ON facility_maps;
CREATE POLICY "facility_maps_members_crud" ON facility_maps FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "space_hotspots_managers_crud" ON space_hotspots;
CREATE POLICY "space_hotspots_members_crud" ON space_hotspots FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "map_context_elements_managers_crud" ON map_context_elements;
CREATE POLICY "map_context_elements_members_crud" ON map_context_elements FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "session_templates_managers_crud" ON session_templates;
DROP POLICY IF EXISTS "session_templates_members_read" ON session_templates;
CREATE POLICY "session_templates_members_crud" ON session_templates FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "session_template_spaces_managers_crud" ON session_template_spaces;
DROP POLICY IF EXISTS "session_template_spaces_members_read" ON session_template_spaces;
CREATE POLICY "session_template_spaces_members_crud" ON session_template_spaces FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

DROP POLICY IF EXISTS "widget_configs_managers_update" ON widget_configs;
DROP POLICY IF EXISTS "widget_configs_managers_insert" ON widget_configs;
CREATE POLICY "widget_configs_members_update" ON widget_configs FOR UPDATE
  USING (org_id = ANY(public.user_org_ids()));
CREATE POLICY "widget_configs_members_insert" ON widget_configs FOR INSERT
  WITH CHECK (org_id = ANY(public.user_org_ids()));

DROP FUNCTION IF EXISTS public.org_can_manage(UUID);
