-- =============================================================================
-- ROLLBACK for Migration 042
-- =============================================================================
-- Puts session_templates.schedule_group_id back and drops the facility_id /
-- department_id pair.
--
-- LOSSY, and the one rollback in this directory that can fail halfway on
-- purpose. 042 threw the original schedule_group_id away, and the reverse
-- mapping does not exist: a template scoped to a facility (or to a department
-- inside it) may match several schedule groups, or none at all. The backfill
-- below picks the most recently created matching schedule group — the same
-- "closest reasonable owner" guess, not a restoration — and the SET NOT NULL
-- that follows is deliberately left to fail if any template had no candidate,
-- rather than quietly dropping those rows.
--
-- Look before running:
--
--   SELECT st.id, st.name, st.facility_id, st.department_id
--   FROM session_templates st
--   WHERE NOT EXISTS (
--     SELECT 1 FROM schedule_groups sg
--     WHERE sg.facility_id = st.facility_id
--       AND (st.department_id IS NULL OR sg.department_id = st.department_id)
--   );
--
-- Anything that lists there has to be reassigned or deleted by hand first, or
-- the SET NOT NULL aborts the transaction.
--
-- The duplicate-templates block in
-- src/app/api/schedule-groups/[id]/duplicate/route.ts (removed by 042) must be
-- restored alongside this, along with every facility_id/department_id reference
-- in the template UI and API routes.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

ALTER TABLE session_templates
  ADD COLUMN schedule_group_id UUID REFERENCES schedule_groups(id) ON DELETE CASCADE;

UPDATE session_templates st
SET schedule_group_id = (
  SELECT sg.id
  FROM schedule_groups sg
  WHERE sg.facility_id = st.facility_id
    AND (st.department_id IS NULL OR sg.department_id = st.department_id)
  ORDER BY sg.created_at DESC
  LIMIT 1
);

-- Fails loudly if the backfill left anything unmapped. That is the intended
-- behaviour — see the query in the header.
ALTER TABLE session_templates ALTER COLUMN schedule_group_id SET NOT NULL;

DROP INDEX IF EXISTS idx_session_templates_department_id;
DROP INDEX IF EXISTS idx_session_templates_facility_id;

ALTER TABLE session_templates
  DROP COLUMN department_id,
  DROP COLUMN facility_id;
