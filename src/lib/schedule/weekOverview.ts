import type { ExpandedSession } from "@/types/schedule.types";
import type { OccupancyKind } from "@/lib/sessions/occupancy";
import { minutesOfDayIn } from "@/lib/utils/dates";
import { sessionDayIndex } from "./weekGeometry";

/**
 * What a week actually contains, totalled — the numbers behind the Overview
 * tab of the week panel.
 *
 * ## Two different "hours", and why both are here
 *
 * Asking "how many hours of rentals did we run this week" has two honest
 * answers, and picking one silently is how a dashboard starts lying:
 *
 * - **Clock hours** — how much of the week had at least one rental running.
 *   Computed as the *union* of the occurrences, so two rentals in two lanes at
 *   the same hour count once. This is the answer to "when is the building
 *   doing this".
 * - **Space-hours** — each occurrence's duration multiplied by the number of
 *   spaces it holds. A 2-hour booking of four lanes is 8 space-hours. This is
 *   the answer to "how much of what we have did it consume", and it is the
 *   number that makes a four-lane lengths block look bigger than a one-lane
 *   aquafit class, which it is.
 *
 * Summing durations across sessions without doing one of those two things is
 * the wrong third answer: it double-counts anything running in parallel, so a
 * busy Saturday can report more hours than the day has.
 *
 * ## Drop-in totals are what is LEFT, not what was claimed
 *
 * `/api/sessions/expand` subtracts exclusive claims from residual drop-in
 * blocks before anyone sees them (migration 046), and this totals what it is
 * given. So "Drop-in: 18h" means eighteen hours of water actually available to
 * the public, not eighteen hours minus a rental nobody mentioned. That is the
 * number worth showing, and it is why this must never be fed the `subtract:
 * "none"` feed the shadow panel uses.
 */

/** Minutes from the start of the week, so a union can span days without special cases. */
interface Span {
  start: number;
  end: number;
}

export interface KindTotal {
  kind: OccupancyKind;
  /** Minutes with at least one session of this kind running — the union. */
  clockMinutes: number;
  /** Σ (duration × spaces held). Capacity, not wall-clock. */
  spaceMinutes: number;
  /** Distinct series, not occurrences — "3 rentals" means three bookings. */
  sessions: number;
  occurrences: number;
}

export interface DayTotal {
  /** 0 = Sunday, matching `DAYS` and `sessionDayIndex`. */
  dayIndex: number;
  openMinutes: number;
  programmedMinutes: number;
  spaceMinutes: number;
}

export interface WeekOverview {
  /** False when the department has no operating hours; every open/unprogrammed figure is then meaningless and hidden. */
  hasOpenHours: boolean;
  openMinutes: number;
  /** Union of every session, clipped to the open windows. */
  programmedMinutes: number;
  unprogrammedMinutes: number;
  /** Union of every session, whether or not the department is open then. */
  busyMinutes: number;
  /** Sessions running while the department is shut — a real thing to notice, not an error. */
  outsideOpenMinutes: number;
  byKind: KindTotal[];
  byDay: DayTotal[];
  totalSpaceMinutes: number;
  totalOccurrences: number;
  totalSessions: number;
}

/** The order the panel lists kinds in: what the public gets first, closures last. */
const KIND_ORDER: OccupancyKind[] = ["drop_in", "program", "rental", "closure"];

/** Merges overlapping spans and returns their total length. */
export function unionMinutes(spans: readonly Span[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let { start, end } = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const span = sorted[i];
    if (span.start > end) {
      total += end - start;
      start = span.start;
      end = span.end;
    } else if (span.end > end) {
      end = span.end;
    }
  }
  return total + (end - start);
}

/** The part of `spans` that falls inside `within`, as new spans. */
export function clipToWindows(spans: readonly Span[], within: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    for (const window of within) {
      const start = Math.max(span.start, window.start);
      const end = Math.min(span.end, window.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

export interface OpenWindow {
  /** Minutes of the day. */
  opens: number;
  closes: number;
}

export function buildWeekOverview(
  sessions: readonly ExpandedSession[],
  /** Resolved open windows per weekday index (0 = Sunday), holidays already applied. */
  openByDay: readonly (readonly OpenWindow[])[]
): WeekOverview {
  const open: Span[] = [];
  for (let day = 0; day < 7; day++) {
    for (const window of openByDay[day] ?? []) {
      if (window.closes > window.opens) {
        open.push({ start: day * 1440 + window.opens, end: day * 1440 + window.closes });
      }
    }
  }

  const spansByKind = new Map<OccupancyKind, Span[]>();
  const spaceMinutesByKind = new Map<OccupancyKind, number>();
  const sessionIdsByKind = new Map<OccupancyKind, Set<string>>();
  const occurrencesByKind = new Map<OccupancyKind, number>();
  const all: Span[] = [];
  const spansByDay: Span[][] = Array.from({ length: 7 }, () => []);
  const spaceMinutesByDay = Array<number>(7).fill(0);
  let totalSpaceMinutes = 0;
  const allSessionIds = new Set<string>();

  for (const session of sessions) {
    const day = sessionDayIndex(session.start);
    const startMinute = minutesOfDayIn(session.start);
    const endMinute = minutesOfDayIn(session.end);
    // A session that renders as ending before it starts has crossed midnight,
    // which migration 001 forbids — skipped rather than counted as negative.
    if (endMinute <= startMinute) continue;

    const span = { start: day * 1440 + startMinute, end: day * 1440 + endMinute };
    const duration = endMinute - startMinute;
    // A block with no space attached still occupies the hour it names, so it
    // counts as one — zero would erase the "General" column from the totals.
    const spaces = Math.max(session.spaceIds.length, 1);
    const kind = session.occupancyKind;

    all.push(span);
    spansByDay[day].push(span);
    spaceMinutesByDay[day] += duration * spaces;
    totalSpaceMinutes += duration * spaces;
    allSessionIds.add(session.sessionId);

    if (!spansByKind.has(kind)) {
      spansByKind.set(kind, []);
      sessionIdsByKind.set(kind, new Set());
    }
    spansByKind.get(kind)!.push(span);
    sessionIdsByKind.get(kind)!.add(session.sessionId);
    spaceMinutesByKind.set(kind, (spaceMinutesByKind.get(kind) ?? 0) + duration * spaces);
    occurrencesByKind.set(kind, (occurrencesByKind.get(kind) ?? 0) + 1);
  }

  const openMinutes = unionMinutes(open);
  const busyMinutes = unionMinutes(all);
  const programmedMinutes = unionMinutes(clipToWindows(all, open));

  const byKind: KindTotal[] = KIND_ORDER.filter((kind) => spansByKind.has(kind)).map((kind) => ({
    kind,
    clockMinutes: unionMinutes(spansByKind.get(kind) ?? []),
    spaceMinutes: spaceMinutesByKind.get(kind) ?? 0,
    sessions: sessionIdsByKind.get(kind)?.size ?? 0,
    occurrences: occurrencesByKind.get(kind) ?? 0,
  }));

  const byDay: DayTotal[] = Array.from({ length: 7 }, (_, day) => {
    const dayOpen = open.filter((w) => w.start >= day * 1440 && w.end <= (day + 1) * 1440);
    return {
      dayIndex: day,
      openMinutes: unionMinutes(dayOpen),
      programmedMinutes: unionMinutes(clipToWindows(spansByDay[day], dayOpen.length > 0 ? dayOpen : spansByDay[day])),
      spaceMinutes: spaceMinutesByDay[day],
    };
  });

  return {
    hasOpenHours: openMinutes > 0,
    openMinutes,
    programmedMinutes,
    unprogrammedMinutes: Math.max(openMinutes - programmedMinutes, 0),
    busyMinutes,
    outsideOpenMinutes: Math.max(busyMinutes - programmedMinutes, 0),
    byKind,
    byDay,
    totalSpaceMinutes,
    totalOccurrences: sessions.length,
    totalSessions: allSessionIds.size,
  };
}

/** "6h 30m", "45m", "0h" — compact enough to sit in a table cell. */
export function formatHours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The same arithmetic over an arbitrary date range
// ─────────────────────────────────────────────────────────────────────────────
//
// `buildWeekOverview` above is week-shaped: every span is minutes from the
// start of a seven-day grid, and `byDay` is indexed by weekday. That is right
// for the week panel and wrong for `/dashboard/analytics/utilization`, which
// asks the same questions of a quarter.
//
// ⚠️ `buildWeekOverview`'s SIGNATURE AND BEHAVIOUR ARE UNCHANGED, deliberately.
// `WeekPanel` depends on it and `verify-aw` asserts it, so the range version is
// a second entry point over the same helpers rather than a generalisation that
// forces the caller to adapt.
//
// The arithmetic composes because **a session cannot cross midnight** (a CHECK
// from migration 001), so two different weeks' spans are disjoint in time and
// their unions add. That is the only reason this is a sum rather than a
// re-implementation, and it stops being true the day overnight sessions are
// allowed.

export interface RangeOverview extends Omit<WeekOverview, "byDay"> {
  /** One entry per local calendar day in the range, in order. */
  byDate: { date: string; openMinutes: number; programmedMinutes: number; spaceMinutes: number }[];
  /** How many of the weeks in the range had any operating hours at all. */
  weeksCounted: number;
}

/**
 * Totals a range by summing one `buildWeekOverview` per week in it.
 *
 * `weeks` is the caller's list of {sessions, openByDay, weekStart} — built by
 * the caller because only it knows how to resolve holidays for each week
 * (migration 059 overrides 058 per DATE, so the seven open windows differ from
 * week to week and a single pattern would overstate capacity in exactly the
 * week someone is most likely to check).
 */
export function summariseRange(
  weeks: readonly {
    weekStart: Date;
    sessions: readonly ExpandedSession[];
    openByDay: readonly (readonly OpenWindow[])[];
  }[],
  /** Clip `byDate` to the requested range; whole weeks are summarised. */
  bounds: { from: string; to: string }
): RangeOverview {
  const perWeek = weeks.map((w) => ({
    weekStart: w.weekStart,
    overview: buildWeekOverview(w.sessions, w.openByDay),
  }));

  const sessionIds = new Set<string>();
  for (const w of weeks) for (const s of w.sessions) sessionIds.add(s.sessionId);

  const kindTotals = new Map<OccupancyKind, KindTotal>();
  for (const { overview } of perWeek) {
    for (const k of overview.byKind) {
      const existing = kindTotals.get(k.kind);
      if (!existing) {
        kindTotals.set(k.kind, { ...k });
      } else {
        existing.clockMinutes += k.clockMinutes;
        existing.spaceMinutes += k.spaceMinutes;
        existing.occurrences += k.occurrences;
        // NOT summed: the same weekly series appears in every week. Counting
        // it once per week would report "52 rentals" for one Tuesday booking.
        existing.sessions = Math.max(existing.sessions, k.sessions);
      }
    }
  }

  const byDate: RangeOverview["byDate"] = [];
  for (const { weekStart, overview } of perWeek) {
    for (const day of overview.byDay) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + day.dayIndex);
      const iso = localDay(date);
      if (iso < bounds.from || iso > bounds.to) continue;
      byDate.push({
        date: iso,
        openMinutes: day.openMinutes,
        programmedMinutes: day.programmedMinutes,
        spaceMinutes: day.spaceMinutes,
      });
    }
  }
  byDate.sort((a, b) => a.date.localeCompare(b.date));

  const sum = (pick: (o: WeekOverview) => number) =>
    perWeek.reduce((total, { overview }) => total + pick(overview), 0);

  const openMinutes = sum((o) => o.openMinutes);
  const programmedMinutes = sum((o) => o.programmedMinutes);
  const busyMinutes = sum((o) => o.busyMinutes);

  return {
    hasOpenHours: openMinutes > 0,
    openMinutes,
    programmedMinutes,
    unprogrammedMinutes: Math.max(openMinutes - programmedMinutes, 0),
    busyMinutes,
    outsideOpenMinutes: Math.max(busyMinutes - programmedMinutes, 0),
    byKind: KIND_ORDER.filter((k) => kindTotals.has(k)).map((k) => kindTotals.get(k)!),
    byDate,
    totalSpaceMinutes: sum((o) => o.totalSpaceMinutes),
    totalOccurrences: sum((o) => o.totalOccurrences),
    // The one figure that is a set union rather than a sum.
    totalSessions: sessionIds.size,
    weeksCounted: perWeek.filter(({ overview }) => overview.hasOpenHours).length,
  };
}

/** "YYYY-MM-DD" for a Date's LOCAL day. Mirrors analytics/range.ts's `toLocalDay`;
 *  duplicated rather than imported so this file stays free of that dependency
 *  and keeps working in the client bundle the week panel ships in. */
function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
