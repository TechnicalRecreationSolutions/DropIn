-- =============================================================================
-- ROLLBACK for Migration 026
-- =============================================================================
-- ⚠️  Restores anonymous read access to every column of every active
-- organization — including email, phone, address_line1, postal_code and
-- stripe_customer_id — and to every widget_configs row, including the
-- facility/department ids of unpublished content.
--
-- Requires reverting src/app/widget/[orgId]/page.tsx to query `organizations`
-- instead of `organizations_public`, or the widget will break once the view is
-- dropped.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP POLICY IF EXISTS "widget_configs_public_read_published" ON widget_configs;
DROP POLICY IF EXISTS "widget_configs_members_read" ON widget_configs;
CREATE POLICY "widget_configs_public_read"
  ON widget_configs FOR SELECT
  USING (TRUE);

DROP VIEW IF EXISTS public.organizations_public;

DROP POLICY IF EXISTS "orgs_members_read" ON organizations;
CREATE POLICY "orgs_public_read_active"
  ON organizations FOR SELECT
  USING (status = 'active' OR id = ANY(public.user_org_ids()) OR public.is_superadmin());
