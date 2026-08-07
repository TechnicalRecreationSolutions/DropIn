-- =============================================================================
-- ROLLBACK for Migration 025
-- =============================================================================
-- ⚠️  Re-opens anonymous unbounded INSERT into analytics_events and removes the
-- rate-limit store that src/lib/rate-limit.ts depends on.
--
-- IMPORTANT: checkRateLimit() fails OPEN — if check_rate_limit() is missing it
-- logs and allows the request. So running this rollback silently disables rate
-- limiting rather than breaking the routes. Revert the application code too if
-- you want the limiter gone deliberately.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

CREATE POLICY "analytics_public_insert"
  ON analytics_events FOR INSERT
  WITH CHECK (TRUE);

DROP FUNCTION IF EXISTS public.sweep_rate_limits();
DROP FUNCTION IF EXISTS public.check_rate_limit(TEXT, INTEGER, INTEGER);
DROP TABLE IF EXISTS rate_limits;
