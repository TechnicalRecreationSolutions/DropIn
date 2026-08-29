-- =============================================================================
-- Migration 041: Widget analytics expansion (clicks, view type, duration)
-- =============================================================================
-- The "Widget views (30d)" stat card on the dashboard overview only ever
-- counted `widget_view` rows — the other three event types in the original
-- CHECK constraint (005_analytics_tables.sql) were never fired by any caller,
-- and nothing tracked which session a visitor clicked, which template
-- (grid/list/map/floorplan/board) they were looking at, or how long they
-- stayed. This migration adds the columns the new /dashboard/analytics page
-- and its instrumentation need:
--
--   view_template  — which template rendered for a widget_view/facility_view/
--                     view_change row (grid, list, map, floorplan, board)
--   duration_ms    — time-on-page for a `session_duration` row, sent via
--                     sendBeacon on unload/visibility-hidden
--
-- and a `view_change` + `session_duration` event type, for template switches
-- and end-of-visit duration respectively.
-- =============================================================================

ALTER TABLE analytics_events
  ADD COLUMN view_template TEXT
    CHECK (view_template IN ('grid', 'list', 'map', 'floorplan', 'board')),
  ADD COLUMN duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0);

ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN (
    'widget_view',       -- Widget iframe loaded (fired once per widget.js load)
    'program_click',     -- Visitor opened a session's detail modal
    'facility_view',     -- Public facility detail page viewed
    'schedule_view',     -- Weekly schedule viewed on public site (reserved, unused)
    'view_change',       -- Visitor switched template (grid/list/map/floorplan/board)
    'session_duration'   -- Time-on-page for one visit, sent on unload
  ));

COMMENT ON COLUMN analytics_events.view_template IS
  'Template shown for widget_view/facility_view/view_change rows. NULL for program_click and session_duration.';
COMMENT ON COLUMN analytics_events.duration_ms IS
  'Time-on-page in milliseconds, set only on session_duration rows.';

-- The daily summary view predates these columns; rebuild it so per-template
-- and duration data can be aggregated the same way view counts already are.
DROP MATERIALIZED VIEW analytics_daily_summary;

CREATE MATERIALIZED VIEW analytics_daily_summary AS
  SELECT
    org_id,
    event_type,
    schedule_group_id,
    facility_id,
    view_template,
    DATE(occurred_at) AS day,
    COUNT(*) AS event_count,
    AVG(duration_ms) FILTER (WHERE event_type = 'session_duration') AS avg_duration_ms
  FROM analytics_events
  GROUP BY org_id, event_type, schedule_group_id, facility_id, view_template, DATE(occurred_at);

CREATE INDEX idx_analytics_daily_summary_org_day
  ON analytics_daily_summary (org_id, day DESC);
