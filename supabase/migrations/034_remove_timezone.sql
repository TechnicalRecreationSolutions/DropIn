-- Sessions are attended in person, at one facility, by people who are
-- already local to it -- there is no cross-timezone audience for a session's
-- displayed time. Storing dtstart as a real UTC instant plus a `timezone`
-- column to reverse it back into wall-clock time on every read was solving a
-- problem this product doesn't have, and it's the root cause of every bug in
-- dropin/docs/RESUME-schedule-input-fixes.md's P0 section plus three of the
-- five P1 items: the app had four different call sites that could each get
-- "which timezone" wrong independently, and did.
--
-- New model: dtstart's stored digits ARE the local wall-clock time directly.
-- This is the exact technique src/lib/rrule/expand.ts already used
-- internally as a "floating DTSTART" detour during RRULE expansion (see its
-- header comment) -- this migration makes that the actual storage format
-- instead of a value re-derived by every reader.
--
-- dtstart stays TIMESTAMPTZ (not TIMESTAMP) so the column's on-the-wire type
-- doesn't change -- application code keeps parsing it as a normal
-- ISO-with-Z string. What changes is that no conversion is ever applied to
-- it again: written with a literal "Z" for whatever wall-clock digits were
-- entered, read back with getUTCHours()/getUTCDate()/etc, never through
-- Intl.DateTimeFormat with a timeZone option or any zonedTimeToUtc-style
-- offset math. See dropin/docs/RESUME-timezone-removal.md for the full
-- design and the application-layer changes this enables (not yet made --
-- this migration is the schema half only).

-- 1. Backfill: reinterpret each existing dtstart's real instant as the local
--    wall-clock reading in its own timezone, then store those same digits as
--    if they were already UTC. `AT TIME ZONE` here is explicit both times,
--    so this doesn't depend on the connection's TimeZone GUC.
UPDATE sessions
SET dtstart = (dtstart AT TIME ZONE timezone) AT TIME ZONE 'UTC';

-- 2. Same treatment for the two exception columns that carry an independent
--    instant (modified_start/modified_end on a 'modified' exception) --
--    each converted through its *parent session's* timezone, not its own
--    (session_exceptions has no timezone column of its own).
UPDATE session_exceptions e
SET modified_start = (e.modified_start AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
FROM sessions s
WHERE e.session_id = s.id AND e.modified_start IS NOT NULL;

UPDATE session_exceptions e
SET modified_end = (e.modified_end AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
FROM sessions s
WHERE e.session_id = s.id AND e.modified_end IS NOT NULL;

-- 3. Drop the now-unused column. Nothing else references it once the
--    application-layer follow-up lands (see the RESUME doc's file list).
ALTER TABLE sessions DROP COLUMN timezone;

-- 4. Leave a note in place, since the column comment is the only thing left
--    to warn a future reader that dtstart isn't a real instant.
COMMENT ON COLUMN sessions.dtstart IS
  'First occurrence''s local wall-clock date/time, stored as literal UTC-labelled digits with no real timezone meaning. Read with getUTCHours()/getUTCDate()/etc -- never convert through an IANA zone. See src/lib/rrule/README.md and dropin/docs/RESUME-timezone-removal.md.';
