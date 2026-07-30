-- =============================================================================
-- Migration 008: Widget schedule template + missing widget_configs INSERT policy
-- =============================================================================
-- widget_configs previously had no INSERT policy, so no org could ever create
-- its first config row as a normal member (only UPDATE was granted). This adds
-- the missing policy and a `template` column selecting which visual layout
-- (grid/list/map) the org's widget and public schedule page render.
-- =============================================================================

ALTER TABLE widget_configs
  ADD COLUMN template TEXT NOT NULL DEFAULT 'grid'
    CHECK (template IN ('grid', 'list', 'map'));

CREATE POLICY "widget_configs_members_insert"
  ON widget_configs FOR INSERT
  WITH CHECK (org_id = ANY(public.user_org_ids()));
