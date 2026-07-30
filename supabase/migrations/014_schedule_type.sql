-- =============================================================================
-- Migration 014: Schedule Type (time_block vs continuous)
-- =============================================================================
-- Every schedule group today is implicitly a "time block" schedule — a set
-- of recurring sessions with fixed start/end times placed on a weekly grid
-- (e.g. "Lane Swim: Mon/Wed/Fri 6-8am"). Some activities don't work that way
-- at all — e.g. an "Open Gym" that's simply open during facility hours with
-- no distinct bookable time slots to place on a grid or space axis.
--
-- schedule_type distinguishes these two cases so the schedule-builder UI and
-- the public widget can render the right experience for each:
--   - 'time_block' (default): today's behavior. Sessions are RRULE-based
--     recurring rules placed on a weekly grid/space builder.
--   - 'continuous': no sessions rows at all — see continuous_hours_note.
--     Introducing a fake all-day/every-day session to represent "always
--     open" would pollute expandSessions()'s cancel/modify occurrence
--     semantics (session_exceptions assumes discrete occurrences), so
--     continuous schedules are represented as simple descriptive copy
--     instead, edited through a dedicated (non-grid) builder UI.
--
-- Defaulting existing rows to 'time_block' preserves current behavior for
-- every schedule group that exists before this migration with zero changes.
-- =============================================================================

ALTER TABLE schedule_groups
  ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'time_block'
    CHECK (schedule_type IN ('time_block', 'continuous')),
  -- Free-text hours/availability copy shown on the public widget for
  -- 'continuous' schedule groups only (e.g. "Open daily 6am-10pm,
  -- staff-supervised"). Unused for 'time_block' schedule groups, which
  -- derive their public display from their sessions as today.
  ADD COLUMN continuous_hours_note TEXT;
