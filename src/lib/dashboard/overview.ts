/**
 * The Overview's arithmetic: which weeks are coming up, whether each
 * department has approved them, and which schedules are about to run out.
 *
 * Pure functions over rows the page has already read, so the page stays one
 * set of queries and this stays testable. Design: docs/prompts/overview-ux.md
 * and the "Overview: an inbox, not a mirror" canvas (2026-10-01).
 *
 * Weeks start on Sunday, the convention `schedule_week_reviews.week_start`
 * (037) and `sessionWeekStart()` already use. A week with no review row is
 * pending, and a pending week of a published schedule is HIDDEN from the
 * public widget (see filterUnapprovedPublicWeeks in /api/sessions/expand) —
 * which is why an unreviewed next week is an inbox item, not a statistic.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { getWeekStart, localDateString } from "@/lib/utils/dates";
import type { WeekReviewStatus } from "@/lib/schedule/weekReviewStatus";

export interface OverviewScheduleGroup {
  id: string;
  name: string;
  status: "draft" | "published";
  starts_on: string | null;
  ends_on: string | null;
  department_id: string | null;
}

export interface OverviewReview {
  schedule_group_id: string;
  week_start: string;
  status: WeekReviewStatus;
}

export interface OverviewConflictRef {
  occurrenceDate: string;
  departmentIds: (string | null)[];
}

/** `null` is the "no department" bucket. */
export type DepartmentKey = string | null;

export interface DepartmentWeekState {
  departmentId: DepartmentKey;
  departmentName: string;
  status: WeekReviewStatus;
  /** Published schedules in this department that run this week. */
  scheduleCount: number;
  conflictCount: number;
}

export interface WeekReadiness {
  weekStart: string; // YYYY-MM-DD, a Sunday
  label: string; // "Oct 4–10"
  relative: string; // "This week", "Next week", "In 2 weeks"
  departments: DepartmentWeekState[];
  allApproved: boolean;
}

export function weekStartString(date: Date): string {
  return localDateString(getWeekStart(date));
}

/** The Sunday-start week containing `today`, plus the next `count - 1`. */
export function upcomingWeekStarts(today: Date, count: number): string[] {
  const first = getWeekStart(today);
  return Array.from({ length: count }, (_, i) => localDateString(addDays(first, i * 7)));
}

export function weekLabel(weekStart: string): string {
  const start = parseISO(weekStart);
  const end = addDays(start, 6);
  return start.getMonth() === end.getMonth()
    ? `${format(start, "MMM d")}–${format(end, "d")}`
    : `${format(start, "MMM d")} – ${format(end, "MMM d")}`;
}

function relativeWeek(index: number): string {
  if (index === 0) return "This week";
  if (index === 1) return "Next week";
  return `In ${index} weeks`;
}

/** Does a schedule's date range touch [weekStart, weekStart + 6]? */
export function runsInWeek(g: OverviewScheduleGroup, weekStart: string): boolean {
  const weekEnd = localDateString(addDays(parseISO(weekStart), 6));
  if (g.starts_on && g.starts_on > weekEnd) return false;
  if (g.ends_on && g.ends_on < weekStart) return false;
  return true;
}

/**
 * One row per week, one entry per department with a published schedule that
 * week. A department is approved only when every one of its schedules is;
 * any "needs changes" wins over "pending".
 */
export function buildWeekReadiness(args: {
  weekStarts: string[];
  firstWeekIndex: number;
  groups: OverviewScheduleGroup[];
  reviews: OverviewReview[];
  conflicts: OverviewConflictRef[];
  departmentNames: Map<string, string>;
  /** Restrict to these departments (a coordinator's scope). Undefined = all. */
  visibleDepartment?: (id: DepartmentKey) => boolean;
}): WeekReadiness[] {
  const reviewByKey = new Map(args.reviews.map((r) => [`${r.schedule_group_id}:${r.week_start}`, r.status]));
  const published = args.groups.filter((g) => g.status === "published");

  return args.weekStarts.map((weekStart, i) => {
    const weekEnd = localDateString(addDays(parseISO(weekStart), 6));
    const byDept = new Map<DepartmentKey, DepartmentWeekState>();

    for (const g of published) {
      if (!runsInWeek(g, weekStart)) continue;
      const key = g.department_id;
      if (args.visibleDepartment && !args.visibleDepartment(key)) continue;
      const entry =
        byDept.get(key) ??
        ({
          departmentId: key,
          departmentName: key ? (args.departmentNames.get(key) ?? "Department") : "No department",
          status: "approved",
          scheduleCount: 0,
          conflictCount: 0,
        } satisfies DepartmentWeekState);
      const status = reviewByKey.get(`${g.id}:${weekStart}`) ?? "pending";
      if (status === "needs_changes" || (status === "pending" && entry.status === "approved")) {
        entry.status = status;
      }
      entry.scheduleCount += 1;
      byDept.set(key, entry);
    }

    for (const c of args.conflicts) {
      if (c.occurrenceDate < weekStart || c.occurrenceDate > weekEnd) continue;
      for (const key of new Set(c.departmentIds)) {
        const entry = byDept.get(key);
        if (entry) entry.conflictCount += 1;
      }
    }

    const departments = [...byDept.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName));
    return {
      weekStart,
      label: weekLabel(weekStart),
      relative: relativeWeek(args.firstWeekIndex + i),
      departments,
      allApproved: departments.every((d) => d.status === "approved"),
    };
  });
}

export interface RunoutWarning {
  scheduleGroupId: string;
  name: string;
  departmentId: DepartmentKey;
  endsOn: string;
  daysLeft: number;
}

/**
 * Published schedules that end within `horizonDays` with nothing in the same
 * department running past them. A schedule quietly running out leaves the
 * public widget empty, and nothing else in the product says so.
 */
export function findRunouts(groups: OverviewScheduleGroup[], today: Date, horizonDays: number): RunoutWarning[] {
  const todayStr = localDateString(today);
  return groups
    .filter((g) => g.status === "published" && g.ends_on && g.ends_on >= todayStr)
    .map((g) => ({ g, daysLeft: differenceInCalendarDays(parseISO(g.ends_on!), today) }))
    .filter(({ daysLeft }) => daysLeft <= horizonDays)
    .filter(
      ({ g }) =>
        !groups.some(
          (other) =>
            other.id !== g.id &&
            other.department_id === g.department_id &&
            (other.ends_on === null || other.ends_on > g.ends_on!)
        )
    )
    .map(({ g, daysLeft }) => ({
      scheduleGroupId: g.id,
      name: g.name,
      departmentId: g.department_id,
      endsOn: g.ends_on!,
      daysLeft,
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** "Sat, Dec 19" */
export function shortDay(date: string): string {
  return format(parseISO(date), "EEE, MMM d");
}

/** "in 11 weeks", "in 9 days", "tomorrow", "today" */
export function inDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 21) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}
