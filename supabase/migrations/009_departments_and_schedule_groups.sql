-- =============================================================================
-- Migration 009: Departments and Schedule Groups
-- =============================================================================
-- Real recreation orgs run multiple physical facilities, each offering
-- several departments (e.g. "Aquatics", "Fitness"), and a department can
-- have multiple named schedule groups (e.g. Aquatics: "Lane Swim" vs
-- "Swim Lessons"). Both levels are optional — programs.department_id and
-- programs.schedule_group_id are nullable, so an org that never creates a
-- department keeps working exactly as before this migration.
-- =============================================================================

-- =============================================================================
-- DEPARTMENTS
-- Org-defined category within a facility (not the shared platform-wide
-- sport_category taxonomy — each org names its own departments).
-- =============================================================================
CREATE TABLE departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, slug)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_public_read_published"
  ON departments FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE POLICY "departments_members_crud"
  ON departments FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "departments_superadmin_all"
  ON departments FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- SCHEDULE GROUPS
-- A named schedule within a department (e.g. "Lane Swim", "Swim Lessons").
-- Named "schedule_groups" rather than "schedules" to avoid colliding with
-- the weekly grid/view "schedule" terminology used throughout the app.
-- =============================================================================
CREATE TABLE schedule_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, slug)
);

ALTER TABLE schedule_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_groups_public_read_published"
  ON schedule_groups FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

CREATE POLICY "schedule_groups_members_crud"
  ON schedule_groups FOR ALL
  USING (org_id = ANY(public.user_org_ids()));

CREATE POLICY "schedule_groups_superadmin_all"
  ON schedule_groups FOR ALL
  USING (public.is_superadmin());

-- =============================================================================
-- PROGRAMS: optional department / schedule group assignment
-- Both nullable — facility_id remains the mandatory anchor. A program with
-- department_id and schedule_group_id both NULL is unchanged from today.
-- =============================================================================
ALTER TABLE programs
  ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN schedule_group_id UUID REFERENCES schedule_groups(id) ON DELETE SET NULL,
  ADD CONSTRAINT programs_schedule_group_requires_department
    CHECK (schedule_group_id IS NULL OR department_id IS NOT NULL);

-- Cross-table consistency (schedule_group's department matches this
-- program's department; department's facility matches this program's
-- facility) is validated at the API route layer, consistent with how
-- sport_category is validated in app code rather than a DB constraint.

CREATE INDEX idx_departments_facility_id ON departments (facility_id);
CREATE INDEX idx_departments_org_id ON departments (org_id);
CREATE INDEX idx_schedule_groups_department_id ON schedule_groups (department_id);
CREATE INDEX idx_schedule_groups_org_id ON schedule_groups (org_id);
CREATE INDEX idx_programs_department_id ON programs (department_id);
CREATE INDEX idx_programs_schedule_group_id ON programs (schedule_group_id);
