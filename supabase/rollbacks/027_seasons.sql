-- =============================================================================
-- ROLLBACK for Migration 027
-- =============================================================================
-- ⚠️  DESTRUCTIVE. Dropping `seasons` destroys every season an org has defined,
-- and dropping sessions.season_id destroys every season assignment made since
-- the migration ran. Neither is recoverable from the remaining tables —
-- season membership is explicit, not inferable from valid_from/valid_until
-- (see decision 4 in the migration header).
--
-- Requires reverting the application code that reads either, or the dashboard
-- will 500 on the season picker:
--   - src/lib/seasons/*
--   - src/app/api/seasons/*
--   - the season_id passthrough in src/app/api/sessions/route.ts
--   - the seasonId filter in src/app/api/sessions/expand/route.ts
--   - src/app/(dashboard)/dashboard/seasons/*
--   - SeasonPicker in src/components/schedule-command/
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP INDEX IF EXISTS idx_sessions_season_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS season_id;

DROP INDEX IF EXISTS idx_seasons_org_starts_on;

DROP POLICY IF EXISTS "seasons_superadmin_all" ON seasons;
DROP POLICY IF EXISTS "seasons_managers_crud" ON seasons;
DROP POLICY IF EXISTS "seasons_public_read_published" ON seasons;

DROP TABLE IF EXISTS seasons;
