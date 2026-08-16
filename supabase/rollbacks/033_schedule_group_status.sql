-- =============================================================================
-- ROLLBACK for Migration 033
-- =============================================================================
-- ⚠️  Destroys any starts_on/ends_on staff have entered since this migration
-- ran, and collapses 'draft'/'published' back down to a boolean — a row that
-- was set to 'published' with no dates rolls back to is_published = TRUE
-- exactly as it would have read before this migration, which is correct, but
-- any 'draft' vs future 'in_review' distinction (if that was ever added after
-- this shipped) would silently collapse to is_published = FALSE.
--
-- Requires reverting the application code that reads `status`/`starts_on`/
-- `ends_on` on schedule_groups, or the dashboard will 500 on the schedule
-- form and every page listed below:
--   - src/components/schedule-group/ScheduleGroupForm.tsx
--   - both schedule-groups/[scheduleGroupId]/edit/page.tsx routes
--   - src/components/schedule-command/types.ts + ScopePicker.tsx
--   - src/app/(dashboard)/dashboard/schedule/page.tsx
--   - src/hooks/useNavTree.ts + src/app/api/nav-tree/route.ts
--   - src/app/(dashboard)/dashboard/page.tsx
--   - src/lib/brochure/candidates.ts
--   - src/types/database.types.ts
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP INDEX IF EXISTS idx_schedule_groups_facility_status_dates;

ALTER TABLE schedule_groups ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE schedule_groups SET is_published = (status = 'published');

DROP POLICY "schedule_groups_public_read_published" ON schedule_groups;
CREATE POLICY "schedule_groups_public_read_published"
  ON schedule_groups FOR SELECT
  USING (is_published = TRUE OR org_id = ANY(public.user_org_ids()) OR public.is_superadmin());

-- The four dependent policies 033 pointed at status = 'published' — restored
-- to their original is_published = TRUE form (011, 020, 028) before status
-- is dropped below.
DROP POLICY "sessions_public_read_active" ON sessions;
CREATE POLICY "sessions_public_read_active"
  ON sessions FOR SELECT
  USING (
    (
      is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM schedule_groups sg
        WHERE sg.id = sessions.schedule_group_id AND sg.is_published = TRUE
      )
    )
    OR org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
  );

DROP POLICY "exceptions_public_read" ON session_exceptions;
CREATE POLICY "exceptions_public_read"
  ON session_exceptions FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_exceptions.session_id
      AND s.is_active = TRUE AND sg.is_published = TRUE
    )
  );

DROP POLICY "session_spaces_public_read" ON session_spaces;
CREATE POLICY "session_spaces_public_read"
  ON session_spaces FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_spaces.session_id
      AND s.is_active = TRUE AND sg.is_published = TRUE
    )
  );

DROP POLICY "session_features_public_read" ON session_features;
CREATE POLICY "session_features_public_read"
  ON session_features FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM sessions s
      JOIN schedule_groups sg ON sg.id = s.schedule_group_id
      WHERE s.id = session_features.session_id
        AND s.is_active = TRUE
        AND sg.is_published = TRUE
    )
  );

ALTER TABLE schedule_groups
  DROP CONSTRAINT IF EXISTS schedule_groups_dates_ordered,
  DROP COLUMN status,
  DROP COLUMN ends_on,
  DROP COLUMN starts_on;
