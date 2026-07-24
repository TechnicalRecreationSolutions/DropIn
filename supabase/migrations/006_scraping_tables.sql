-- =============================================================================
-- Migration 006: Scraping Tables
-- =============================================================================
-- Supports automated data ingestion from external recreation platforms
-- (Xplor, ActiveNet, NextRec) via a scheduled scraping service.
--
-- Flow:
--   1. scraping_configs defines which URLs to scrape and how often
--   2. scraping_jobs tracks each run (status, results, error info)
--   3. scraping_conflicts records field-level diffs requiring human review
-- =============================================================================

CREATE TABLE scraping_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Optional: scope scraping to a specific facility
  facility_id     UUID REFERENCES facilities(id) ON DELETE SET NULL,
  -- The public-facing URL to scrape (e.g. the org's Xplor schedule page)
  source_url      TEXT NOT NULL,
  -- Platform identifier determines which scraping adapter is used
  platform        TEXT NOT NULL
                  CHECK (platform IN ('xplor', 'activenet', 'nextrec', 'generic')),
  -- Cron expression for scheduled runs (default: 3am daily)
  schedule_cron   TEXT NOT NULL DEFAULT '0 3 * * *',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scraping_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scraping_configs_members_crud"
  ON scraping_configs FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "scraping_configs_superadmin_all"
  ON scraping_configs FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- SCRAPING JOBS
-- One row per scraping run. Used for audit history and conflict review.
-- =============================================================================
CREATE TABLE scraping_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id       UUID NOT NULL REFERENCES scraping_configs(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  triggered_by    TEXT NOT NULL DEFAULT 'scheduler'
                  CHECK (triggered_by IN ('scheduler', 'manual')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  programs_found  INTEGER NOT NULL DEFAULT 0,
  sessions_found  INTEGER NOT NULL DEFAULT 0,
  conflicts_count INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  -- Full scraped payload retained for audit. Not shown to users.
  raw_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scraping_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scraping_jobs_members_read"
  ON scraping_jobs FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Job writes come from the scraping webhook handler (service role)

CREATE INDEX idx_scraping_jobs_config_id ON scraping_jobs (config_id);
CREATE INDEX idx_scraping_jobs_org_status ON scraping_jobs (org_id, status);

-- =============================================================================
-- SCRAPING CONFLICTS
-- Field-level diffs between scraped data and current DB values.
-- Staff review and resolve these via the conflict resolution UI.
-- =============================================================================
CREATE TABLE scraping_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES scraping_jobs(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('program', 'session')),
  -- NULL if the scraped entity doesn't exist in the DB yet (new entity)
  entity_id       UUID,
  -- Which field differs (e.g. 'name', 'cost_cents', 'dtstart')
  field_name      TEXT NOT NULL,
  current_value   TEXT,   -- Current value in DB (NULL for new entities)
  scraped_value   TEXT,   -- Value returned by the scraper
  -- NULL until resolved by org staff
  resolution      TEXT
                  CHECK (resolution IN ('accepted', 'rejected', 'ignored')),
  resolved_by     UUID REFERENCES auth.users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scraping_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conflicts_members_read_write"
  ON scraping_conflicts FOR ALL
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE INDEX idx_scraping_conflicts_job_id ON scraping_conflicts (job_id);

-- Partial index: fast lookup of unresolved conflicts per org (used for badge counts)
CREATE INDEX idx_scraping_conflicts_unresolved
  ON scraping_conflicts (org_id)
  WHERE resolution IS NULL;
