-- =============================================================================
-- Migration 054: Space zone labels, and a real display order
-- =============================================================================
-- Two small fixes to the same page, neither of them a new tier.
--
-- 1. ZONE IS A LABEL, NOT A CONTAINER
--
-- A pool's eight lanes and the hot tub are all just rows under a facility, so
-- the Spaces page lists them together with nothing to say that Lanes 1-8 are
-- one body of water. `zone_name` is a free-text grouping label the Spaces page
-- renders subsections from. That is its entire job.
--
-- It is deliberately NOT a table, NOT a foreign key, and NOT bookable:
--
--   * Nothing joins to it. No RLS policy of its own, no cascade to reason
--     about, no second place a space's department could be declared.
--   * `session_spaces` is untouched. A zone cannot be booked, so the conflict
--     engine (src/lib/sessions/conflicts.ts, which buckets by space_id) and the
--     availability calculator (src/lib/schedule/availability.ts, whose unit of
--     availability is one `spaces` row) both keep working with no changes and
--     no knowledge that zones exist.
--   * NULL means "not in a zone", which is the right answer for a standalone
--     pickleball court and stays right forever. No backfill, no setup step
--     that has to be completed before the page is usable.
--
-- The cost of free text is real and accepted: renaming a zone means updating
-- every member row, and a typo makes a second zone. That is a UI problem (the
-- form offers existing names from the same facility) rather than a schema one,
-- and if it ever stops being tolerable this column is what a real table would
-- be backfilled *from*.
--
-- Migration 048 tried a genuine tier here and 049 removed it. This is not that
-- returning by another name — 048's error was duplicating lane ROWS per
-- configuration, so "Lane 1" existed twice and the conflict engine could not
-- see that both were the same water. Lanes stay one row each; a label on a row
-- cannot reintroduce that.
--
-- 2. display_order HAS NEVER BEEN WRITTEN
--
-- Eight queries sort by `spaces.display_order` and nothing has ever set it, so
-- every row in production carries the default 0. An ORDER BY over a single
-- repeated value is unordered: Postgres returns heap order, and an UPDATE
-- rewrites a row to the end of the heap. That is why lanes appear correct,
-- then scrambled after someone publishes one — observed on the dev database as
-- Lane 1, Lane 5, Lane 6, Lane 2, Lane 4, Lane 3 across 23 rows, all at 0.
--
-- The backfill below seeds a natural order per facility — the text part of the
-- name, then any trailing number as an integer, so "Lane 2" precedes
-- "Lane 10" where a plain alphabetical sort would not. `created_at` breaks
-- remaining ties so the result is deterministic. Staff reorder from the Spaces
-- page afterwards; this only decides where they start.
-- =============================================================================

ALTER TABLE spaces
  ADD COLUMN zone_name TEXT;

COMMENT ON COLUMN spaces.zone_name IS
  'Free-text grouping label for the Spaces page (e.g. "Main Pool"). Display '
  'only: not a tier, not bookable, nothing joins to it. NULL = not in a zone.';

-- Seed a sane per-facility order for every row created before this migration.
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY facility_id
      ORDER BY
        -- "Lane 10" -> "Lane"; groups a name family together.
        regexp_replace(name, '\s*\d+\s*$', '') ASC,
        -- "Lane 10" -> 10; numeric so 2 sorts before 10. Names with no
        -- trailing number collapse to 0 and fall through to the tiebreaks.
        COALESCE((substring(name from '(\d+)\s*$'))::INTEGER, 0) ASC,
        name ASC,
        created_at ASC
    ) AS position
  FROM spaces
)
UPDATE spaces s
  SET display_order = o.position
  FROM ordered o
  WHERE o.id = s.id;

-- New spaces are appended by the API (max + 1 per facility); this index keeps
-- that lookup, and every ordered read, off a sequential scan.
CREATE INDEX idx_spaces_facility_display_order
  ON spaces (facility_id, display_order);
