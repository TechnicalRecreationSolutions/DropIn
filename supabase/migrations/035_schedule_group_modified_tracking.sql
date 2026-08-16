-- =============================================================================
-- Migration 035: Schedule Group "Modified Since Publish" Tracking
-- =============================================================================
-- The staff schedule list needs a MODIFIED status distinct from PUBLISHED:
-- "this went live, then someone changed it" is a real, actionable state that
-- draft/published alone can't express. That requires knowing *when* a
-- schedule group was published, compared against when it was last touched.
--
-- schedule_groups.updated_at already exists but nothing has ever set it on
-- UPDATE — there is no updated_at trigger anywhere in this schema, and
-- POST/PATCH /api/schedule-groups don't include it in their write payload
-- either. That's fixed in the same change set as this migration (the PATCH
-- route now sets it explicitly), but it only covers edits to the
-- schedule_groups row itself. Staff overwhelmingly edit a published
-- schedule by adding/moving/deleting *sessions* under it, not by re-opening
-- the schedule's own settings form — and a session write touches the
-- `sessions`/`session_exceptions` tables, never schedule_groups. Without a
-- trigger, placing a session into a published schedule would leave that
-- schedule looking untouched forever.
--
-- DESIGN DECISIONS
--
-- 1. published_at is set only on the transition INTO 'published' (handled in
--    application code — see POST/PATCH /api/schedule-groups), not on every
--    write while already published. Only a deliberate (re-)publish should
--    move this timestamp; ordinary edits afterward are exactly what should
--    start showing as MODIFIED = updated_at > published_at.
--
-- 2. The session-write triggers only bump updated_at — they never touch
--    published_at. A trigger has no way to distinguish "staff editing a live
--    schedule" from "backfill/import touching many rows", so it stays a pure
--    timestamp bump, not a status change.
--
-- 3. session_exceptions has no schedule_group_id of its own (session_id ->
--    sessions.schedule_group_id), so its trigger resolves the parent through
--    sessions rather than duplicating the column.
--
-- Rollback: supabase/rollbacks/035_schedule_group_modified_tracking.sql
-- =============================================================================

ALTER TABLE schedule_groups ADD COLUMN published_at TIMESTAMPTZ;

-- Backfill: updated_at is the best available signal for existing published
-- rows (see decision above — nothing set it deliberately before now, so this
-- is an approximation, not a true publish timestamp). Newly published rows
-- from this point on get a real one from the API route.
UPDATE schedule_groups SET published_at = updated_at WHERE status = 'published';

CREATE OR REPLACE FUNCTION touch_schedule_group_on_session_write()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE schedule_groups
  SET updated_at = now()
  WHERE id = COALESCE(NEW.schedule_group_id, OLD.schedule_group_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_touch_schedule_group
AFTER INSERT OR UPDATE OR DELETE ON sessions
FOR EACH ROW EXECUTE FUNCTION touch_schedule_group_on_session_write();

CREATE OR REPLACE FUNCTION touch_schedule_group_on_exception_write()
RETURNS TRIGGER AS $$
DECLARE
  target_schedule_group_id UUID;
BEGIN
  SELECT schedule_group_id INTO target_schedule_group_id
  FROM sessions WHERE id = COALESCE(NEW.session_id, OLD.session_id);

  IF target_schedule_group_id IS NOT NULL THEN
    UPDATE schedule_groups SET updated_at = now() WHERE id = target_schedule_group_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_exceptions_touch_schedule_group
AFTER INSERT OR UPDATE OR DELETE ON session_exceptions
FOR EACH ROW EXECUTE FUNCTION touch_schedule_group_on_exception_write();
