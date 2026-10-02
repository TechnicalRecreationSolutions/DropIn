-- Rollback for 067_embed_trusted_sites.sql
--
-- Drops the function and the column. Deploy the app code that predates 067
-- FIRST, or at the same moment: proxy.ts treats a missing function as
-- "unrestricted" (frame-ancestors *), so rolling back the database alone
-- reopens framing to every site rather than breaking anything.

DROP FUNCTION IF EXISTS public.widget_frame_ancestors(UUID);
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_embed_allowed_hosts_format;
ALTER TABLE organizations DROP COLUMN IF EXISTS embed_allowed_hosts;

-- 068 only replaces the CHECK above; dropping it by name covers both.
