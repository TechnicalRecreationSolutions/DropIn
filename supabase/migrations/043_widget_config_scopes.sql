-- =============================================================================
-- Migration 043: Widget config scopes (multi-schedule filter widget)
-- =============================================================================
-- A widget_configs row has always been locked to exactly one (facility,
-- department) scope — one embed, one schedule. Some orgs run several
-- facilities/departments/schedules and want ONE embed where the visitor picks
-- which schedule to view (a facility/department/schedule filter inside the
-- widget itself) instead of maintaining a separate <script> snippet per scope.
--
-- widget_config_scopes adds an ordered, optional list of named filter entries
-- to a widget_configs row. Each entry points at a facility (required) and
-- optionally narrows to a department and/or a specific schedule_group within
-- it — the same three levels the dashboard's schedule command centre already
-- uses. An empty list (the default — no rows) means "no filter UI", so every
-- existing embed keeps behaving exactly as it does today.
--
-- Mirrors the widget_configs public-read split from migration 026: staff see
-- their own org's scopes regardless of publish state (the editor needs to
-- offer draft facilities/departments/schedules while building the list), the
-- public embed only ever sees scopes whose entire chain is published — same
-- reasoning as M1 there, applied here so this table can't become a second
-- index of unreleased facility/department/schedule ids.
-- =============================================================================

CREATE TABLE widget_config_scopes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_config_id  UUID NOT NULL REFERENCES widget_configs(id) ON DELETE CASCADE,
  -- Denormalized for RLS (org_can_manage(org_id)) and to avoid a join through
  -- widget_configs on every policy check, matching space_hotspots (016) and
  -- map_context_elements (019).
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label             TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  facility_id       UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  department_id     UUID REFERENCES departments(id) ON DELETE CASCADE,
  schedule_group_id UUID REFERENCES schedule_groups(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Same entry twice (same facility/department/schedule combo) in one
  -- widget's filter list is a config mistake, not a valid "two tabs that
  -- show the same thing" case — NULLS NOT DISTINCT so two entries that both
  -- leave department/schedule unset still collide.
  UNIQUE NULLS NOT DISTINCT (widget_config_id, facility_id, department_id, schedule_group_id)
);

CREATE INDEX idx_widget_config_scopes_widget_config_id ON widget_config_scopes (widget_config_id);
CREATE INDEX idx_widget_config_scopes_org_id ON widget_config_scopes (org_id);

ALTER TABLE widget_config_scopes ENABLE ROW LEVEL SECURITY;

-- Staff: their own org's scopes, any publish state (the configurator UI).
CREATE POLICY "widget_config_scopes_members_read"
  ON widget_config_scopes FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Public: only once every level in the chain is actually published.
CREATE POLICY "widget_config_scopes_public_read_published"
  ON widget_config_scopes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM facilities f
      WHERE f.id = widget_config_scopes.facility_id AND f.is_published = TRUE
    )
    AND (
      department_id IS NULL
      OR EXISTS (
        SELECT 1 FROM departments d
        WHERE d.id = widget_config_scopes.department_id AND d.is_published = TRUE
      )
    )
    AND (
      schedule_group_id IS NULL
      OR EXISTS (
        SELECT 1 FROM schedule_groups sg
        WHERE sg.id = widget_config_scopes.schedule_group_id AND sg.status = 'published'
      )
    )
  );

-- Writes: owner/admin only, same as widget_configs itself (024).
CREATE POLICY "widget_config_scopes_managers_crud"
  ON widget_config_scopes FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));
