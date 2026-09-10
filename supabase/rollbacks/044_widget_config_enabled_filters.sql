-- =============================================================================
-- ROLLBACK for Migration 044
-- =============================================================================
-- Removes the visitor-facing filter toggles: the CHECK constraint first, then
-- the column (dropping the column would take the constraint anyway; naming it
-- keeps the reverse of 044 readable).
--
-- LOSSY only in the sense that each org's chosen filter set is forgotten —
-- there is no derived data here, and no other table references the column. The
-- filtering itself was always client-side over the already-loaded week, so
-- nothing needs to be recomputed.
--
-- src/components/schedule/ScheduleFilterBar.tsx,
-- src/lib/schedule/sessionFilters.ts, src/components/widget/FilterEditor.tsx
-- and VisitorFilterToggles.tsx must be reverted alongside this. Note that
-- public routes read widget_configs with select("*") on purpose, so they will
-- not break on the missing column — they will just render no filter bar, which
-- is why the UI has to come out too rather than be left to fail.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

ALTER TABLE widget_configs
  DROP CONSTRAINT IF EXISTS widget_configs_enabled_filters_check;

ALTER TABLE widget_configs
  DROP COLUMN IF EXISTS enabled_filters;
