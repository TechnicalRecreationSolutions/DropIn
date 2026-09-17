-- =============================================================================
-- Migration 053: Schedule the rate-limit sweep
-- =============================================================================
-- `sweep_rate_limits()` (migration 025) deletes rate_limits rows older than a
-- day, but nothing ever called it. 025 left scheduling as a manual step and it
-- never happened: on 2026-09-16 the table held 258 rows, 249 of them stale,
-- a few still keyed by raw IP addresses (SECURITY.md → L5). The sweep was run
-- once by hand on 2026-09-17. This makes it hourly.
--
-- pg_cron runs SQL on a schedule inside the database. Its jobs live in the
-- `cron` schema, which only exists once the extension is created, so the
-- extension is created here rather than assumed. The Supabase dashboard switch
-- (Integrations → Cron) does the same thing; running this after flipping it
-- is harmless.
--
-- Safe to run more than once:
--  - `IF NOT EXISTS` skips an extension that is already enabled;
--  - `cron.schedule` with a job name replaces an existing job of that name
--    instead of adding a second one.
--
-- pg_cron must live in `pg_catalog` (its control file fixes the schema), so it
-- is named explicitly; asking for any other schema is an error.
--
-- Rollback: supabase/rollbacks/053_schedule_rate_limit_sweep.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Every hour, on the hour. The function is SECURITY DEFINER (025) and the job
-- runs as the role that scheduled it.
SELECT cron.schedule(
  'sweep-rate-limits',
  '0 * * * *',
  $$SELECT public.sweep_rate_limits()$$
);

-- Check it afterwards:
--   SELECT jobid, jobname, schedule, command, active
--     FROM cron.job WHERE jobname = 'sweep-rate-limits';
-- and, after the next full hour:
--   SELECT status, return_message, start_time
--     FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sweep-rate-limits')
--     ORDER BY start_time DESC LIMIT 5;
