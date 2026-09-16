-- =============================================================================
-- ROLLBACK for Migration 049
-- =============================================================================
-- Recreates the facility_configurations table and spaces.configuration_id
-- exactly as migration 048 created them.
--
-- PARTIAL. This restores the *shape*, not the data. Every configuration row is
-- gone and every space comes back with configuration_id NULL. There is no
-- record anywhere of which lane belonged to which configuration, because 049
-- dropped the only copy.
--
-- Restoring this schema also restores the defect that caused its removal:
-- UNIQUE (facility_id, slug) from migration 012 still forbids two spaces named
-- "Lane 1", so a facility still cannot describe a long-course and a
-- short-course lane set. Anyone reaching for this file should read migration
-- 049's header first — the model was removed because it was wrong, not because
-- it was broken, and putting it back does not make it right.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

CREATE TABLE facility_configurations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id   UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, name)
);

ALTER TABLE facility_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facility_configurations_public_read"
  ON facility_configurations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM facilities f
      WHERE f.id = facility_configurations.facility_id AND f.is_published = TRUE
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

CREATE POLICY "facility_configurations_members_crud"
  ON facility_configurations FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "facility_configurations_superadmin_all"
  ON facility_configurations FOR ALL
  USING (public.is_superadmin());

CREATE INDEX idx_facility_configurations_facility_id
  ON facility_configurations (facility_id);
CREATE INDEX idx_facility_configurations_org_id
  ON facility_configurations (org_id);

ALTER TABLE spaces
  ADD COLUMN configuration_id UUID REFERENCES facility_configurations(id) ON DELETE SET NULL;

CREATE INDEX idx_spaces_configuration_id ON spaces (configuration_id);
