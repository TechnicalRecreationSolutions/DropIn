-- =============================================================================
-- Migration 032: Let a brochure entry outlive its source
-- =============================================================================
-- Fixes a contradiction inside migration 031 between two of its own decisions.
--
-- 031 decision 4 says the source FKs are ON DELETE SET NULL, never CASCADE, so
-- that deleting the session behind an already-printed brochure leaves the
-- brochure intact — the entry being the record of what was published.
--
-- But 031's `brochure_entries_source_shape` CHECK required a 'session' entry to
-- have a non-null session_id. So when the FK fired and set it to NULL, the
-- CHECK rejected the resulting row and the DELETE failed:
--
--   23514: new row for relation "brochure_entries" violates check constraint
--          "brochure_entries_source_shape"
--
-- The visible effect was not a brochure problem at all. **A session that
-- appeared in any brochure could not be deleted**, so "Remove series" in the
-- schedule editor would fail with an opaque database error on exactly the
-- sessions an org cared about most. Caught by the Phase D harness asserting
-- that an entry survives its source — the assertion failed because the source
-- was never deleted in the first place.
--
-- THE RELAXATION, AND WHAT IT DELIBERATELY KEEPS
--
-- The half of the constraint that mattered was never "exactly one FK is set" —
-- it was "**never both**". Both set is the genuinely corrupting state: the
-- re-pull comparison and the editor's source lookup pick their table from
-- `source_type`, so a row claiming 'session' while carrying a schedule_group_id
-- would read the wrong row and snapshot the wrong copy.
--
-- "At least one is set" was only ever an assumption about how entries are
-- created, and it is false the moment a source is deleted — which is a state
-- 031 explicitly designed for. `source_type` is untouched, so an orphaned entry
-- still records that it came from a session, and the editor can say so.
--
-- Rollback: supabase/rollbacks/032_brochure_entry_source_shape.sql
--   (Rolling back re-blocks deleting any session or schedule group that appears
--   in a brochure. Only do it if 031 is being rolled back too.)
-- =============================================================================

ALTER TABLE brochure_entries
  DROP CONSTRAINT brochure_entries_source_shape;

ALTER TABLE brochure_entries
  ADD CONSTRAINT brochure_entries_source_shape CHECK (
    -- Never both. This is the invariant that protects the re-pull comparison.
    NOT (session_id IS NOT NULL AND schedule_group_id IS NOT NULL)
    -- And the FK that is set must match what source_type claims, so the
    -- comparison reads the table the entry says it came from.
    AND (source_type = 'session'        OR session_id IS NULL)
    AND (source_type = 'schedule_group' OR schedule_group_id IS NULL)
  );

COMMENT ON CONSTRAINT brochure_entries_source_shape ON brochure_entries IS
  'Never both FKs, and a set FK must match source_type. Deliberately does NOT '
  'require one to be set: ON DELETE SET NULL nulls it when the source is '
  'deleted, and the entry is meant to survive that (migration 031, decision 4).';
