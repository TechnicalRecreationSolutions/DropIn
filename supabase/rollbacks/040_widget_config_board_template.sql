-- =============================================================================
-- ROLLBACK for Migration 040
-- =============================================================================
-- Narrows widget_configs.allowed_templates back to the four values 017 left it
-- at (grid, list, map, floorplan).
--
-- LOSSY. The constraint cannot be re-tightened while any row still lists
-- 'board', so the UPDATE below strips it first. An org that had switched its
-- embed to the board layout loses that choice and falls back to whatever else
-- it had enabled — or to 'grid' if board was the only entry, because the
-- constraint also forbids an empty array. Check what you are about to change:
--
--   SELECT org_id, allowed_templates FROM widget_configs
--   WHERE 'board' = ANY(allowed_templates);
--
-- src/components/widget/LayoutPicker.tsx and the board layout itself must be
-- reverted alongside this — the picker offers a value the database will reject.
-- analytics_events.view_template also accepts 'board' (migration 041); its own
-- rollback drops that column entirely.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

UPDATE widget_configs
SET allowed_templates = CASE
      WHEN array_remove(allowed_templates, 'board') = ARRAY[]::TEXT[]
        THEN ARRAY['grid']
      ELSE array_remove(allowed_templates, 'board')
    END
WHERE 'board' = ANY(allowed_templates);

ALTER TABLE widget_configs
  DROP CONSTRAINT widget_configs_allowed_templates_check;

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_allowed_templates_check
  CHECK (
    allowed_templates <@ ARRAY['grid', 'list', 'map', 'floorplan']
    AND array_length(allowed_templates, 1) > 0
  );
