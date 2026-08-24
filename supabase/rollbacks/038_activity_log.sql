-- =============================================================================
-- ROLLBACK for Migration 038
-- =============================================================================
-- Drops the activity log entirely: every trigger, both functions, and the
-- table itself (which takes its data, indexes and RLS policy with it via
-- CASCADE-less plain DROP — there's nothing else that references this table,
-- so no CASCADE is needed). The Overview stat card and /dashboard/activity
-- page must be reverted alongside this — they will error once these are
-- gone, not silently degrade.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP TRIGGER IF EXISTS facilities_log_activity ON facilities;
DROP TRIGGER IF EXISTS departments_log_activity ON departments;
DROP TRIGGER IF EXISTS spaces_log_activity ON spaces;
DROP TRIGGER IF EXISTS schedule_groups_log_activity ON schedule_groups;
DROP TRIGGER IF EXISTS sessions_log_activity ON sessions;
DROP TRIGGER IF EXISTS session_templates_log_activity ON session_templates;

DROP FUNCTION IF EXISTS public.revert_activity(UUID);
DROP FUNCTION IF EXISTS public.log_activity();

DROP TABLE IF EXISTS activity_log;
