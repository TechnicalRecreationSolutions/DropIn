-- =============================================================================
-- Migration 029: Events schedule layout
-- =============================================================================
-- Adds "events" as a fifth allowed_templates value, for the month-at-a-glance
-- event calendar (see 028_session_features.sql). Exactly the same shape as
-- 017, which added "floorplan" as the fourth.
--
-- Existing rows are untouched and no default changes: an org has nothing to
-- show here until it flips the event toggle on at least one session, and the
-- dashboard gates the checkbox on that — the same rule floorplan follows with
-- a published facility map. An org cannot enable a widget view with nothing
-- to render.
--
-- Rollback: supabase/rollbacks/029_widget_config_events_template.sql
--   (roll this back BEFORE 028 — see that file's header.)
-- =============================================================================

ALTER TABLE widget_configs
  DROP CONSTRAINT widget_configs_allowed_templates_check;

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_allowed_templates_check
  CHECK (
    allowed_templates <@ ARRAY['grid', 'list', 'map', 'floorplan', 'events']
    AND array_length(allowed_templates, 1) > 0
  );
