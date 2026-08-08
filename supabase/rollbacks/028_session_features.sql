-- =============================================================================
-- ROLLBACK for Migration 028
-- =============================================================================
-- ⚠️  DESTRUCTIVE. Dropping session_features destroys every event/brochure
-- description, image URL, link and category an org has written. None of it is
-- recoverable from the remaining tables — it exists nowhere else.
--
-- Dropping is_event / in_brochure destroys which sessions were featured, which
-- is also not inferable: a featured session is otherwise identical to any
-- other session.
--
-- Requires reverting the application code that reads any of it:
--   - the "events" value in ScheduleTemplate and widget_configs.allowed_templates
--     (that CHECK constraint is migration 029 — roll that back FIRST or an org
--     with allowed_templates containing 'events' will render a view whose data
--     no longer exists)
--   - src/components/schedule/EventCalendarView.tsx and its month plumbing
--   - the feature fields on ExpandedSession (src/lib/rrule/expand.ts)
--   - src/app/api/session-features/*
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP POLICY IF EXISTS "session_features_superadmin_all" ON session_features;
DROP POLICY IF EXISTS "session_features_members_crud" ON session_features;
DROP POLICY IF EXISTS "session_features_public_read" ON session_features;

DROP INDEX IF EXISTS idx_session_features_org_id;
DROP TABLE IF EXISTS session_features;

DROP INDEX IF EXISTS idx_sessions_in_brochure;
DROP INDEX IF EXISTS idx_sessions_is_event;

ALTER TABLE sessions
  DROP COLUMN IF EXISTS in_brochure,
  DROP COLUMN IF EXISTS is_event;
