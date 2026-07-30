-- =============================================================================
-- Migration 012: Spaces
-- =============================================================================
-- Physical sub-locations within a facility (pool lanes, courts, studios, rinks)
-- that a session can be attached to. "Facility" was already taken for the
-- top-level physical location, so this new level is called "Space".
--
-- Mirrors schedule_groups' relationship to department: facility_id is the
-- mandatory anchor, department_id is optional, so orgs that skip the
-- department level entirely can still define spaces directly under a
-- facility (e.g. a single-department arena listing "Rink A" / "Rink B").
--
-- sessions.space_id is added as a nullable FK alongside the existing
-- location_detail free-text column, which is left untouched — imported
-- sessions have no way to resolve free-text against a real Space record,
-- so they keep writing location_detail as before. Manually
-- created/edited sessions can pick a real Space; display logic should prefer
-- the linked space's name and fall back to location_detail.
-- =============================================================================

CREATE TABLE spaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  department_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  capacity        INTEGER,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, slug)
);

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spaces_public_read_published"
  ON spaces FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE POLICY "spaces_members_crud"
  ON spaces FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "spaces_superadmin_all"
  ON spaces FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_spaces_facility_id ON spaces (facility_id);
CREATE INDEX idx_spaces_department_id ON spaces (department_id);
CREATE INDEX idx_spaces_org_id ON spaces (org_id);

-- =============================================================================
-- sessions.space_id — optional, coexists with location_detail (see note above)
-- =============================================================================
ALTER TABLE sessions
  ADD COLUMN space_id UUID REFERENCES spaces(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_space_id ON sessions (space_id);
