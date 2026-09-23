-- Rollback for migration 060. Removes facility status notices.
--
-- WHAT THIS DESTROYS, AND WHAT IT DOES NOT
--
-- Nothing about the schedule depends on this table. No session reads it, no
-- expansion touches it, no conflict is computed from it. Dropping it returns
-- every public surface to the state it had before 060: the schedule, and no
-- banner above it. Nothing renders blank and nothing 500s.
--
-- What is lost is the record of what went wrong and when — every closure,
-- every contamination, every staffing shortage a facility published. That
-- history has no second copy anywhere, and it is the input to the only
-- interesting question this table can eventually answer ("why do we keep
-- closing this pool?"). Re-applying 060 brings back an empty table.
--
-- ⚠️ CHECK BEFORE RUNNING: a notice that is live at this moment vanishes from
-- every public page the instant this executes, with no trace that it was
-- there. If a facility is closed right now, tell somebody first.
--
--   SELECT f.name, n.headline, n.severity
--     FROM facility_notices n JOIN facilities f ON f.id = n.facility_id
--    WHERE n.is_published
--      AND n.starts_at <= NOW()
--      AND (n.ends_at IS NULL OR n.ends_at > NOW());
--
-- The column on `organizations` is dropped last. It is independent of the
-- table — an organization's answer to "do we trust our guards with this?" —
-- but it means nothing without the feature, and leaving it behind would have
-- a re-applied 060 silently inherit a decision made months earlier.

DROP POLICY IF EXISTS "facility_notices_superadmin_all" ON facility_notices;
DROP POLICY IF EXISTS "facility_notices_write" ON facility_notices;
DROP POLICY IF EXISTS "facility_notices_read" ON facility_notices;

DROP TABLE IF EXISTS facility_notices;

DROP FUNCTION IF EXISTS public.can_write_notice(UUID);

ALTER TABLE organizations DROP COLUMN IF EXISTS aux_can_post_notices;
