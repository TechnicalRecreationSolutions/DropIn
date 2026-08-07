-- =============================================================================
-- Migration 026: Narrow two over-broad public read policies (SECURITY — MEDIUM)
-- =============================================================================
-- Findings M1 and M2 in docs/SECURITY.md.
--
-- M2 — `orgs_public_read_active` was:
--        USING (status = 'active' OR id = ANY(user_org_ids()) OR is_superadmin())
--      RLS is row-level, never column-level, so "anyone may read active orgs"
--      meant anyone may read *every column* of them: email, phone,
--      address_line1, postal_code, and stripe_customer_id (added in 007).
--
--      Column-level GRANTs cannot fix this either. They apply per database role,
--      and an org member is the same `authenticated` role as any other logged-in
--      user — so a grant broad enough for a member to read their own org's
--      billing details is broad enough for a stranger to read everyone's.
--
--      The fix is therefore a projection, not a policy tweak: the base table
--      becomes members-only, and public discovery reads a view that exposes only
--      non-sensitive columns.
--
-- M1 — `widget_configs_public_read` was literally `USING (TRUE)`: any anonymous
--      caller could dump every row for every organisation. The genuinely
--      sensitive part is not the colours, it is `facility_id` / `department_id`
--      for facilities and departments that are **not published** — internal
--      identifiers for things the org has not made public. (Bare `org_id` is not
--      a leak: widget embeds are addressed as /widget/[orgId], so org ids are
--      public by construction.)
--
-- Rollback: supabase/rollbacks/026_narrow_public_read_policies.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- M2 — organizations
-- -----------------------------------------------------------------------------

-- Base table: members and superadmins only. The sole anonymous reader in the
-- app was src/app/widget/[orgId]/page.tsx selecting id/name/slug, which now
-- reads the view below.
DROP POLICY IF EXISTS "orgs_public_read_active" ON organizations;

CREATE POLICY "orgs_members_read"
  ON organizations FOR SELECT
  USING (id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Public projection. Deliberately a *definer* view (the PostgreSQL default,
-- i.e. security_invoker = false): it intentionally bypasses the members-only
-- policy above, and its own WHERE clause plus its column list are the access
-- control. Keep both tight — anything added to this SELECT list becomes world
-- readable.
--
-- Explicitly NOT exposed: email, phone, address_line1, postal_code,
-- stripe_customer_id, status, approved_at, approved_by.
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
    country
  FROM organizations
  WHERE status = 'active';

ALTER VIEW public.organizations_public SET (security_invoker = false);

COMMENT ON VIEW public.organizations_public IS
  'World-readable projection of active organizations. The base table is '
  'members-only (see orgs_members_read). Never add a contact or billing column '
  'here — this view has no row-level protection beyond its own WHERE clause.';

GRANT SELECT ON public.organizations_public TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- M1 — widget_configs
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "widget_configs_public_read" ON widget_configs;

-- Staff need their own org's configs whatever the publish state — the dashboard
-- widget editor reads configs for facilities that are still drafts.
CREATE POLICY "widget_configs_members_read"
  ON widget_configs FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Public: only configs whose scope is actually public. A config scoped to an
-- unpublished facility or department stays hidden, which is what stops the
-- table being an index of unreleased internal identifiers.
--
-- The EXISTS clauses evaluate under the caller's own RLS, which is what makes
-- this work without a SECURITY DEFINER helper: `facilities_public_read_published`
-- and `departments_public_read_published` already let anon see exactly the
-- published rows, so an unpublished parent simply produces no match.
CREATE POLICY "widget_configs_public_read_published"
  ON widget_configs FOR SELECT
  USING (
    (
      facility_id IS NULL
      OR EXISTS (
        SELECT 1 FROM facilities f
        WHERE f.id = widget_configs.facility_id AND f.is_published = TRUE
      )
    )
    AND (
      department_id IS NULL
      OR EXISTS (
        SELECT 1 FROM departments d
        WHERE d.id = widget_configs.department_id AND d.is_published = TRUE
      )
    )
  );
