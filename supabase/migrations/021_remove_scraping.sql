-- =============================================================================
-- Migration 021: Remove Scraping
-- =============================================================================
-- Scraping is no longer a supported data-collection method. Migrations 001 and
-- 003 already shipped with scraping-only columns/indexes on `sessions`
-- (source_url, external_id, last_synced_at) and a 'scraped' source value —
-- those migrations are not rewritten here per the project's rule against
-- editing migrations that have already run; this migration tears the
-- scraping-only pieces back out going forward.
--
-- schedule_groups is handled defensively (IF EXISTS) too: migration 011 was
-- edited to stop adding scraping columns before this migration was written,
-- but if 011 already ran against this database with its pre-edit version,
-- schedule_groups still physically has them.
-- =============================================================================

DROP INDEX IF EXISTS idx_sessions_last_synced;
DROP INDEX IF EXISTS idx_schedule_groups_last_synced;

-- Leftover rows from testing the (now-removed) mock scraper — no real
-- scraper was ever deployed, so these were effectively manually-seeded.
UPDATE sessions SET source = 'manual' WHERE source = 'scraped';
UPDATE schedule_groups SET source = 'manual' WHERE source = 'scraped';

ALTER TABLE sessions
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS last_synced_at;

ALTER TABLE schedule_groups
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS last_synced_at;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_source_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_source_check
  CHECK (source IN ('manual', 'imported'));

ALTER TABLE schedule_groups DROP CONSTRAINT IF EXISTS schedule_groups_source_check;
ALTER TABLE schedule_groups ADD CONSTRAINT schedule_groups_source_check
  CHECK (source IN ('manual', 'imported'));

-- migration 006_scraping_tables.sql was deleted from the repo (never applied
-- to any shared/production database), but if it already ran against this
-- database the tables still physically exist — drop them if so.
DROP TABLE IF EXISTS scraping_conflicts;
DROP TABLE IF EXISTS scraping_jobs;
DROP TABLE IF EXISTS scraping_configs;
