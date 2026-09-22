/**
 * The analytics date range — one definition shared by the page, the export
 * route and the client-side picker.
 *
 * A range is a pair of **inclusive local calendar dates** ("YYYY-MM-DD"),
 * never a pair of instants. That matters because everything a recreation
 * centre asks of this page is a calendar question ("how did last week go?"),
 * and because the instants the query needs differ at the two ends: the start
 * is local midnight on `from`, the end is local midnight on the day *after*
 * `to`, so the final day is included whole.
 *
 * This file is imported by a client component, so it must stay free of any
 * server-only import.
 */

export type RangePresetId = "7d" | "30d" | "90d" | "12m" | "mtd" | "last-month" | "ytd";

export interface AnalyticsRange {
  /** Inclusive first local calendar day, "YYYY-MM-DD". */
  from: string;
  /** Inclusive last local calendar day, "YYYY-MM-DD". */
  to: string;
  /** Which preset produced this, or "custom" when the dates were typed in. */
  preset: RangePresetId | "custom";
  /** Number of calendar days covered, inclusive of both ends. */
  days: number;
}

export const RANGE_PRESETS: { id: RangePresetId; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "12m", label: "Last 12 months" },
  { id: "mtd", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "ytd", label: "Year to date" },
];

export const DEFAULT_PRESET: RangePresetId = "30d";

/**
 * The longest range that may be requested.
 *
 * Not a display limit — a cost one. The summary reads raw event rows rather
 * than the nightly materialized view (see queries.ts), so the window is also
 * the size of the read, and an unbounded `?from=1970-01-01` would be a free
 * way for any signed-in member to make the server do unbounded work.
 */
export const MAX_RANGE_DAYS = 731;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for a Date's **local** calendar day — never `toISOString()`. */
export function toLocalDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

/** Local midnight at the start of a "YYYY-MM-DD" day. */
export function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftDays(day: string, delta: number): string {
  const date = parseLocalDay(day);
  date.setDate(date.getDate() + delta);
  return toLocalDay(date);
}

/** Inclusive day count between two local calendar days. */
export function daysBetween(from: string, to: string): number {
  // Both ends are local midnights, so the difference is whole days except
  // across a DST boundary — rounding absorbs the one-hour shift without an
  // off-by-one.
  return Math.round((parseLocalDay(to).getTime() - parseLocalDay(from).getTime()) / DAY_MS) + 1;
}

function make(from: string, to: string, preset: AnalyticsRange["preset"]): AnalyticsRange {
  return { from, to, preset, days: daysBetween(from, to) };
}

export function rangeFromPreset(preset: RangePresetId, now: Date = new Date()): AnalyticsRange {
  const today = toLocalDay(now);

  switch (preset) {
    case "7d":
      return make(shiftDays(today, -6), today, preset);
    case "30d":
      return make(shiftDays(today, -29), today, preset);
    case "90d":
      return make(shiftDays(today, -89), today, preset);
    case "12m": {
      const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);
      return make(toLocalDay(start), today, preset);
    }
    case "mtd":
      return make(toLocalDay(new Date(now.getFullYear(), now.getMonth(), 1)), today, preset);
    case "last-month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      // Day 0 of this month is the last day of the previous one.
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return make(toLocalDay(start), toLocalDay(end), preset);
    }
    case "ytd":
      return make(toLocalDay(new Date(now.getFullYear(), 0, 1)), today, preset);
  }
}

/**
 * Resolves `?range=` / `?from=&to=` into a range, falling back to the default
 * preset rather than erroring — a hand-edited URL should show the dashboard,
 * not a stack trace. Custom dates are clamped: reversed ends are swapped, a
 * future end is pulled back to today, and an over-long window is trimmed from
 * the start so the most recent data is what survives.
 */
export function parseAnalyticsRange(
  params: { range?: string; from?: string; to?: string },
  now: Date = new Date()
): AnalyticsRange {
  const { range, from, to } = params;

  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) {
    const today = toLocalDay(now);
    let start = from;
    let end = to > today ? today : to;
    if (start > end) [start, end] = [end, start];
    if (daysBetween(start, end) > MAX_RANGE_DAYS) {
      start = shiftDays(end, -(MAX_RANGE_DAYS - 1));
    }
    const resolved = make(start, end, "custom");
    // A typed range that happens to equal a preset is reported as that preset,
    // so the picker highlights the chip instead of reading "custom".
    const match = RANGE_PRESETS.find((p) => {
      const candidate = rangeFromPreset(p.id, now);
      return candidate.from === resolved.from && candidate.to === resolved.to;
    });
    return match ? { ...resolved, preset: match.id } : resolved;
  }

  const preset = RANGE_PRESETS.find((p) => p.id === range)?.id ?? DEFAULT_PRESET;
  return rangeFromPreset(preset, now);
}

/**
 * The equally long window immediately before this one, for "vs. previous
 * period" deltas. Always the same number of days, so a 30-day range is
 * compared against 30 days and not against a calendar month of a different
 * length.
 */
export function previousRange(range: AnalyticsRange): AnalyticsRange {
  const end = shiftDays(range.from, -1);
  const start = shiftDays(end, -(range.days - 1));
  return make(start, end, "custom");
}

/** ISO instant at local midnight opening the range — for `.gte("occurred_at", …)`. */
export function rangeStartInstant(range: AnalyticsRange): string {
  return parseLocalDay(range.from).toISOString();
}

/**
 * ISO instant at local midnight *after* the range's last day — for
 * `.lt("occurred_at", …)`. Exclusive on purpose: `lte` against the last day's
 * midnight would silently drop everything that happened during that day.
 */
export function rangeEndInstant(range: AnalyticsRange): string {
  return parseLocalDay(shiftDays(range.to, 1)).toISOString();
}

/** Every local calendar day in the range, in order — used to fill chart gaps. */
export function eachDay(range: AnalyticsRange): string[] {
  const days: string[] = [];
  for (let day = range.from; day <= range.to; day = shiftDays(day, 1)) days.push(day);
  return days;
}

/** The query string that reproduces this range, e.g. `range=30d`. */
export function rangeToQuery(range: AnalyticsRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range.preset === "custom") {
    params.set("from", range.from);
    params.set("to", range.to);
  } else {
    params.set("range", range.preset);
  }
  return params;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 3" — or "Mar 3, 2025" when the day is not in the current year. */
export function formatDay(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  const base = MONTHS[m - 1] + " " + d;
  return y === now.getFullYear() ? base : base + ", " + y;
}

/** The label on the picker button, e.g. "Last 30 days" or "Mar 3 – Apr 8". */
export function formatRangeLabel(range: AnalyticsRange, now: Date = new Date()): string {
  const preset = RANGE_PRESETS.find((p) => p.id === range.preset);
  if (preset) return preset.label;
  return formatDay(range.from, now) + " – " + formatDay(range.to, now);
}
