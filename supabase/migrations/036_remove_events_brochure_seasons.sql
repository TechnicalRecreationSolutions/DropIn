-- =============================================================================
-- Migration 036: Remove seasons, events, and brochures
-- =============================================================================
-- The seasons → events → storage → brochure track (migrations 027–032) is
-- being torn out. It was built under an earlier, broader product vision;
-- Dropin has since narrowed twice — first to a single-organization tool, then
-- again to cut scope aggressively toward launch (see docs/PLAN.md). The
-- feature is not paused, it is removed on purpose. Do not re-add it from this
-- migration or from the rollback scripts under supabase/rollbacks/027-032 —
-- those remain only as historical record of what shipped, same as
-- 021_remove_scraping.sql's rollbacks for the scraping tables.
--
-- This is intentionally final: no rollback is provided under
-- supabase/rollbacks/ for this migration, matching 021's framing. Reversing
-- this removal means re-running 027–032 from scratch, which is a rebuild, not
-- an undo — the data this drops (seasons, event copy, brochure assembly and
-- tombstones) is not recoverable from anything else in the schema.
--
-- Per this project's rule against editing migrations that have already run,
-- 027–035 are untouched; this is a new, additive-only removal migration.
-- Every statement below is defensive (IF EXISTS / IF NOT EXISTS) because a
-- database's exact applied-migration history cannot be assumed.
--
-- OUT OF SCOPE — explicitly NOT touched by this migration:
--   - schedule_groups.status / .starts_on / .ends_on (033)      — core publish/date infra
--   - schedule_groups.published_at + its two triggers (035)     — schedule-list-view feature;
--     brochures had their OWN published_at on the brochures table, which this
--     migration does drop along with the rest of that table.
--   - The org-media bucket itself, org_media_org_id(), and the
--     facilities/schedules/org path kinds — shared with facility photos,
--     schedule-group photos and the org logo. Only the events/brochure kind
--     values and their write policy are removed below.
-- =============================================================================

-- =============================================================================
-- 1. Storage — trim org_media_kind() policy surface
-- =============================================================================
-- Drop the member-write policy that granted events/brochure folders write
-- access, and replace it with nothing: those two kinds no longer have any
-- writer. The manager-write policy (facilities/schedules/org) and public-read
-- policy are untouched.
--
-- Object deletion for the events/ and brochure/ prefixes is NOT done here —
-- Supabase blocks direct DELETE on storage.objects (storage.protect_delete()
-- trigger: "Use the Storage API instead"). Run
-- `node scripts/remove-events-brochure-storage.mjs` separately (before or
-- after this migration, order doesn't matter) to clean those objects up via
-- the Storage API. Until that script runs, any already-uploaded event/
-- brochure images remain in the bucket, orphaned but still publicly
-- readable at their existing URLs — nothing left in the app links to them
-- once this migration lands.
DROP POLICY IF EXISTS "org_media_member_write" ON storage.objects;

-- =============================================================================
-- 2. Brochures — drop entries, sections, brochures, then the candidacy flag
-- =============================================================================
DROP POLICY IF EXISTS "brochure_entries_superadmin_all"  ON brochure_entries;
DROP POLICY IF EXISTS "brochure_entries_members_crud"    ON brochure_entries;
DROP POLICY IF EXISTS "brochure_entries_public_read"     ON brochure_entries;
DROP POLICY IF EXISTS "brochure_sections_superadmin_all" ON brochure_sections;
DROP POLICY IF EXISTS "brochure_sections_members_crud"   ON brochure_sections;
DROP POLICY IF EXISTS "brochure_sections_public_read"    ON brochure_sections;
DROP POLICY IF EXISTS "brochures_superadmin_all"         ON brochures;
DROP POLICY IF EXISTS "brochures_managers_crud"          ON brochures;
DROP POLICY IF EXISTS "brochures_public_read"            ON brochures;

DROP TABLE IF EXISTS brochure_entries;
DROP TABLE IF EXISTS brochure_sections;
DROP TABLE IF EXISTS brochures;

DROP INDEX IF EXISTS idx_schedule_groups_in_brochure;
ALTER TABLE schedule_groups DROP COLUMN IF EXISTS in_brochure;

-- =============================================================================
-- 3. Event/brochure toggles and their shared payload table on sessions
-- =============================================================================
DROP POLICY IF EXISTS "session_features_superadmin_all" ON session_features;
DROP POLICY IF EXISTS "session_features_members_crud" ON session_features;
DROP POLICY IF EXISTS "session_features_public_read" ON session_features;

DROP INDEX IF EXISTS idx_session_features_org_id;
DROP TABLE IF EXISTS session_features;

DROP INDEX IF EXISTS idx_sessions_in_brochure;
DROP INDEX IF EXISTS idx_sessions_is_event;

ALTER TABLE sessions
  DROP COLUMN IF EXISTS in_brochure,
  DROP COLUMN IF EXISTS is_event;

-- =============================================================================
-- 4. widget_configs.allowed_templates — drop 'events' back down to four values
-- =============================================================================
-- Defensive cleanup first (029's rollback header calls this out explicitly):
-- clear 'events' from any row that still lists it, and backfill anything left
-- with an empty array, BEFORE tightening the CHECK back down — the new
-- constraint is validated against existing data and will fail otherwise.
UPDATE widget_configs
   SET allowed_templates = array_remove(allowed_templates, 'events')
 WHERE 'events' = ANY(allowed_templates);

UPDATE widget_configs
   SET allowed_templates = ARRAY['grid']
 WHERE array_length(allowed_templates, 1) IS NULL;

ALTER TABLE widget_configs
  DROP CONSTRAINT IF EXISTS widget_configs_allowed_templates_check;

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_allowed_templates_check
  CHECK (
    allowed_templates <@ ARRAY['grid', 'list', 'map', 'floorplan']
    AND array_length(allowed_templates, 1) > 0
  );

-- =============================================================================
-- 5. Seasons — last, since sessions.season_id and brochures.season_id both
--    referenced it (brochures is already gone above; sessions.season_id here)
-- =============================================================================
DROP INDEX IF EXISTS idx_sessions_season_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS season_id;

DROP INDEX IF EXISTS idx_seasons_org_starts_on;

DROP POLICY IF EXISTS "seasons_superadmin_all" ON seasons;
DROP POLICY IF EXISTS "seasons_managers_crud" ON seasons;
DROP POLICY IF EXISTS "seasons_public_read_published" ON seasons;

DROP TABLE IF EXISTS seasons;
