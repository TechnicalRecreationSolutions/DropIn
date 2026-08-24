-- =============================================================================
-- ROLLBACK for Migration 037
-- =============================================================================
-- ⚠️  Destroys every recorded week review (approved/needs_changes/notes,
-- who reviewed and when). Every week reverts to "pending" by definition,
-- since that state was never stored — there's no data loss to reconcile
-- there, only the review history itself.
--
-- Requires reverting the application code that reads/writes
-- schedule_week_reviews, or the dashboard will 500/404 on:
--   - src/app/api/schedule-groups/[id]/week-reviews/route.ts
--   - src/hooks/useWeekReviews.ts
--   - src/components/schedule-command/WeekListPanel.tsx (per-week pill)
--   - src/components/schedule-command/WeekReviewBar.tsx
--   - src/app/api/sessions/expand/route.ts (week-approval filtering)
--   - src/types/database.types.ts (schedule_week_reviews table block)
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no
-- migration runner picks it up.
-- =============================================================================

DROP POLICY IF EXISTS "schedule_week_reviews_managers_write" ON schedule_week_reviews;
DROP POLICY IF EXISTS "schedule_week_reviews_read" ON schedule_week_reviews;
DROP INDEX IF EXISTS idx_schedule_week_reviews_group_week;
DROP TABLE IF EXISTS schedule_week_reviews;
