-- =============================================================================
-- ROLLBACK for Migration 035
-- =============================================================================
-- Drops the session-write triggers and published_at. Any MODIFIED status
-- computed in application code (updated_at > published_at) must be reverted
-- alongside this — it will read every published schedule as unmodified once
-- published_at is gone, not error, so there's no hard dependency to satisfy
-- first, just a UI regression if this runs while that code still expects the
-- column.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP TRIGGER IF EXISTS session_exceptions_touch_schedule_group ON session_exceptions;
DROP FUNCTION IF EXISTS touch_schedule_group_on_exception_write();

DROP TRIGGER IF EXISTS sessions_touch_schedule_group ON sessions;
DROP FUNCTION IF EXISTS touch_schedule_group_on_session_write();

ALTER TABLE schedule_groups DROP COLUMN IF EXISTS published_at;
