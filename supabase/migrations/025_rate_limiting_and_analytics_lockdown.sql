-- =============================================================================
-- Migration 025: Rate limiting + analytics insert lockdown (SECURITY — HIGH)
-- =============================================================================
-- Two related abuse/cost findings.
--
-- H2 — `analytics_public_insert` was `FOR INSERT WITH CHECK (TRUE)`: any
-- anonymous holder of the publishable key could insert unlimited rows straight
-- into analytics_events via PostgREST, with an org_id of their choosing. That
-- is unbounded storage growth and analytics poisoning, and it bypasses the API
-- route entirely so no amount of route-level rate limiting would stop it.
--
-- The policy turns out to be unnecessary: /api/analytics/track inserts with the
-- service-role client (createAdminClient), which bypasses RLS. Nothing in the
-- app ever inserts analytics as anon. Dropping the policy closes the direct
-- path and leaves the intended one working.
--
-- H1 — the app had no rate limiting of any kind. The comment in
-- src/app/api/analytics/track/route.ts claimed it was "handled at the edge via
-- Vercel middleware or upstash"; it was not, and the Proxy matcher excludes
-- /api entirely so nothing ran in front of these routes.
--
-- WHY POSTGRES RATHER THAN UPSTASH/REDIS
-- The audit criterion is that limits survive restarts and are shared across
-- instances — an in-memory counter per serverless invocation is useless.
-- Postgres satisfies that and is infrastructure you already run, so the fix is
-- live the moment this migration is applied rather than waiting on a new vendor
-- account. The trade-off is a DB round trip per limited request. That is fine at
-- pre-launch volume; if /api/analytics/track ever gets hot, move that one
-- endpoint to Upstash — src/lib/rate-limit.ts is a single seam to swap behind.
--
-- Rollback: supabase/rollbacks/025_rate_limiting_and_analytics_lockdown.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- H2: remove the blanket anonymous insert grant.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "analytics_public_insert" ON analytics_events;

-- -----------------------------------------------------------------------------
-- H1: shared rate-limit counter store.
--
-- RLS is enabled with NO policies, so this table is reachable only by the
-- service role. check_rate_limit() is SECURITY DEFINER, so route handlers call
-- it through the admin client and never touch the table directly.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER     NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Supports the sweep below; not used by check_rate_limit itself (PK lookup).
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON rate_limits (window_start);

-- -----------------------------------------------------------------------------
-- Atomic fixed-window counter.
--
-- Returns TRUE when the request is allowed, FALSE when the caller has exceeded
-- p_limit within p_window_seconds.
--
-- The INSERT ... ON CONFLICT DO UPDATE is a single statement, so the row lock
-- Postgres takes on conflict makes the read-modify-write atomic. Two concurrent
-- requests for the same bucket cannot both read the same count and both pass.
--
-- Fixed window, not sliding: a caller can burst up to 2x the limit across a
-- window boundary. That is the standard trade-off for this shape and is
-- acceptable here — these limits exist to stop automated abuse, not to meter
-- billing precisely.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key            TEXT,
  p_limit          INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limits AS rl (bucket, count, window_start)
  VALUES (p_key, 1, NOW())
  ON CONFLICT (bucket) DO UPDATE
    SET count = CASE
          WHEN rl.window_start < NOW() - make_interval(secs => p_window_seconds)
          THEN 1
          ELSE rl.count + 1
        END,
        window_start = CASE
          WHEN rl.window_start < NOW() - make_interval(secs => p_window_seconds)
          THEN NOW()
          ELSE rl.window_start
        END
  RETURNING rl.count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

COMMENT ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) IS
  'Atomic fixed-window rate limiter. Returns TRUE if the request is allowed. '
  'Call via the service-role client only — the rate_limits table has RLS on '
  'with no policies, so anon/authenticated cannot read or reset counters.';

-- -----------------------------------------------------------------------------
-- Housekeeping: drop buckets nobody has touched in a day.
--
-- Not scheduled automatically — this project has no pg_cron setup. Either run
-- it periodically, or enable pg_cron in the Supabase dashboard and add:
--   SELECT cron.schedule('sweep-rate-limits', '0 * * * *',
--                        $$SELECT public.sweep_rate_limits()$$);
-- Left unscheduled the table grows by one row per distinct bucket, which is
-- bounded by distinct client IPs and is not urgent at current volume.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_rate_limits()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
