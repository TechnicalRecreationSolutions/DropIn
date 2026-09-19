-- =============================================================================
-- Migration 057: Organization verification + one facility per public URL
-- =============================================================================
-- Anyone can sign up and name their organization anything. Inside the
-- dashboard that is harmless; the risk is the public surfaces — a fake
-- "Crystal Pool" in /find, or a facility page with the real centre's name and
-- a phishing website_url. Three changes, verified by
-- scripts/verify/verify-am.mjs:
--
-- 1. `approved_at` (unused since 001) becomes the verification mark, set by
--    the platform only. The directory lists a facility only when its org is
--    verified; an unverified org's facility pages still work (the centre's own
--    site may link to them) but are noindex. Verify with
--    `node scripts/verify-org.mjs <org-slug>`.
--
-- 2. Owners/admins could write ANY column of their own org: the
--    `orgs_admin_update` policy (002) is row-level, and /api/organizations'
--    field allow-list only binds callers that go through it. With the
--    publishable key an owner could set approved_at — or lift their own
--    `status = 'suspended'`. A trigger now rejects changes to status,
--    approved_at and approved_by from anyone but the service role / postgres /
--    a superadmin. A trigger, not column GRANTs: members and strangers share
--    the `authenticated` role (see 026's M2 note).
--
-- 3. Facility slugs were unique per org, but /facility/[slug] looks up by slug
--    alone with maybeSingle(). A second org publishing the same slug made that
--    lookup error (PGRST116) and the REAL centre's page stopped rendering —
--    reproduced against the dev server before this migration. Slugs are now
--    unique across all orgs; POST /api/facilities suffixes -2, -3 on a clash.
--
-- Rollback: supabase/rollbacks/057_org_verification_and_facility_slugs.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 + 2. Platform-owned columns on organizations
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.organizations_guard_platform_columns()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  -- current_user is the PostgREST role for API calls ('authenticated' / 'anon'
  -- / 'service_role') and 'postgres' in the SQL editor.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') OR public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'status, approved_at and approved_by are set by the platform, not the organization'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_guard_platform_columns ON organizations;
CREATE TRIGGER organizations_guard_platform_columns
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_guard_platform_columns();

COMMENT ON COLUMN organizations.approved_at IS
  'Set when the platform has confirmed this account really runs the organization '
  'it names (migration 057). Gates directory listing and search indexing. '
  'Platform-only: organizations_guard_platform_columns rejects member writes.';

-- A boolean, appended (CREATE OR REPLACE VIEW can only add columns at the end).
-- Not the timestamp or approver: whether an org is verified is public by
-- design — the directory is built on it — who approved it and when is not.
CREATE OR REPLACE VIEW public.organizations_public AS
  SELECT
    id,
    name,
    slug,
    description,
    logo_url,
    website_url,
    city,
    province,
    country,
    approved_at IS NOT NULL AS is_verified
  FROM organizations
  WHERE status = 'active';

ALTER VIEW public.organizations_public SET (security_invoker = false);

-- Backfill: every org that has a facility in the directory today, so applying
-- this does not empty /find. On 2026-09-18 that was exactly one org
-- (Technical Recreation Solutions). Review before applying elsewhere:
--   SELECT DISTINCT o.name FROM organizations o JOIN facilities f ON f.org_id = o.id
--    WHERE f.is_published AND f.listed_in_directory;
UPDATE organizations o
   SET approved_at = NOW()
 WHERE o.approved_at IS NULL
   AND EXISTS (
     SELECT 1 FROM facilities f
      WHERE f.org_id = o.id AND f.is_published AND f.listed_in_directory
   );

-- -----------------------------------------------------------------------------
-- 3. Facility slugs unique across all orgs
-- -----------------------------------------------------------------------------

-- Resolve any existing clash before the index can be built. The keeper is a
-- verified org's facility, then the oldest; the rest get -2, -3, ... (none
-- existed on 2026-09-18). A renamed loser's page was already not rendering.
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT f.id, f.slug
      FROM (
        SELECT f.id, f.slug,
               ROW_NUMBER() OVER (
                 PARTITION BY f.slug
                 ORDER BY (o.approved_at IS NULL), f.created_at, f.id
               ) AS rn
          FROM facilities f JOIN organizations o ON o.id = f.org_id
      ) f
     WHERE f.rn > 1
  LOOP
    n := 2;
    LOOP
      candidate := r.slug || '-' || n;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM facilities WHERE slug = candidate);
      n := n + 1;
    END LOOP;
    UPDATE facilities SET slug = candidate WHERE id = r.id;
  END LOOP;
END;
$$;

-- The global constraint implies the per-org one, so that one goes.
ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_org_id_slug_key;
ALTER TABLE facilities ADD CONSTRAINT facilities_slug_key UNIQUE (slug);

-- idx_facilities_slug (003) is now redundant with the constraint's index.
DROP INDEX IF EXISTS idx_facilities_slug;
