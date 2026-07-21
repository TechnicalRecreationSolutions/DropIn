-- =============================================================================
-- Migration 005: Analytics & Widget Config Tables
-- =============================================================================

-- =============================================================================
-- WIDGET CONFIGS
-- Each org has exactly one widget config (1:1 with organizations).
-- Created with defaults when an org activates; updated via the widget
-- configurator in the org dashboard.
-- =============================================================================
CREATE TABLE widget_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  primary_color     TEXT NOT NULL DEFAULT '#0066CC',
  secondary_color   TEXT NOT NULL DEFAULT '#FFFFFF',
  font_family       TEXT NOT NULL DEFAULT 'Inter',
  show_cost         BOOLEAN NOT NULL DEFAULT TRUE,
  show_location     BOOLEAN NOT NULL DEFAULT TRUE,
  show_age_group    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Time range shown in the embedded schedule (24h format)
  time_range_start  TIME NOT NULL DEFAULT '06:00',
  time_range_end    TIME NOT NULL DEFAULT '22:00',
  -- NULL = show all published programs; otherwise filter to these IDs
  program_ids       UUID[],
  custom_title      TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE widget_configs ENABLE ROW LEVEL SECURITY;

-- Public can read widget config (needed to render the widget without auth)
CREATE POLICY "widget_configs_public_read"
  ON widget_configs FOR SELECT
  USING (TRUE);

-- Only org members can update their widget config
CREATE POLICY "widget_configs_members_update"
  ON widget_configs FOR UPDATE
  USING (org_id = ANY(auth.user_org_ids()));

CREATE POLICY "widget_configs_superadmin_all"
  ON widget_configs FOR ALL
  USING (auth.is_superadmin());

-- =============================================================================
-- ANALYTICS EVENTS
-- Lightweight click/view tracking for the embedded widget and public pages.
-- Privacy notes:
--   - IP addresses are SHA-256 hashed with a daily rotating salt before storage
--   - No PII is collected
--   - User agents stored for device-type aggregation only
-- =============================================================================
CREATE TABLE analytics_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL
                CHECK (event_type IN (
                  'widget_view',    -- Widget iframe loaded
                  'program_click',  -- User clicked a program in the widget
                  'facility_view',  -- Public facility detail page viewed
                  'schedule_view'   -- Weekly schedule viewed on public site
                )),
  program_id    UUID REFERENCES programs(id) ON DELETE SET NULL,
  facility_id   UUID REFERENCES facilities(id) ON DELETE SET NULL,
  referrer_url  TEXT,
  user_agent    TEXT,
  -- SHA-256(ip_address + daily_salt) — never the raw IP
  ip_hash       TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Widget tracking: public INSERT is required (anonymous widget viewers)
-- Rate limiting is enforced at the API route level, not here.
CREATE POLICY "analytics_public_insert"
  ON analytics_events FOR INSERT
  WITH CHECK (TRUE);

-- Org staff can read their own analytics
CREATE POLICY "analytics_members_read"
  ON analytics_events FOR SELECT
  USING (org_id = ANY(auth.user_org_ids()) OR auth.is_superadmin());

-- =============================================================================
-- ANALYTICS DAILY SUMMARY (materialized view)
-- Pre-aggregated for dashboard charts. Refreshed nightly via Edge Function.
-- =============================================================================
CREATE MATERIALIZED VIEW analytics_daily_summary AS
  SELECT
    org_id,
    event_type,
    program_id,
    facility_id,
    DATE(occurred_at) AS day,
    COUNT(*) AS event_count
  FROM analytics_events
  GROUP BY org_id, event_type, program_id, facility_id, DATE(occurred_at);

CREATE INDEX idx_analytics_daily_summary_org_day
  ON analytics_daily_summary (org_id, day DESC);

-- Raw events index for org dashboard time-series queries
CREATE INDEX idx_analytics_events_org_time
  ON analytics_events (org_id, occurred_at DESC);
