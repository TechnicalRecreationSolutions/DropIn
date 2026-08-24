-- =============================================================================
-- Migration 037: Schedule Week Reviews
-- =============================================================================
-- schedule_groups.status (draft/published, migration 033) answers "is this
-- recurring schedule template live at all" — it says nothing about whether
-- any individual week of a published schedule has actually been looked at.
-- Staff want admin review to happen week by week, not once for the whole
-- schedule: this table adds that as a second, separate layer on top of the
-- existing draft/published status, which is untouched by this migration.
--
-- There is no persisted "week" entity — weeks are computed on the fly from
-- each session's RRULE (migration 033's own decision to extend RRULE rather
-- than build one) — so this table is sparse by design. A row only exists
-- once a week has been explicitly reviewed; a week with no row is implicitly
-- 'pending'. That avoids having to backfill/maintain a row for every future
-- week of every published schedule forever.
--
-- Visibility: an un-approved week of a published schedule is hidden from the
-- public schedule page and widget. That filtering happens in application
-- code at occurrence-expansion time (src/app/api/sessions/expand/route.ts),
-- not via a row-level RLS policy on `sessions` — a session is a recurring
-- template, not a per-week row, so there is nothing at that granularity for
-- RLS to gate directly. This table's own read policy still matters: it's
-- what lets that route (running as the anonymous/public caller) see review
-- status at all. Staff always see every week regardless of review status —
-- the expand route only applies the filter to callers outside the org that
-- owns the schedule.
--
-- Rollback: supabase/rollbacks/037_schedule_week_reviews.sql
-- =============================================================================

CREATE TABLE schedule_week_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_group_id UUID NOT NULL REFERENCES schedule_groups(id) ON DELETE CASCADE,
  -- Sunday of the week, same convention as getWeekStart/sessionWeekStart
  -- (src/lib/utils/dates.ts) — weekStartsOn: 0.
  week_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'needs_changes')),
  note TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_group_id, week_start)
);

CREATE INDEX idx_schedule_week_reviews_group_week
  ON schedule_week_reviews (schedule_group_id, week_start);

ALTER TABLE schedule_week_reviews ENABLE ROW LEVEL SECURITY;

-- Any org member can see review state (dashboard display); public/anon can
-- read it too, but only for schedules that are actually published — the
-- expand route needs this to know which weeks to hide, and the review state
-- of a draft schedule's weeks isn't meaningful to anyone outside the org.
CREATE POLICY "schedule_week_reviews_read"
  ON schedule_week_reviews FOR SELECT
  USING (
    org_id = ANY(public.user_org_ids())
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM schedule_groups sg
      WHERE sg.id = schedule_week_reviews.schedule_group_id AND sg.status = 'published'
    )
  );

-- Reviewing/approving a week is a schedule-management action, same tier as
-- publishing the schedule itself — org_can_manage() (owner|admin), same
-- helper migration 024 introduced for exactly this class of write.
CREATE POLICY "schedule_week_reviews_managers_write"
  ON schedule_week_reviews FOR ALL
  USING (public.org_can_manage(org_id))
  WITH CHECK (public.org_can_manage(org_id));
