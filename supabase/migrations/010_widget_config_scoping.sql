-- =============================================================================
-- Migration 010: Widget config scoping by facility + department
-- =============================================================================
-- widget_configs was strictly one row per org (org_id UNIQUE). Orgs running
-- multiple facilities/departments need a distinct embeddable widget per
-- facility+department combination, each independently themed. Existing rows
-- get facility_id = NULL, department_id = NULL — an org-wide default config,
-- which is also the flexibility fallback for orgs that never need
-- per-facility/department widgets.
--
-- Constraint name confirmed directly against the deployed DB before writing
-- this migration: widget_configs_org_id_key (type 'u'). PG version confirmed
-- as 17.6, so UNIQUE NULLS NOT DISTINCT is available.
-- =============================================================================

ALTER TABLE widget_configs
  DROP CONSTRAINT widget_configs_org_id_key;

ALTER TABLE widget_configs
  ADD COLUMN facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE CASCADE;

-- NULLS NOT DISTINCT treats NULL as equal to NULL for uniqueness purposes,
-- so (org, NULL, NULL) can only exist once (the org-wide default row),
-- while (org, facility, NULL) and (org, facility, department) rows are
-- each unique too.
ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_scope_unique
    UNIQUE NULLS NOT DISTINCT (org_id, facility_id, department_id);

CREATE INDEX idx_widget_configs_facility_id ON widget_configs (facility_id);
CREATE INDEX idx_widget_configs_department_id ON widget_configs (department_id);
