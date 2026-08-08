-- =============================================================================
-- ROLLBACK for Migration 029
-- =============================================================================
-- Removes 'events' from the allowed_templates CHECK.
--
-- ⚠️  This will FAIL if any widget_configs row still lists 'events' — the new
-- constraint is validated against existing data. Clear it first:
--
--   UPDATE widget_configs
--      SET allowed_templates = array_remove(allowed_templates, 'events')
--    WHERE 'events' = ANY(allowed_templates);
--
--   -- then make sure nothing was left with an empty array, which the
--   -- constraint also forbids:
--   UPDATE widget_configs
--      SET allowed_templates = ARRAY['grid']
--    WHERE array_length(allowed_templates, 1) IS NULL;
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

ALTER TABLE widget_configs
  DROP CONSTRAINT widget_configs_allowed_templates_check;

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_allowed_templates_check
  CHECK (
    allowed_templates <@ ARRAY['grid', 'list', 'map', 'floorplan']
    AND array_length(allowed_templates, 1) > 0
  );
