-- =============================================================================
-- Migration 033: Schedule Group Status + Date Range
-- =============================================================================
-- schedule_groups.is_published was a bare boolean with no sense of *when* a
-- schedule is live. A schedule group is now meant to be a named slice of a
-- facility's timeline: it gains a starts_on/ends_on range, and is_published
-- becomes a `status` enum so the same "deliberate publish action" the
-- checkbox already gave staff keeps working, just typed to grow.
--
-- This is step 1 of that plan: it adds the fields and renames the read gate.
-- It deliberately does NOT enforce that no two published schedule groups at
-- the same facility/space can have overlapping dates — that check needs a
-- cross-row query (every other published schedule group at this facility),
-- which belongs in the API route that will own the draft->published
-- transition, not in a single-row DB constraint. schedule_groups also has no
-- write route yet (ScheduleGroupForm writes directly via the Supabase client
-- today, unlike departments/spaces) — adding one is a separate piece of work
-- this migration does not attempt.
--
-- DESIGN DECISIONS
--
-- 1. Two states only: 'draft', 'published'. An 'in_review' state was
--    discussed and deliberately deferred — not a proven need yet, and
--    trivial to add later by widening the CHECK. Don't build it speculatively.
--
-- 2. starts_on/ends_on are nullable, and there is NO constraint blocking a
--    'published' row from having NULL dates. Backfill (below) cannot always
--    derive clean dates — a schedule group with no active sessions, or whose
--    sessions are all open-ended (valid_until IS NULL), has no determinable
--    end, and some of those rows are is_published = TRUE today. A hard CHECK
--    here would either fail this migration outright against real data, or
--    (if written to auto-correct) silently flip currently-visible live
--    schedules to draft. Both are worse than the alternative: "no publish
--    without dates" is a rule for the future draft->published transition,
--    enforced in application code, not a retroactive judgment this migration
--    makes about existing data.
--
-- 3. Backfill leaves ends_on NULL whenever ANY of a schedule group's active
--    sessions is open-ended, rather than picking an arbitrary cutoff date —
--    an inferred date that looks authoritative but isn't would be worse than
--    an honest gap staff can see and fill in themselves.
--
-- 4. is_published isn't only read by schedule_groups' own policy — four other
--    tables' public-read policies join back to it: sessions.
--    sessions_public_read_active (011), session_exceptions.
--    exceptions_public_read (011), session_spaces.session_spaces_public_read
--    (020), session_features.session_features_public_read (028). All four
--    are dropped and recreated against `status = 'published'` here, in the
--    same place the column itself changes, rather than left for a later
--    migration to discover via a DROP COLUMN dependency error.
--
-- Rollback: supabase/rollbacks/033_schedule_group_status.sql
-- =============================================================================

ALTER TABLE schedule_groups
  ADD COLUMN starts_on DATE,
  ADD COLUMN ends_on DATE,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  ADD CONSTRAINT schedule_groups_dates_ordered
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);

-- Backfill status from the boolean it replaces.
UPDATE schedule_groups SET status = 'published' WHERE is_published = TRUE;

-- Backfill dates from each schedule group's own active sessions (decision 3).
UPDATE schedule_groups sg SET
  starts_on = sub.min_start,
  ends_on = sub.max_end
FROM (
  SELECT
    schedule_group_id,
    MIN(valid_from) AS min_start,
    CASE WHEN bool_or(valid_until IS NULL) THEN NULL ELSE MAX(valid_until) END AS max_end
  FROM sessions
  WHERE is_active = TRUE
  GROUP BY schedule_group_id
) sub
WHERE sg.id = sub.schedule_group_id;

-- Same shape of gate as before (migration 009), just status instead of a boolean.
DROP POLICY "schedule_groups_public_read_published" ON schedule_groups;
CREATE POLICY "schedule_groups_public_read_published"
  ON schedule_groups FOR SELECT
  USING (
    status = 'published'
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

-- The four dependent policies from decision 4 — same logic, sg.status = 'published'
-- instead of sg.is_published = TRUE. Must run before the DROP COLUMN below.
DROP POLICY "sessions_public_read_active" ON sessions;
CREATE POLICY "sessions_public_read_active"
  ON sessions FOR SELECT
  USING (
    (
      is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM schedule_groups sg
        WHERE sg.id = sessions.schedule_group_id AND sg.status = 'published'
      )
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

DROP POLICY "exceptions_public_read" ON session_exceptions;
CREATE POLICY "exceptions_public_read"
  ON session_exceptions FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_exceptions.session_id
      AND s.is_active = TRUE AND sg.status = 'published'
    )
  );

DROP POLICY "session_spaces_public_read" ON session_spaces;
CREATE POLICY "session_spaces_public_read"
  ON session_spaces FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_spaces.session_id
      AND s.is_active = TRUE AND sg.status = 'published'
    )
  );

DROP POLICY "session_features_public_read" ON session_features;
CREATE POLICY "session_features_public_read"
  ON session_features FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_features.session_id
        AND s.is_active = TRUE
        AND sg.status = 'published'
    )
  );

ALTER TABLE schedule_groups DROP COLUMN is_published;

-- The shape every future overlap-check query and "what's live right now"
-- lookup filters on.
CREATE INDEX idx_schedule_groups_facility_status_dates
  ON schedule_groups (facility_id, status, starts_on, ends_on);
