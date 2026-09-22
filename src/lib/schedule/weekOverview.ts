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
