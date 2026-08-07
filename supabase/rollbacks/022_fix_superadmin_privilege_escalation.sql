-- =============================================================================
-- ROLLBACK for Migration 022
-- =============================================================================
-- ⚠️  THIS RESTORES A CRITICAL VULNERABILITY.
--
-- Running this returns is_superadmin() to reading raw_user_meta_data, which any
-- authenticated user can write via auth.updateUser(). That re-opens self-service
-- platform-admin escalation across every tenant table.
--
-- Only run this if migration 022 broke superadmin access and you need the
-- previous behaviour back for a few minutes while you re-grant the flag properly
-- in raw_app_meta_data. Re-apply 022 immediately afterwards.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (raw_user_meta_data->>'role') = 'superadmin'
     FROM auth.users WHERE id = auth.uid()),
    FALSE
  );
$$;
