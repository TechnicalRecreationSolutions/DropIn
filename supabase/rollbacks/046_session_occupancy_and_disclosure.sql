-- =============================================================================
-- ROLLBACK for Migration 046
-- =============================================================================
-- Drops the sidecar and both columns, and restores the three policies to the
-- exact text migration 033 left them with.
--
-- DESTRUCTIVE: dropping session_internal discards every holder name and setup
-- note staff have entered. There is nowhere else that data lives. Dump the
-- table first if the rollback is anything other than "this shipped an hour ago
-- and nobody used it."
--
-- The application code must be reverted alongside this — POST /api/sessions
-- writes session_internal, /api/sessions/expand selects from it, and
-- SessionForm posts occupancy_kind/disclosure. They will error once these are
-- gone, not silently degrade.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP TABLE IF EXISTS session_internal;

-- Restore migration 033's text exactly — without `disclosure <> 'internal'`,
-- which must go before the column it references does.

DROP POLICY IF EXISTS "sessions_public_read_active" ON sessions;
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

DROP POLICY IF EXISTS "exceptions_public_read" ON session_exceptions;
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

DROP POLICY IF EXISTS "session_spaces_public_read" ON session_spaces;
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

ALTER TABLE sessions
  DROP COLUMN IF EXISTS occupancy_kind,
  DROP COLUMN IF EXISTS disclosure;
