-- =============================================================================
-- ROLLBACK for Migration 041
-- =============================================================================
-- Returns analytics_events to its pre-041 shape: no view_template, no
-- duration_ms, the four original event types from 005, and the daily summary
-- materialized view as migration 011 last rebuilt it (grouped by
-- schedule_group_id, not program_id — 011 renamed that column).
--
-- LOSSY, in two ways:
--   * Every `view_change` and `session_duration` row is DELETED. The 005
--     constraint has no room for them, and they only mean anything to the
--     /dashboard/analytics page this rollback is undoing. Count them first:
--
--       SELECT event_type, COUNT(*) FROM analytics_events
--       WHERE event_type IN ('view_change', 'session_duration')
--       GROUP BY event_type;
--
--   * view_template and duration_ms go with the columns, including the
--     per-template breakdown for rows that are otherwise kept.
--
-- /dashboard/analytics and the instrumentation that fires these events
-- (sendBeacon on unload, template-switch tracking) must be reverted alongside
-- this — they will error or write rows the constraint rejects, not silently
-- degrade.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

-- The view selects view_template, so it has to go before the column does.
DROP MATERIALIZED VIEW analytics_daily_summary;

ALTER TABLE analytics_events
  DROP COLUMN view_template,
  DROP COLUMN duration_ms;

DELETE FROM analytics_events
WHERE event_type IN ('view_change', 'session_duration');

ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN (
    'widget_view',    -- Widget iframe loaded
    'program_click',  -- User clicked a program in the widget
    'facility_view',  -- Public facility detail page viewed
    'schedule_view'   -- Weekly schedule viewed on public site
  ));

CREATE MATERIALIZED VIEW analytics_daily_summary AS
  SELECT
    org_id,
    event_type,
    schedule_group_id,
    facility_id,
    DATE(occurred_at) AS day,
    COUNT(*) AS event_count
  FROM analytics_events
  GROUP BY org_id, event_type, schedule_group_id, facility_id, DATE(occurred_at);

CREATE INDEX idx_analytics_daily_summary_org_day
  ON analytics_daily_summary (org_id, day DESC);
