-- =============================================================================
-- Rollback for 032_brochure_entry_source_shape.sql
-- =============================================================================
-- ⚠️  This restores a constraint that BLOCKS deleting any session or schedule
-- group appearing in a brochure — the bug 032 fixed. Only run it as part of
-- rolling back 031 entirely.
--
-- It will also fail outright if any entry has already been orphaned by a source
-- deletion (source_type set, both FKs NULL), because those rows cannot satisfy
-- the old constraint. Check first:
--
--   SELECT count(*) FROM brochure_entries
--    WHERE source_type <> 'custom' AND session_id IS NULL AND schedule_group_id IS NULL;
-- =============================================================================

ALTER TABLE brochure_entries
  DROP CONSTRAINT brochure_entries_source_shape;

ALTER TABLE brochure_entries
  ADD CONSTRAINT brochure_entries_source_shape CHECK (
    (source_type = 'session'        AND session_id IS NOT NULL AND schedule_group_id IS NULL)
    OR (source_type = 'schedule_group' AND schedule_group_id IS NOT NULL AND session_id IS NULL)
    OR (source_type = 'custom'      AND session_id IS NULL AND schedule_group_id IS NULL)
  );
