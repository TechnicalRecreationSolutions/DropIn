-- Rollback for 053_schedule_rate_limit_sweep.sql.
--
-- Removes the job only. The pg_cron extension is left enabled: other jobs may
-- depend on it, and it may have been switched on from the dashboard before 053
-- ran. Guarded so it is a no-op when the job (or pg_cron itself) is absent.
--
-- The two checks are nested, not joined with AND: PL/pgSQL plans a whole
-- condition as one query, so a reference to cron.job fails to parse when
-- pg_cron is not installed, even behind a false first operand.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-rate-limits') THEN
      PERFORM cron.unschedule('sweep-rate-limits');
    END IF;
  END IF;
END;
$$;
