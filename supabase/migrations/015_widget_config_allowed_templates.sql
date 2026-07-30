-- =============================================================================
-- Migration 015: Multi-select widget schedule layouts
-- =============================================================================
-- widget_configs.template (added in migration 008) was a single scalar —
-- staff could only pick ONE of grid/list/map, and that was the only view
-- ever shown to visitors. A viewer-facing view-toggle was added later
-- (ScheduleHeaderBar) letting a visitor override the single configured
-- default for their own session, but it always offered all three options
-- regardless of what staff intended to expose.
--
-- This replaces the scalar `template` column with `allowed_templates
-- TEXT[]` — the SET of views staff want to make available. The toggle then
-- only shows views in this set. Defaults to all three so every existing
-- row's visible behavior is unchanged. The array must be non-empty and
-- contain only valid values — an org can't disable every view.
--
-- "Which view loads first" is simply allowed_templates[1] (array order is
-- staff's preference order) rather than a separate default-view column —
-- one array is sufficient to express both without a second field to keep
-- in sync.
-- =============================================================================

ALTER TABLE widget_configs
  ADD COLUMN allowed_templates TEXT[] NOT NULL DEFAULT ARRAY['grid', 'list', 'map']
      CHECK (
            allowed_templates <@ ARRAY['grid', 'list', 'map']
                  AND array_length(allowed_templates, 1) > 0
                      );

                      UPDATE widget_configs SET allowed_templates = ARRAY[template];

                      ALTER TABLE widget_configs DROP COLUMN template;
                      