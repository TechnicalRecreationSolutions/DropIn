-- =============================================================================
-- Migration 017: Floorplan schedule layout
-- =============================================================================
-- Adds "floorplan" as a fourth allowed_templates value (see
-- 015_widget_config_allowed_templates.sql), for the new facility map/hotspot
-- widget (016_facility_maps.sql). Existing rows are untouched — no default
-- changes, since a facility only has something to show here once it
-- publishes a facility_maps row, and the dashboard UI gates the checkbox on
-- that (an org can't enable a widget with nothing to render).
-- =============================================================================

ALTER TABLE widget_configs
  DROP CONSTRAINT widget_configs_allowed_templates_check;

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_allowed_templates_check
  CHECK (
    allowed_templates <@ ARRAY['grid', 'list', 'map', 'floorplan']
    AND array_length(allowed_templates, 1) > 0
  );
