-- =============================================================================
-- Migration 058: Department operating hours, and sessions that follow them
-- =============================================================================
-- Two halves of one feature. A department gains a weekly pattern of open/close
-- windows, and a session gains the ability to say "I run the whole time we are
-- open" instead of naming times of its own.
--
-- The point is the second half. Staff entering a real pool schedule spend most
-- of their typing on blocks that are simply "whenever the building is open" —
-- and every one of those blocks is a copy of a number that lives somewhere
-- else. When September comes and the pool opens an hour later, every copy is
-- now wrong, and nothing in the product knows they were ever related.
--
-- So `follows_operating_hours` is a POINTER, not a prefill. A session carrying
-- it resolves its times at read time from the owning department's hours, every
-- time it is expanded. Change the hours, and the sessions move. There is no
-- backfill step and no "re-sync" button, because there is no copy to go stale.
--
--
-- WHY THIS IS NOT THE THING MIGRATION 014 WARNED ABOUT
--
-- 014 added `schedule_groups.schedule_type = 'continuous'` and said plainly
-- that "introducing a fake all-day/every-day session to represent 'always
-- open' would pollute expandSessions()'s cancel/modify occurrence semantics
-- (session_exceptions assumes discrete occurrences)". That reasoning still
-- holds and is not being reversed here.
--
-- It described a different thing. 'continuous' means a schedule with NO
-- discrete occurrences at all — open-gym drop-in with nothing to cancel,
-- represented as descriptive copy. A session with `follows_operating_hours`
-- still has a real RRULE and still produces a discrete, dated occurrence for
-- every day it runs; the only thing it declines to store is the clock time.
-- `session_exceptions` keeps keying on `exception_date` and keeps working.
--
-- The two remain separate answers to separate questions: 'continuous' is "this
-- activity has no schedule", this is "this activity's schedule is the
-- building's".
--
--
-- =============================================================================
-- 1. DEPARTMENT_HOURS — a table, and why windows are rows
-- =============================================================================
-- One row is one open/close window on one weekday. A department that opens
-- 06:00-12:00 and again 16:00-21:00 on Mondays has two Monday rows.
--
-- Multiple windows per day is the entire reason this is a table of rows rather
-- than two TIME columns on `departments`. Pools close midday. If a weekday
-- could only hold one open-close pair, a split-hours facility would have to
-- enter 06:00-21:00, and then every session following those hours would
-- silently claim the four hours the building is locked — the feature would be
-- most wrong exactly where it was supposed to help. Two rows cost a join;
-- getting the midday gap wrong costs trust in the published schedule.
--
-- CLOSED IS THE ABSENCE OF ROWS. There is no `is_closed` flag and no row with
-- NULL times. A weekday the department does not open simply has no rows for
-- it, which means:
--
--   * "Closed" and "not configured yet" are deliberately the same state. Both
--     produce no occurrence, which is the correct and safe outcome for both —
--     a session cannot inherit hours that were never entered.
--   * There is no second way to spell closed, so no query has to remember to
--     check a flag as well as the rows.
--   * Deleting a window is how you close a day, which is what the editor's UI
--     does anyway.
--
-- The cost is that the editor cannot distinguish "we are shut on Sundays" from
-- "nobody has filled in Sunday", and so cannot reassure staff that they are
-- finished. That is accepted: both answers lead to the same schedule, and the
-- session form says out loud which days a following session will skip.
--
-- NOT BUILT, DELIBERATELY: date-specific overrides (stat holidays, a one-off
-- early close). That needs a second table keyed on a date and a second editor,
-- and it is not a regression to leave out — a session with hard-coded times
-- shows up on Christmas Day today too, and `session_exceptions` already
-- cancels a single occurrence by hand. When it is built, it resolves in the
-- same place (resolveOperatingWindows in src/lib/schedule/operating-hours.ts)
-- and nothing else has to move.
-- =============================================================================

CREATE TABLE department_hours (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  -- Denormalized from the parent, exactly as every other child table here
  -- does it, so RLS can gate on org without a join.
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- 0 = Sunday .. 6 = Saturday. Matches JavaScript's getUTCDay(), which is
  -- what the expansion layer reads an occurrence's weekday with (session
  -- dates are UTC-labelled wall-clock digits — see src/lib/rrule/README.md).
  -- Using any other convention here would mean a conversion at the one place
  -- where a silent off-by-one day would be hardest to notice.
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at      TIME NOT NULL,
  closes_at     TIME NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A window must have positive length. Equal times would expand to a
  -- zero-length occurrence that renders as an invisible sliver on the grid
  -- and overlaps nothing, which is a confusing way to say "closed" when
  -- deleting the row says it properly.
  CONSTRAINT department_hours_window_ordered CHECK (closes_at > opens_at),

  -- Two identical windows on one day would duplicate every following
  -- session's occurrence on that day. Overlapping-but-not-identical windows
  -- are NOT blocked here — expressing that needs an exclusion constraint over
  -- a range type, and the editor merges them on save instead (see
  -- mergeWindows in src/lib/schedule/operating-hours.ts). The unique index
  -- catches the one case cheap enough to catch in the schema.
  UNIQUE (department_id, day_of_week, opens_at, closes_at)
);

-- The read path is always "every window for these departments", ordered for
-- display. Covers both the editor and the expansion layer's batch fetch.
CREATE INDEX idx_department_hours_lookup
  ON department_hours (department_id, day_of_week, opens_at);

ALTER TABLE department_hours ENABLE ROW LEVEL SECURITY;

-- READ: mirrors `departments_public_read_published` deliberately, rather than
-- being stricter. Operating hours are the single least secret fact a
-- recreation centre has — they are painted on the door — and a following
-- session's published times are DERIVED from them, so a viewer who can read
-- the session can already infer the window. Making the hours themselves
-- unreadable would mean the public widget could not explain why a session
-- runs 06:00-12:00, while still showing that it does.
--
-- Note this reads through to the parent rather than trusting a denormalized
-- `is_published` copy: a department that goes back to draft takes its hours
-- out of public view with it, with nothing to keep in step.
CREATE POLICY "department_hours_public_read_published"
  ON department_hours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM departments d
       WHERE d.id = department_hours.department_id
         AND (d.is_published = TRUE OR d.org_id = ANY(public.user_org_ids()))
    )
    OR public.is_superadmin()
  );

-- WRITE: the same authority as renaming the department (migration 055's
-- `departments_coordinator_update`). Hours are department configuration, so
-- whoever may configure the department may set them — which includes a
-- coordinator scoped to it, and excludes `aux`.
CREATE POLICY "department_hours_write"
  ON department_hours FOR ALL
  USING (public.can_write_department(department_id))
  WITH CHECK (public.can_write_department(department_id));

CREATE POLICY "department_hours_superadmin_all"
  ON department_hours FOR ALL
  USING (public.is_superadmin());

-- No updated_at trigger: this schema has never had one on any table, and a
-- window is replaced rather than edited in place (the editor writes a day's
-- rows as a set), so the column records the insert and nothing more.


-- =============================================================================
-- 2. SESSIONS.FOLLOWS_OPERATING_HOURS
-- =============================================================================
-- FALSE for every existing row and for anything that does not ask, so nothing
-- about the current authoring flow changes for anyone who ignores this.
--
-- WHY dtstart AND dtend_time ARE STILL REQUIRED AND STILL WRITTEN
--
-- They are not the source of truth for a following session, but they are not
-- dead either. They keep three jobs:
--
--   1. dtstart's DATE anchors the RRULE. `FREQ=WEEKLY;BYDAY=MO` still needs a
--      real starting calendar day to count weeks from. Only the TIME component
--      is superseded.
--   2. They are a SNAPSHOT for readers that never go through expansion — a raw
--      PostgREST select, an export, a future integration. Such a reader gets
--      the hours as they were when the session was last saved: possibly stale,
--      never nonsense. Making the columns nullable instead would hand every
--      one of those readers a NULL to crash on, to buy a stricter kind of
--      correctness nothing was asking for.
--   3. They are the fallback when the hours cannot be resolved — a schedule
--      group with no department, or a department whose hours were deleted
--      after the session was written. The session degrades to fixed times
--      rather than vanishing.
--
-- The snapshot is the widest window of the day the session starts on, and it
-- is derived SERVER-SIDE, in POST /api/sessions, not by whichever form or
-- dialog posted the request. That matters because this route has several
-- callers — the session form, the command centre's duplicate, the conflict
-- manager's space move, the import committer — and a fallback is only worth
-- having if every one of them produces a sane one. The route overwrites
-- whatever times the payload carried whenever the flag is set.
--
-- It is explicitly NOT read by the grid, the widget, the print view or the
-- conflict engine; all of those resolve through expandOccurrenceTimes(), which
-- is the single chokepoint that makes "change the hours, the sessions move"
-- true everywhere at once (src/lib/rrule/expand.ts).
--
-- WHY THIS IS ON `sessions` AND NOT ON `schedule_groups`
--
-- It is a property of one booking, not of a schedule. "Public Swim follows the
-- building's hours" and "Aquafit is 09:00-10:00" routinely live under the same
-- schedule group, and forcing the choice up a level would make the common case
-- un-expressible.
-- =============================================================================

ALTER TABLE sessions
  ADD COLUMN follows_operating_hours BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sessions.follows_operating_hours IS
  'When true, each occurrence''s start/end is resolved at read time from the '
  'owning department''s department_hours rows rather than from dtstart/'
  'dtend_time, which persist only as an RRULE anchor and a stale-tolerant '
  'snapshot. A weekday with no window produces no occurrence. See '
  'src/lib/schedule/operating-hours.ts.';

-- Partial, because the interesting question is only ever "which sessions
-- follow?" — asked by the department-hours editor when it needs to say how
-- many sessions a change is about to move. The FALSE majority is never
-- searched for on this column.
CREATE INDEX idx_sessions_following_hours
  ON sessions (schedule_group_id)
  WHERE follows_operating_hours = TRUE;
