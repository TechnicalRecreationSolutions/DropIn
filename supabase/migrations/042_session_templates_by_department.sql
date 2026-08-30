-- =============================================================================
-- Migration 042: Session templates scoped to department, not schedule
-- =============================================================================
-- session_templates.schedule_group_id meant two schedules in the same
-- department (e.g. "Spring Swim" and "Fall Swim" under Aquatics) couldn't
-- share a template — staff had to recreate "Adult Lengths" from scratch for
-- each one, and duplicating a schedule had to copy its templates over as a
-- workaround (see src/app/api/schedule-groups/[id]/duplicate/route.ts, whose
-- copy-block is removed alongside this migration).
--
-- Replaces schedule_group_id with facility_id (NOT NULL) + department_id
-- (nullable), mirroring spaces.department_id exactly (012_spaces.sql):
-- NULL means "available to every schedule in the facility", including
-- facility-direct schedules that belong to no department at all. A real
-- department_id scopes the template to schedules in that department only.
--
-- No RLS policy changes: session_templates' policies (024) are already
-- org-scoped only, not facility/department-scoped.
-- =============================================================================

ALTER TABLE session_templates
  ADD COLUMN facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

UPDATE session_templates st SET
  facility_id = sg.facility_id,
  department_id = sg.department_id
FROM schedule_groups sg
WHERE sg.id = st.schedule_group_id;

ALTER TABLE session_templates ALTER COLUMN facility_id SET NOT NULL;

ALTER TABLE session_templates DROP COLUMN schedule_group_id;

CREATE INDEX idx_session_templates_facility_id ON session_templates (facility_id);
CREATE INDEX idx_session_templates_department_id ON session_templates (department_id);
