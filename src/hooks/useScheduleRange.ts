"use client";

import { useQuery } from "@tanstack/react-query";
import type { ExpandedSession, RangeExpandParams, ScheduleTemplate } from "@/types/schedule.types";
import { getWeekEnd, getMonthGridRange } from "@/lib/utils/dates";

/**
 * The one query key family for expanded sessions.
 *
 * Every schedule surface — weekly grid/list/map, the floorplan, the month
 * event calendar — reads through this, and every mutation invalidates the bare
 * prefix `["schedule-range"]`. Keep it that way: a view that fetches under its
 * own key stops refreshing when a session is placed from another view, and the
 * failure is silent (stale data, no error), which is exactly the kind of bug
 * that survives review.
 */
export const SCHEDULE_RANGE_KEY = "schedule-range";

async function fetchExpandedSessions(params: RangeExpandParams): Promise<ExpandedSession[]> {
  const { rangeStart, rangeEnd, orgId, facilityId, departmentId, scheduleGroupId, seasonId, eventsOnly } =
    params;

  const url = new URL("/api/sessions/expand", window.location.origin);
  url.searchParams.set("rangeStart", rangeStart.toISOString());
  url.searchParams.set("rangeEnd", rangeEnd.toISOString());
  if (orgId) url.searchParams.set("orgId", orgId);
  if (facilityId) url.searchParams.set("facilityId", facilityId);
  if (departmentId) url.searchParams.set("departmentId", departmentId);
  if (scheduleGroupId) url.searchParams.set("scheduleGroupId", scheduleGroupId);
  if (seasonId) url.searchParams.set("seasonId", seasonId);
  if (eventsOnly) url.searchParams.set("eventsOnly", "true");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load schedule (${res.status})`);
  }

  const body: { data: Array<Omit<ExpandedSession, "start" | "end"> & { start: string; end: string }> } =
    await res.json();

  // Deserialize ISO strings back to Date objects
  return body.data.map((s) => ({ ...s, start: new Date(s.start), end: new Date(s.end) }));
}

interface ScheduleScope {
  orgId?: string;
  facilityId?: string;
  departmentId?: string;
  scheduleGroupId?: string;
  /** Narrows to sessions explicitly assigned to one season. Orthogonal to the scope filters above. */
  seasonId?: string;
  /** Only sessions flagged is_event. What the event calendar asks for. */
  eventsOnly?: boolean;
}

interface UseScheduleRangeOptions extends ScheduleScope {
  rangeStart: Date;
  rangeEnd: Date;
}

/**
 * TanStack Query wrapper for /api/sessions/expand over an arbitrary date range.
 *
 * Handles ISO→Date deserialization, caching, and loading/error state. The
 * endpoint caps how wide a single range may be (120 days) — page by month
 * rather than asking for a year.
 */
export function useScheduleRange({
  orgId,
  facilityId,
  departmentId,
  scheduleGroupId,
  seasonId,
  eventsOnly,
  rangeStart,
  rangeEnd,
}: UseScheduleRangeOptions) {
  return useQuery({
    queryKey: [
      SCHEDULE_RANGE_KEY,
      {
        orgId,
        facilityId,
        departmentId,
        scheduleGroupId,
        seasonId,
        eventsOnly,
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
      },
    ],
    queryFn: () =>
      fetchExpandedSessions({
        rangeStart,
        rangeEnd,
        orgId,
        facilityId,
        departmentId,
        scheduleGroupId,
        seasonId,
        eventsOnly,
      }),
    staleTime: 60_000,
    enabled: !!(orgId || facilityId || scheduleGroupId),
  });
}

interface UseWeeklyScheduleOptions extends ScheduleScope {
  weekStart: Date;
}

/**
 * A week of the schedule — the shape most surfaces still want.
 *
 * A thin wrapper over useScheduleRange rather than a separate implementation,
 * so a week and a month share one cache, one fetch path, and one invalidation.
 * `weekStart` is expected to already be a Monday (via `getWeekStart`); the end
 * is derived, so callers can't accidentally ask for an eight-day week.
 */
export function useWeeklySchedule({ weekStart, ...scope }: UseWeeklyScheduleOptions) {
  return useScheduleRange({ ...scope, rangeStart: weekStart, rangeEnd: getWeekEnd(weekStart) });
}

interface UseMonthScheduleOptions extends ScheduleScope {
  /** Any date inside the target month. */
  month: Date;
}

/**
 * A month of the schedule, fetched over the range the month *grid* displays —
 * Monday-on-or-before the 1st through Sunday-on-or-after the last.
 *
 * Fetching only the calendar month would leave the grid's leading and trailing
 * cells empty even where sessions exist on those days, which reads as missing
 * data rather than as a month boundary.
 */
export function useMonthSchedule({ month, ...scope }: UseMonthScheduleOptions) {
  const { start, end } = getMonthGridRange(month);
  return useScheduleRange({ ...scope, rangeStart: start, rangeEnd: end });
}

interface UseTemplateScheduleOptions extends ScheduleScope {
  template: ScheduleTemplate;
  weekStart: Date;
  /** Any date inside the month in view. Both anchors come from `useScheduleAnchor`. */
  month: Date;
}

/**
 * The fetch a surface needs for whichever template it is currently rendering.
 *
 * Four surfaces mount `ScheduleView` — the command centre, the widget, the
 * public facility page, and the schedule-group page — and every one of them
 * has to change shape when the viewer picks the events calendar: a month-grid
 * range instead of a week, and only the sessions staff flagged. Leaving that
 * to each call site is four chances to fetch a week's worth of data for a
 * month-shaped view, and the symptom (a calendar that's empty after the first
 * row) looks like missing data rather than a wrong range.
 *
 * `eventsOnly` is forced on for the events template rather than merely
 * defaulted: a month of an org-wide schedule is thousands of occurrences, and
 * "show me everything on a month grid" is not a view anyone can read.
 */
export function useTemplateSchedule({
  template,
  weekStart,
  month,
  ...scope
}: UseTemplateScheduleOptions) {
  const isEvents = template === "events";
  const monthRange = getMonthGridRange(month);

  return useScheduleRange({
    ...scope,
    eventsOnly: isEvents || scope.eventsOnly,
    rangeStart: isEvents ? monthRange.start : weekStart,
    rangeEnd: isEvents ? monthRange.end : getWeekEnd(weekStart),
  });
}
