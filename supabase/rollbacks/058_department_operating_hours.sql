-- Rollback for migration 058. Removes department operating hours and the
-- sessions flag that follows them.
--
-- SAFE, BUT NOT FREE. Every session with follows_operating_hours = TRUE falls
-- back to its dtstart/dtend_time snapshot — the widest open window of its
-- start day as it stood when the session was last saved. Those sessions keep
-- appearing on the schedule at plausible times, so the revert does not empty
-- anything; what is lost is the link, and a split-hours department's sessions
-- will span their midday closure again. Re-applying 058 does not restore it:
-- the flag is gone, so the sessions come back as ordinary fixed-time ones and
-- have to be re-ticked by hand.
--
-- Note the order: the index is dropped with the column it is built on, so
-- only the table needs an explicit DROP.

ALTER TABLE sessions DROP COLUMN IF EXISTS follows_operating_hours;

DROP TABLE IF EXISTS department_hours;
