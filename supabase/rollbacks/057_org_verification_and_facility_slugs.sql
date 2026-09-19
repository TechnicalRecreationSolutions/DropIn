-- Rollback for migration 057. Restores the self-writable status/approved_at
-- columns and per-org facility slugs — both are the holes 057 closed.
-- Slugs renamed by 057's dedupe step (none on 2026-09-18) are left as they are.

DROP TRIGGER IF EXISTS organizations_guard_platform_columns ON organizations;
DROP FUNCTION IF EXISTS public.organizations_guard_platform_columns();

-- A view cannot drop a column through CREATE OR REPLACE.
DROP VIEW IF EXISTS public.organizations_public;
CREATE VIEW public.organizations_public AS
  SELECT id, name, slug, description, logo_url, website_url, city, province, country
  FROM organizations
  WHERE status = 'active';
ALTER VIEW public.organizations_public SET (security_invoker = false);
GRANT SELECT ON public.organizations_public TO anon, authenticated;

ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_slug_key;
ALTER TABLE facilities ADD CONSTRAINT facilities_org_id_slug_key UNIQUE (org_id, slug);
CREATE INDEX IF NOT EXISTS idx_facilities_slug ON facilities (slug);

-- approved_at values set by the backfill are kept; they are inert without 057.
