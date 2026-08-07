-- =============================================================================
-- Migration 022: Fix superadmin privilege escalation (SECURITY — CRITICAL)
-- =============================================================================
-- `public.is_superadmin()` read the superadmin flag from
-- `auth.users.raw_user_meta_data`. That column is the storage behind Supabase's
-- `user_metadata`, which **the user writes themselves** — a plain
-- `supabase.auth.updateUser({ data: { role: 'superadmin' } })` from the browser
-- sets it, using nothing but a valid session and the publishable key.
--
-- Migration 002 asserted "Superadmin role is set via service role client only —
-- never via UI." That was an assumption about how the value would be written,
-- not a constraint on who could write it.
--
-- Because 15 `FOR ALL` policies across every tenant table are gated on
-- is_superadmin(), any authenticated user could grant themselves unrestricted
-- read/write over every organization's data.
--
-- The fix is to read `raw_app_meta_data` instead. That column backs
-- `app_metadata`, which GoTrue permits only the service role / Admin API to
-- write — it is specifically the field intended for authorization claims.
--
-- The function keeps SECURITY DEFINER (it must, to read auth.users) and its
-- pinned search_path. Only the source column changes.
--
-- NOTE ON EXISTING SUPERADMINS: any account whose flag currently lives in
-- user_metadata loses superadmin the moment this runs. That is the point — that
-- flag is untrusted. To grant it legitimately, use the service role:
--
--   -- via the Admin API (preferred):
--   supabase.auth.admin.updateUserById(userId, {
--     app_metadata: { role: 'superadmin' }
--   })
--
--   -- or directly, with the service-role connection:
--   UPDATE auth.users
--      SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
--                              || '{"role":"superadmin"}'::jsonb
--    WHERE email = 'you@example.com';
--
-- Rollback: supabase/rollbacks/022_fix_superadmin_privilege_escalation.sql
-- (restores the vulnerable definition — for emergency use only).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (raw_app_meta_data->>'role') = 'superadmin'
     FROM auth.users WHERE id = auth.uid()),
    FALSE
  );
$$;

COMMENT ON FUNCTION public.is_superadmin() IS
  'Platform superadmin check. Reads raw_app_meta_data (service-role writable only). '
  'NEVER change this to raw_user_meta_data — that column is user-writable via '
  'auth.updateUser() and would let any account self-grant platform admin.';
