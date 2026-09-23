import type { createClient } from "@/lib/supabase/server";
import { rangeEndInstant, rangeStartInstant, toLocalDay, type AnalyticsRange } from "./range";
import type { ReadingMetric } from "@/types/app.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Who actually showed up — the attendance half of the Analytics section.
 *
 * Reads `facility_readings` (migration 061) and aggregates it into the
 * numbers `/dashboard/analytics/attendance` draws. The other two pages answer
 * different questions from different tables: Engagement is `analytics_events`
 * (who looked at the schedule), Utilization is the expanded schedule itself
 * (what the building is programmed for). See `README.md`.
 *
 * ## ⚠️ PostgREST caps a response at 1,000 rows and says nothing
 *
 * This is trap 1 in the README, and it has already produced one wrong number
 * in this codebase. `.limit(5000)` returns 1,000 rows with no error and no
 * symptom, so every total computed from it is the first thousand readings
 * presented as the whole period. The read below pages with `.range()` until
 * the window is exhausted or `MAX_ROWS` is reached, and reports `truncated` so
 * the page can say it stopped early rather than quietly under-reporting.
 *
 * ## Days and hours are LOCAL
 *
 * Trap 3. `toLocalDay()` and the local `Date` getters, never
 * `toISOString().slice(0,10)` — which would put a 7pm Pacific count on
 * tomorrow's bar and rotate the busy-hours heatmap by the UTC offset. Since
 * migration 036 removed the stored timezone there is nothing to convert into,
 * and every other calendar surface reads the runtime's clock.
 *
 * ## What a head count is, and is not
 *
 * A number a person wrote down after looking. It is not a turnstile, it is not
 * deduplicated, and two counts an hour apart may be the same forty people or
 * eighty different ones. So:
 *
 *   - **The peak is real** and is the most defensible number here — the most
 *     people observed at once.
 *   - **The average is an average of observations**, not of attendance: an
 *     afternoon counted twice weighs the same as a morning counted ten times.
 *     The page says so behind every tile's (i).
 *   - **There is no total attendance figure at all.** Summing head counts
 *     would produce a number that looks like "visits today" and is nothing of
 *     the kind. A request for that wants a turnstile, not this table.
 */

const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;

const READING_COLUMNS = "id, facility_id, space_id, metric, value, recorded_at, recorded_by";

export interface AttendanceReadingRow {
  id: string;
  facility_id: string;
  space_id: string | null;
  metric: ReadingMetric;
  value: number;
  recorded_at: string;
  recorded_by: string | null;
}

export interface ReadingFetchResult {
  rows: AttendanceReadingRow[];
  /** True when the read stopped at MAX_ROWS before reaching the window's start. */
  truncated: boolean;
}

export interface AttendanceQueryOptions {
  orgId: string;
  range: AnalyticsRange;
  facilityId?: string | null;
  /** Restrict to the facilities a scoped staffer holds. Empty means unscoped. */
  facilityIds?: string[];
}

/** The paged read. Every other function here takes its output. */
export async function fetchReadings(
  supabase: SupabaseServerClient,
  { orgId, range, facilityId, facilityIds }: AttendanceQueryOptions
): Promise<ReadingFetchResult> {
  const rows: AttendanceReadingRow[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    let query = supabase
      .from("facility_readings")
      .select(READING_COLUMNS)
      .eq("org_id", orgId)
      .gte("recorded_at", rangeStartInstant(range))
      // `.lt` on the instant AFTER the last day, so the final day is whole.
      // `.lte` on the last day's midnight silently drops that whole day, which
      // is most of what anybody wants to see. Trap 2 in the README.
      .lt("recorded_at", rangeEndInstant(range))
      .order("recorded_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (facilityId) query = query.eq("facility_id", facilityId);
    else if (facilityIds && facilityIds.length > 0) query = query.in("facility_id", facilityIds);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    rows.push(...(data as AttendanceReadingRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  return { rows, truncated: rows.length >= MAX_ROWS };
}

export interface AttendanceSummary {
  /** Head counts only. The temperatures are summarised separately below. */
  readingCount: number;
  /** Distinct local days on which anything was counted. */
  daysCovered: number;
  /** The largest single observation in the period, and when. */
  peak: { value: number; recordedAt: string; facilityId: string; spaceId: string | null } | null;
  /** Mean of every head count observation. See the caveat in the header. */
  averageCount: number | null;
  /** The busiest hour of an average day, 0-23, or null with too little data. */
  busiestHour: number | null;
  /** One bar per local day in the range, in order. Gaps are zero-count days. */
  byDay: { day: string; peak: number; average: number | null; samples: number }[];
  /** weekday (0 = Sunday) × hour, averaged. `null` where nothing was counted. */
  heatmap: { dayIndex: number; hour: number; average: number; samples: number }[];
  /** Per-space, then the whole-facility rows as a single "Whole building". */
  bySpace: { spaceId: string | null; peak: number; average: number; samples: number }[];
  /** Latest reading per temperature metric, for the two small tiles. */
  temperatures: { metric: ReadingMetric; average: number; min: number; max: number; samples: number }[];
  truncated: boolean;
}

/**
 * Everything the attendance page renders, from one read.
 *
 * Pure: takes rows, returns numbers. The harness calls it directly with a
 * hand-built fixture, which is the only way to assert an average without
 * asserting whatever the database happened to contain.
 */
export function summariseAttendance(
  fetched: ReadingFetchResult,
  range: AnalyticsRange
): AttendanceSummary {
  const counts = fetched.rows.filter((r) => r.metric === "headcount");
  const temps = fetched.rows.filter((r) => r.metric !== "headcount");

  const byDayMap = new Map<string, number[]>();
  const byCell = new Map<string, number[]>();
  const bySpaceMap = new Map<string, number[]>();
  let peak: AttendanceSummary["peak"] = null;

  for (const row of counts) {
    const at = new Date(row.recorded_at);
    const day = toLocalDay(at);
    // Local getters, not the ISO string. See the header.
    const cell = `${at.getDay()}:${at.getHours()}`;
    const spaceKey = row.space_id ?? "";

    push(byDayMap, day, row.value);
    push(byCell, cell, row.value);
    push(bySpaceMap, spaceKey, row.value);

    if (!peak || row.value > peak.value) {
      peak = {
        value: row.value,
        recordedAt: row.recorded_at,
        facilityId: row.facility_id,
        spaceId: row.space_id,
      };
    }
  }

  // Every day in the range, including the empty ones. A bar chart that skips
  // the days nobody counted reads as a continuous record with a different
  // shape, and "we stopped counting on Thursdays" is itself the finding.
  const byDay: AttendanceSummary["byDay"] = [];
  const cursor = new Date(range.from + "T00:00:00");
  const last = new Date(range.to + "T00:00:00");
  while (cursor <= last) {
    const day = toLocalDay(cursor);
    const values = byDayMap.get(day) ?? [];
    byDay.push({
      day,
      peak: values.length > 0 ? Math.max(...values) : 0,
      average: values.length > 0 ? mean(values) : null,
      samples: values.length,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const heatmap: AttendanceSummary["heatmap"] = [];
  for (const [cell, values] of byCell) {
    const [dayIndex, hour] = cell.split(":").map(Number);
    heatmap.push({ dayIndex, hour, average: mean(values), samples: values.length });
  }

  // The busiest hour of the day, across weekdays. Needs a floor: one Sunday
  // evening count of 3 would otherwise be "the busiest hour" at a facility
  // that has only been counting for a week.
  const byHour = new Map<number, number[]>();
  for (const row of counts) push(byHour, new Date(row.recorded_at).getHours(), row.value);
  let busiestHour: number | null = null;
  let busiestAverage = -1;
  for (const [hour, values] of byHour) {
    if (values.length < 3) continue;
    const avg = mean(values);
    if (avg > busiestAverage) {
      busiestAverage = avg;
      busiestHour = hour;
    }
  }

  const bySpace = [...bySpaceMap.entries()]
    .map(([key, values]) => ({
      spaceId: key === "" ? null : key,
      peak: Math.max(...values),
      average: mean(values),
      samples: values.length,
    }))
    .sort((a, b) => b.peak - a.peak);

  const tempsByMetric = new Map<ReadingMetric, number[]>();
  for (const row of temps) push(tempsByMetric, row.metric, row.value);

  return {
    readingCount: counts.length,
    daysCovered: byDayMap.size,
    peak,
    averageCount: counts.length > 0 ? mean(counts.map((r) => r.value)) : null,
    busiestHour,
    byDay,
    heatmap,
    bySpace,
    temperatures: [...tempsByMetric.entries()].map(([metric, values]) => ({
      metric,
      average: mean(values),
      min: Math.min(...values),
      max: Math.max(...values),
      samples: values.length,
    })),
    truncated: fetched.truncated,
  };
}

function push<K>(map: Map<K, number[]>, key: K, value: number) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
