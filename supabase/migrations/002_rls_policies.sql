-- =============================================================================
-- Migration 002: Row Level Security Policies
-- =============================================================================
-- Defines who can read and write each table.
--
-- Security model:
--   Public (anon key)    → can only read published/active data
--   Org staff            → CRUD on their own org's data only
--   Superadmin           → full access to all data
--
-- IMPORTANT: With RLS enabled, no policy = deny all. Policies here are
-- additive — a user must match at least one policy to access a row.
-- =============================================================================

-- =============================================================================
-- Helper functions
-- =============================================================================

-- Returns all org IDs the current user is a member of.
-- Used in policy USING clauses to scope staff access.
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    ARRAY(SELECT org_id FROM org_memberships WHERE user_id = auth.uid()),
    '{}'::UUID[]
  );
$$;

-- Returns true if the current user is a platform superadmin.
-- Superadmin role is set via service role client only — never via UI.
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (raw_user_meta_data->>'role') = 'superadmin'
     FROM auth.users WHERE id = auth.uid()),
    FALSE
  );
$$;

-- Returns the current user's role in a given org.
CREATE OR REPLACE FUNCTION public.org_role(p_org_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT role FROM org_memberships
  WHERE user_id = auth.uid() AND org_id = p_org_id
  LIMIT 1;
$$;

-- =============================================================================
-- ORGANIZATIONS
-- =============================================================================

-- Anyone can discover active organizations (powers public search)
CREATE POLICY "orgs_public_read_active"
  ON organizations FOR SELECT
  USING (status = 'active' OR id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Org owners and admins can update their own org profile
CREATE POLICY "orgs_admin_update"
  ON organizations FOR UPDATE
  USING (
    id = ANY(public.user_org_ids())
    AND public.org_role(id) IN ('owner', 'admin')
  );

-- Only superadmin can create or delete orgs (done via admin panel)
CREATE POLICY "orgs_superadmin_all"
  ON organizations FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- ORG MEMBERSHIPS
-- =============================================================================

-- Members can see who else is in their org
CREATE POLICY "memberships_read_own_org"
  ON org_memberships FOR SELECT
  USING (org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Org admins can invite (INSERT) and remove (DELETE) members
-- They cannot change their own role or create owners (enforced in API routes)
CREATE POLICY "memberships_admin_write"
  ON org_memberships FOR INSERT
  WITH CHECK (
    org_id = ANY(public.user_org_ids())
    AND public.org_role(org_id) IN ('owner', 'admin')
    AND role != 'owner'   -- Owner role is set only at org creation
  );

CREATE POLICY "memberships_admin_delete"
  ON org_memberships FOR DELETE
  USING (
    org_id = ANY(public.user_org_ids())
    AND public.org_role(org_id) IN ('owner', 'admin')
  );

CREATE POLICY "memberships_superadmin_all"
  ON org_memberships FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- STAFF INVITATIONS
-- =============================================================================

-- Org admins can manage invitations for their org
CREATE POLICY "invitations_admin_all"
  ON staff_invitations FOR ALL
  USING (
    org_id = ANY(public.user_org_ids())
    AND public.org_role(org_id) IN ('owner', 'admin')
  );

-- Unauthenticated users can look up an invitation by token (accept flow)
CREATE POLICY "invitations_public_read_by_token"
  ON staff_invitations FOR SELECT
  USING (accepted_at IS NULL AND expires_at > NOW());

CREATE POLICY "invitations_superadmin_all"
  ON staff_invitations FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- FACILITIES
-- =============================================================================

-- Published facilities are publicly searchable
CREATE POLICY "facilities_public_read_published"
  ON facilities FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Org members can fully manage their facilities
CREATE POLICY "facilities_members_crud"
  ON facilities FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "facilities_superadmin_all"
  ON facilities FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- PROGRAMS
-- =============================================================================

-- Published programs are publicly readable
CREATE POLICY "programs_public_read_published"
  ON programs FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- Org members can fully manage their programs
CREATE POLICY "programs_members_crud"
  ON programs FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "programs_superadmin_all"
  ON programs FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- SESSIONS
-- =============================================================================

-- Active sessions for published programs are publicly readable
CREATE POLICY "sessions_public_read_active"
  ON sessions FOR SELECT
  USING (
    (
      is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM programs p
        WHERE p.id = sessions.program_id AND p.is_published = TRUE
      )
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

-- Org members can manage their sessions
CREATE POLICY "sessions_members_crud"
  ON sessions FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "sessions_superadmin_all"
  ON sessions FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- SESSION EXCEPTIONS
-- =============================================================================

-- Public can read exceptions for publicly visible sessions
CREATE POLICY "exceptions_public_read"
  ON session_exceptions FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN programs p ON p.id = s.program_id
      WHERE s.id = session_exceptions.session_id
      AND s.is_active = TRUE AND p.is_published = TRUE
    )
  );

CREATE POLICY "exceptions_members_crud"
  ON session_exceptions FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "exceptions_superadmin_all"
  ON session_exceptions FOR ALL
  USING (public.is_superadmin());
