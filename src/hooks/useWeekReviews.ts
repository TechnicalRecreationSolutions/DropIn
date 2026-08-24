"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { localDateString } from "@/lib/utils/dates";
import type { WeekReviewStatus } from "@/lib/schedule/weekReviewStatus";

export const WEEK_REVIEWS_KEY = "week-reviews";

export interface WeekReviewRow {
  week_start: string;
  status: WeekReviewStatus;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

async function fetchWeekReviews(
  scheduleGroupId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<WeekReviewRow[]> {
  const url = new URL(
    `/api/schedule-groups/${scheduleGroupId}/week-reviews`,
    window.location.origin
  );
  url.searchParams.set("rangeStart", rangeStart);
  url.searchParams.set("rangeEnd", rangeEnd);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load week reviews (${res.status})`);
  }
  const body: { data: WeekReviewRow[] } = await res.json();
  return body.data;
}

/**
 * Review rows for a schedule over a local date range, keyed by
 * `week_start` ("YYYY-MM-DD") for O(1) per-week lookup. Sparse — a week
 * missing from the map is 'pending' (migration 037); callers default it
 * themselves rather than this hook inventing rows.
 */
export function useWeekReviews(scheduleGroupId: string, rangeStart: Date, rangeEnd: Date) {
  const rangeStartStr = localDateString(rangeStart);
  const rangeEndStr = localDateString(rangeEnd);

  const query = useQuery({
    queryKey: [WEEK_REVIEWS_KEY, scheduleGroupId, rangeStartStr, rangeEndStr],
    queryFn: () => fetchWeekReviews(scheduleGroupId, rangeStartStr, rangeEndStr),
    staleTime: 30_000,
    enabled: !!scheduleGroupId,
  });

  const byWeekStart = useMemo(() => {
    const map = new Map<string, WeekReviewRow>();
    for (const row of query.data ?? []) map.set(row.week_start, row);
    return map;
  }, [query.data]);

  return { ...query, byWeekStart };
}

interface SetWeekReviewInput {
  scheduleGroupId: string;
  weekStart: Date;
  status: WeekReviewStatus;
  note?: string | null;
}

/**
 * Sets one week's review status via PUT /api/schedule-groups/[id]/week-reviews.
 * Invalidates the bare `week-reviews` prefix on success — same pattern as
 * SCHEDULE_RANGE_KEY — so every panel showing this schedule's weeks (the
 * list and the editor's own status bar) refreshes together.
 */
export function useSetWeekReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ scheduleGroupId, weekStart, status, note }: SetWeekReviewInput) => {
      const res = await fetch(`/api/schedule-groups/${scheduleGroupId}/week-reviews`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: localDateString(weekStart), status, note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to save review (${res.status})`);
      }
      return (await res.json()).data as WeekReviewRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WEEK_REVIEWS_KEY] });
    },
  });
}
