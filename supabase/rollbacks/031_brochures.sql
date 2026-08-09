-- =============================================================================
-- Rollback for 031_brochures.sql
-- =============================================================================
-- ⚠️  Destructive. Dropping brochure_entries discards every snapshot and every
-- tombstone — so re-applying 031 afterwards gives you empty brochures whose
-- next pull resurrects everything anyone had dismissed. There is no way to
-- recover that editorial history from the source tables, because the whole
-- point of a tombstone is that it records a decision the sources do not.
--
-- Export first if the brochures are real:
--   SELECT * FROM brochure_entries;
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
