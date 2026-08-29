-- =============================================================================
-- Migration 040: Board schedule layout
-- =============================================================================
-- Adds "board" as a fifth allowed_templates value (see
-- 017_widget_config_floorplan_template.sql for the last time this constraint
-- widened). Board is the printed-PDF-style view: day columns, shared
-- time-band rows, one box per session — no facility/map dependency, so
-- unlike floorplan there is nothing to gate it on. Existing rows are
-- untouched — no default changes.
-- =============================================================================

ALTER TABLE widget_configs
  DROP CONSTRAINT widget_configs_allowed_templates_check;

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_allowed_templates_check
  CHECK (
    allowed_templates <@ ARRAY['grid', 'list', 'map', 'floorplan', 'board']
    AND array_length(allowed_templates, 1) > 0
  );
