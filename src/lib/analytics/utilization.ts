import type { createClient } from "@/lib/supabase/server";
import { expandSessions, type SessionWithRelations } from "@/lib/rrule/expand";
import { fetchOperatingHours } from "@/lib/schedule/operating-hours-query";
import { subtractExclusiveClaims } from "@/lib/schedule/residual";
import { resolveOperatingWindows } from "@/lib/schedule/operating-hours";
import { summariseRange, type OpenWindow, type RangeOverview } from "@/lib/schedule/weekOverview";
import { getWeekStart } from "@/lib/utils/dates";
import { parseLocalDay, toLocalDay, type AnalyticsRange } from "./range";
import type { ExpandedSession } from "@/types/schedule.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * What the building is programmed for — the Utilization half of the Analytics
 * section.
 *
 * The week panel's overview (`schedule-command/WeekPanel.tsx`) asked these
 * questions of one week, inside one editor, behind a button. This asks them of
 * a quarter, for a whole facility, on a page you can send to somebody. Same
 * arithmetic: `summariseRange()` in `weekOverview.ts` sums one
 * `buildWeekOverview` per week.
 *
 * ## Two kinds of hour, and neither is a sum of durations
 *
 * Carried over intact from the week panel, because it is the thing most likely
 * to be "simplified" into a wrong number:
 *
 *   - **Clock hours** — the UNION of a kind's occurrences. Two rentals in two
 *     lanes at the same hour count once. "When is the building doing this."
 *   - **Space-hours** — Σ duration × spaces held. A two-hour booking of four
 *     lanes is eight. "How much of what we have did it consume."
 *
 * A naive Σ duration is the wrong third answer: it double-counts anything
 * parallel, so a busy Saturday can report more hours than the day has.
 *
 * ## ⚠️ Drop-in figures are what is LEFT, and this page subtracts for itself
 *
 * `expandSessions` does NOT subtract. In `/api/sessions/expand` the residual
 * pass (migration 046) is a separate step applied after it, so a caller that
 * expands directly — like this one — gets drop-in blocks at their CLAIMED
 * length. Left alone, every hour of public water a rental had already taken
 * would be counted as available. `subtractExclusiveClaims` is therefore
 * applied per week below, and removing it is a silent overstatement rather
 * than a visible break.
 *
 * **Without `preserveFullyClaimed`, deliberately.** That option keeps a
 * completely-eaten block at full length so staff can still click it on a
 * schedule, which is right for a grid and wrong for a total: a drop-in block
 * consumed end to end by a swim club contributed zero hours of public water,
 * and counting it would report water nobody could swim in. The week panel
 * reads the API as a signed-in staffer and so *does* include those blocks in
 * its drop-in figure; that difference is real, and this page is the one whose
 * number can be put in a report.
 *
 * ## Open hours come from 058 AND 059
 *
 * Holiday overrides are resolved per DATE, which is why the weeks are built
 * one at a time rather than from a single seven-day pattern: Christmas Day is
 * a Monday, and counting it as open overstates capacity in exactly the week
 * someone is most likely to check.
 */

/**
 * The widest range this will expand.
 *
 * Expansion is O(occurrences) and every week costs a full pass, so a year of a
 * multi-department facility is tens of thousands of objects built to produce
 * about twenty numbers. 366 days covers "this year" and "last 12 months",
 * which is the longest question anyone has asked of it; `range.ts`'s own
 * `MAX_RANGE_DAYS` (731) is the cap for the event-based pages, whose rows are
 * read rather than computed.
 */
export const MAX_UTILIZATION_DAYS = 366;

const SESSION_SELECT = `
  *,
  schedule_groups (
    id, name, sport_category, activity_type, cost_cents, cost_notes,
    age_group, skill_level, max_participants,
    facilities ( id, name ),
    departments ( id, name )
  ),
  session_spaces (
    spaces ( id, name, display_order )
  ),
  session_templates (
    id, name, color, description,
    session_template_tags ( display_order, tags ( id, label, color ) ),
    session_template_links ( id, label, url, display_order )
  )
`;

export interface UtilizationOptions {
  orgId: string;
  range: AnalyticsRange;
  facilityId?: string | null;
  departmentId?: string | null;
}

export interface UtilizationResult extends RangeOverview {
  /** True when the range was clipped to MAX_UTILIZATION_DAYS. */
  clamped: boolean;
  /** Days actually summarised, after clamping. */
  daysCovered: number;
  /** Departments in scope that have no operating hours — the denominator gap. */
  departmentsWithoutHours: { id: string; name: string }[];
}

export async function getUtilization(
  supabase: SupabaseServerClient,
  { orgId, range, facilityId, departmentId }: UtilizationOptions
): Promise<UtilizationResult> {
  const clamped = range.days > MAX_UTILIZATION_DAYS;
  const from = clamped
    ? toLocalDay(shift(parseLocalDay(range.to), -(MAX_UTILIZATION_DAYS - 1)))
    : range.from;
  const bounds = { from, to: range.to };

  // One read of the sessions, then one expansion per week. The alternative —
  // a query per week — would be ~13 round trips for a quarter to fetch the
  // same rows every time.
  let query = supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .eq("org_id", orgId)
    .eq("is_active", true);

  if (facilityId) query = query.eq("schedule_groups.facility_id", facilityId);
  if (departmentId) query = query.eq("schedule_groups.department_id", departmentId);

  const { data: sessionRows, error } = await query;
  if (error || !sessionRows) {
    return {
      ...emptyOverview(),
      clamped,
      daysCovered: 0,
      departmentsWithoutHours: [],
    };
  }

  const sessions = sessionRows as unknown as SessionWithRelations[];
  const sessionIds = sessions.map((s) => s.id);

  const { data: exceptions } = sessionIds.length
    ? await supabase.from("session_exceptions").select("*").in("session_id", sessionIds)
    : { data: [] };

  // Every department these sessions belong to, so `follows_operating_hours`
  // resolves real times rather than the stored snapshot — the same call the
  // expand route makes, for the same reason.
  const departmentIds = sessions.map((s) => s.schedule_groups?.departments?.id);
  const operatingHours = await fetchOperatingHours(supabase, departmentIds);

  const weekStarts = weeksBetween(bounds.from, bounds.to);

  const weeks = weekStarts.map((weekStart) => {
    const rangeStart = new Date(weekStart);
    const rangeEnd = new Date(weekStart);
    rangeEnd.setDate(rangeEnd.getDate() + 7);

    const expanded: ExpandedSession[] = expandSessions(
      sessions,
      exceptions ?? [],
      { rangeStart, rangeEnd, orgId, facilityId: facilityId ?? undefined, departmentId: departmentId ?? undefined },
      operatingHours
    );

    // Residual subtraction, per week. Rivals default to the same week's
    // occurrences, which is the right denominator — a claim can only eat a
    // block it overlaps, and both are in this expansion.
    const residual = subtractExclusiveClaims(expanded);

    return {
      weekStart,
      sessions: residual,
      openByDay: openWindowsFor(weekStart, operatingHours, departmentIds),
    };
  });

  const overview = summariseRange(weeks, bounds);

  // Named, not counted: "3 departments have no hours" is an errand, and the
  // whole open/unprogrammed block is hidden when the denominator is missing,
  // so the page has to be able to say which one to go and fix.
  const seen = new Map<string, string>();
  for (const s of sessions) {
    const d = s.schedule_groups?.departments;
    if (d?.id) seen.set(d.id, d.name);
  }
  const departmentsWithoutHours = [...seen.entries()]
    .filter(([id]) => {
      const hours = operatingHours.get(id);
      return !hours || !hours.week.some((day) => day.length > 0);
    })
    .map(([id, name]) => ({ id, name }));

  return {
    ...overview,
    clamped,
    daysCovered: overview.byDate.length,
    departmentsWithoutHours,
  };
}

/**
 * The seven days of open windows for one week, holidays applied, UNIONED
 * across every department in scope.
 *
 * A union rather than a per-department breakdown because the question this
 * page answers is about the BUILDING: "how many hours were we open, and how
 * much of that was programmed". Aquatics open 6-9 and Fitness open 8-10 means
 * the building was open 6-10, not 2 × 4 hours — and `unionMinutes` in
 * `weekOverview.ts` is what collapses the overlap.
 */
function openWindowsFor(
  weekStart: Date,
  operatingHours: Awaited<ReturnType<typeof fetchOperatingHours>>,
  departmentIds: (string | null | undefined)[]
): OpenWindow[][] {
  const ids = Array.from(new Set(departmentIds.filter((id): id is string => !!id)));
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + dayIndex);
    const dateKey = toLocalDay(date);
    const windows: OpenWindow[] = [];
    for (const id of ids) {
      // ⚠️ Both 058 and 059. An override for this exact DATE wins outright —
      // absence of one, not an empty one, falls through to the weekly pattern.
      for (const w of resolveOperatingWindows(operatingHours.get(id), dateKey, date.getDay())) {
        if (w.closes > w.opens) windows.push({ opens: w.opens, closes: w.closes });
      }
    }
    return windows;
  });
}

/** Every Sunday-start week touching the range, in order. */
function weeksBetween(from: string, to: string): Date[] {
  const out: Date[] = [];
  const cursor = getWeekStart(parseLocalDay(from));
  const last = parseLocalDay(to);
  while (cursor <= last) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

function shift(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function emptyOverview(): RangeOverview {
  return {
    hasOpenHours: false,
    openMinutes: 0,
    programmedMinutes: 0,
    unprogrammedMinutes: 0,
    busyMinutes: 0,
    outsideOpenMinutes: 0,
    byKind: [],
    byDate: [],
    totalSpaceMinutes: 0,
    totalOccurrences: 0,
    totalSessions: 0,
    weeksCounted: 0,
  };
}
