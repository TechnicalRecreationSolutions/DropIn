-- =============================================================================
-- 069: a head count can say which session it was taken during
-- =============================================================================
--
-- 061 recorded WHERE (space_id, or NULL for the whole building) and WHEN
-- (recorded_at). Staff asked to record WHAT as well: "38 in Lane Swim" is the
-- number a program decision rests on, and "38 in the pool at 6:10" makes the
-- reader reconstruct the schedule to get there.
--
-- `session_id` names the session row, not the occurrence. A recurring session
-- is one row across many weeks, and `recorded_at` already says which week —
-- an occurrence key would be a second, derived copy of a fact the row holds.
--
-- ON DELETE SET NULL, not CASCADE: deleting a session from the schedule must
-- not delete what was observed while it ran. The count survives, unlabelled.
--
-- No RLS change. The INSERT policy already requires the caller to hold the
-- facility; the API route checks that the session belongs to it too, the same
-- way it checks `space_id`.
-- =============================================================================

ALTER TABLE facility_readings
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN facility_readings.session_id IS
  'The session this reading was taken during, if staff named one (migration '
  '069). The row, not the occurrence: recorded_at says which week.';

CREATE INDEX IF NOT EXISTS idx_facility_readings_session
  ON facility_readings (session_id, recorded_at DESC)
  WHERE session_id IS NOT NULL;
