import type { createClient } from "@/lib/supabase/server";
import {
  eachDay,
  previousRange,
  rangeEndInstant,
  rangeStartInstant,
  toLocalDay,
  type AnalyticsRange,
} from "@/lib/analytics/range";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type AnalyticsEventRow = {
  event_type: string;
  schedule_group_id: string | null;
  facility_id: string | null;
  view_template: string | null;
  duration_ms: number | null;
  referrer_url: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  occurred_at: string;
};

/**
 * Rows read per request, and the ceiling across all of them.
 *
 * PostgREST caps a single response at the project's `max_rows` (1000 on a
 * default Supabase project), so a bare `.limit(20000)` quietly returned the
 * first thousand rows and every total computed from it was wrong without
 * looking wrong. Paging with `.range()` is what actually reads the window.
 *
 * The ceiling is what keeps a busy embed from turning one dashboard load into
 * an unbounded read. Rows arrive newest-first, so hitting it drops the oldest
 * days rather than the ones being looked at, and `truncated` says so on the
 * page instead of letting a short total pass for a real one.
 */
const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;

const EVENT_COLUMNS =
  "event_type, schedule_group_id, facility_id, view_template, duration_ms, referrer_url, user_agent, ip_hash, occurred_at";

export interface EventFetchResult {
  rows: AnalyticsEventRow[];
  /** True when the read stopped at MAX_ROWS before reaching the window's start. */
  truncated: boolean;
  /** Oldest day actually covered — differs from `range.from` only when truncated. */
  coveredFrom: string | null;
}

export interface EventQueryOptions {
  orgId: string;
  range: AnalyticsRange;
  /** Narrow to one facility. Org-wide embeds record no facility, so this drops them. */
  facilityId?: string | null;
}

/**
 * Every analytics_events row for this org inside the range, newest first.
 *
 * Deliberately the raw table and not `analytics_daily_summary`: that view is
 * refreshed nightly, and a dashboard that cannot show this morning's visits is
 * not a dashboard anyone checks. The aggregation below is cheap next to the
 * round trip.
 */
export async function fetchAnalyticsEvents(
  supabase: SupabaseServerClient,
  { orgId, range, facilityId }: EventQueryOptions
): Promise<EventFetchResult> {
  const rows: AnalyticsEventRow[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    let query = supabase
      .from("analytics_events")
      .select(EVENT_COLUMNS)
      .eq("org_id", orgId)
      .gte("occurred_at", rangeStartInstant(range))
      .lt("occurred_at", rangeEndInstant(range))
      .order("occurred_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (facilityId) query = query.eq("facility_id", facilityId);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    rows.push(...(data as AnalyticsEventRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  const truncated = rows.length >= MAX_ROWS;
  const oldest = rows.length > 0 ? rows[rows.length - 1].occurred_at : null;

  return {
    rows,
    truncated,
    coveredFrom: truncated && oldest ? toLocalDay(new Date(oldest)) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event types that count as somebody looking at a published schedule.
 *
 * Kept as a literal tuple, not a bare `string[]`: `.in("event_type", …)` is
 * typed against the column's enum, so a typo here is a compile error rather
 * than a filter that silently matches nothing.
 */
const VIEW_EVENT_TYPES = ["widget_view", "facility_view", "schedule_view"] as const;
const VIEW_EVENTS: ReadonlySet<string> = new Set(VIEW_EVENT_TYPES);

type TrackedEventType = (typeof VIEW_EVENT_TYPES)[number] | "program_click" | "link_click";

export type Surface = "widget" | "facility" | "public";

export const SURFACE_LABELS: Record<Surface, string> = {
  widget: "Embedded widget",
  facility: "Facility page",
  public: "Public schedule",
};

function surfaceOf(eventType: string): Surface | null {
  if (eventType === "widget_view") return "widget";
  if (eventType === "facility_view") return "facility";
  if (eventType === "schedule_view") return "public";
  return null;
}

export type DeviceClass = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

export const DEVICE_LABELS: Record<DeviceClass, string> = {
  mobile: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  bot: "Bot / crawler",
  unknown: "Unknown",
};

/**
 * Device class from the stored user agent.
 *
 * Coarse on purpose. The only decision this number informs is whether the
 * published schedule has to work on a phone, and for that "phone / tablet /
 * desktop" is the whole answer — parsing beyond it would mean shipping a UA
 * database to learn nothing more.
 */
export function deviceClass(userAgent: string | null): DeviceClass {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/bot|crawler|spider|crawling|headlesschrome|lighthouse|preview/.test(ua)) return "bot";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * The five schedule templates, as a visitor would name them.
 *
 * Lives here rather than in the chart component because the CSV export needs
 * the same words — a breakdown row reading "floorplan" in one place and
 * "Floorplan" in the other is the kind of drift a customer notices first.
 */
export const TEMPLATE_LABELS: Record<string, string> = {
  grid: "Grid",
  list: "List",
  map: "Map",
  floorplan: "Floorplan",
  board: "Board",
};

/** A referrer URL reduced to its hostname, or "Direct" when there is none. */
export function referrerLabel(url: string | null): string {
  if (!url) return "Direct / no referrer";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Direct / no referrer";
  }
}

/**
 * Visit-length buckets, in order.
 *
 * The averages hide the shape that matters: a schedule can post a healthy
 * mean because a handful of visitors left it open in a tab, while most people
 * bounced in under ten seconds. The buckets are what show that.
 */
export const DURATION_BUCKETS: { label: string; maxMs: number }[] = [
  { label: "Under 10s", maxMs: 10_000 },
  { label: "10–30s", maxMs: 30_000 },
  { label: "30s–1m", maxMs: 60_000 },
  { label: "1–3m", maxMs: 180_000 },
  { label: "3–10m", maxMs: 600_000 },
  { label: "Over 10m", maxMs: Number.POSITIVE_INFINITY },
];

/** Visits shorter than this are counted as quick exits. */
const QUICK_EXIT_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

export interface CountedLabel {
  /** Stable identity — the template/device/surface key, or the raw string. */
  key: string;
  /** What a person reads. Resolved here so the page and the CSV never disagree. */
  label: string;
  count: number;
  /** Share of this breakdown's total, 0–1. */
  share: number;
}

export interface DayPoint {
  day: string;
  views: number;
  visitors: number;
  clicks: number;
  linkClicks: number;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  /** Rows the aggregation actually saw, and whether the ceiling cut them short. */
  eventCount: number;
  truncated: boolean;
  coveredFrom: string | null;

  views: number;
  visitors: number;
  clicks: number;
  linkClicks: number;
  clickThroughRate: number | null;
  registrationRate: number | null;
  viewsPerVisitor: number | null;

  avgDurationMs: number | null;
  medianDurationMs: number | null;
  durationSamples: number;
  quickExitRate: number | null;

  /** Same metrics over the immediately preceding window of equal length. */
  previous: {
    range: AnalyticsRange;
    views: number;
    clicks: number;
    linkClicks: number;
    clickThroughRate: number | null;
  } | null;

  byDay: DayPoint[];
  busiestDay: DayPoint | null;
  /** Views per hour of the day, 0–23, always all 24 entries. */
  byHour: number[];
  /** Views per weekday x hour — 7 rows of 24, Sunday first. */
  heatmap: number[][];
  busiestHour: { weekday: number; hour: number; views: number } | null;

  templateBreakdown: CountedLabel[];
  deviceBreakdown: CountedLabel[];
  surfaceBreakdown: CountedLabel[];
  topReferrers: CountedLabel[];
  durationBuckets: CountedLabel[];
  topFacilities: { facilityId: string; count: number }[];
  topClickedSchedules: { scheduleGroupId: string; count: number }[];
}

export interface SummaryOptions extends EventQueryOptions {
  /**
   * Fetch the previous window for deltas. Off for the overview ticker, which
   * shows three numbers and has no room to compare them against anything.
   */
  compare?: boolean;
}

function counted(
  map: Map<string, number>,
  labelOf: (key: string) => string = (key) => key,
  limit?: number
): CountedLabel[] {
  const total = Array.from(map.values()).reduce((sum, n) => sum + n, 0);
  const rows = Array.from(map.entries())
    .map(([key, count]) => ({ key, label: labelOf(key), count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
  return limit ? rows.slice(0, limit) : rows;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/**
 * Exact counts for the previous window, without reading its rows.
 *
 * `head: true` makes PostgREST answer with the count alone, so a comparison
 * against a year of history costs three cheap queries instead of a second
 * 50,000-row page-through.
 */
async function previousTotals(
  supabase: SupabaseServerClient,
  { orgId, range, facilityId }: EventQueryOptions
) {
  const countOf = async (eventTypes: readonly TrackedEventType[]) => {
    let query = supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("occurred_at", rangeStartInstant(range))
      .lt("occurred_at", rangeEndInstant(range))
      .in("event_type", [...eventTypes]);
    if (facilityId) query = query.eq("facility_id", facilityId);
    const { count } = await query;
    return count ?? 0;
  };

  const [views, clicks, linkClicks] = await Promise.all([
    countOf(VIEW_EVENT_TYPES),
    countOf(["program_click"]),
    countOf(["link_click"]),
  ]);

  return { views, clicks, linkClicks };
}

/**
 * Everything /dashboard/analytics shows, from one read of the event table.
 *
 * All day and hour bucketing uses **local** Date getters, matching the rest of
 * the app: since migration 036 removed the timezone column there is no stored
 * zone to convert into, and every other calendar surface here reads the
 * runtime's local clock. A chart built with UTC getters would disagree with
 * the schedule pages sitting next to it — which is exactly the class of bug
 * the verification harnesses hit (see scripts/verify/README.md).
 */
export async function getAnalyticsSummary(
  supabase: SupabaseServerClient,
  { orgId, range, facilityId = null, compare = true }: SummaryOptions
): Promise<AnalyticsSummary> {
  const prevRange = previousRange(range);

  const [{ rows, truncated, coveredFrom }, prev] = await Promise.all([
    fetchAnalyticsEvents(supabase, { orgId, range, facilityId }),
    compare ? previousTotals(supabase, { orgId, range: prevRange, facilityId }) : Promise.resolve(null),
  ]);

  const dayTemplate = eachDay(range);
  const byDayMap = new Map<string, DayPoint>(
    dayTemplate.map((day) => [day, { day, views: 0, visitors: 0, clicks: 0, linkClicks: 0 }])
  );
  // Visitor hashes are per day by construction — the track route salts the IP
  // with the current date, so the same person carries a different hash
  // tomorrow. Counting distinct hashes per day and summing is therefore the
  // only visitor number this data can support; the page says so on the tile.
  const visitorsByDay = new Map<string, Set<string>>();

  const byHour = new Array<number>(24).fill(0);
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

  const templateMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  const surfaceMap = new Map<string, number>();
  const referrerMap = new Map<string, number>();
  const facilityMap = new Map<string, number>();
  const clickedMap = new Map<string, number>();
  const durations: number[] = [];

  let views = 0;
  let clicks = 0;
  let linkClicks = 0;

  for (const row of rows) {
    const at = new Date(row.occurred_at);
    const day = toLocalDay(at);
    const point = byDayMap.get(day);
    const isView = VIEW_EVENTS.has(row.event_type);

    if (isView) {
      views++;
      if (point) point.views++;
      byHour[at.getHours()]++;
      heatmap[at.getDay()][at.getHours()]++;

      const surface = surfaceOf(row.event_type);
      if (surface) surfaceMap.set(surface, (surfaceMap.get(surface) ?? 0) + 1);

      const referrer = referrerLabel(row.referrer_url);
      referrerMap.set(referrer, (referrerMap.get(referrer) ?? 0) + 1);

      const device = deviceClass(row.user_agent);
      deviceMap.set(device, (deviceMap.get(device) ?? 0) + 1);

      if (row.ip_hash) {
        let seen = visitorsByDay.get(day);
        if (!seen) visitorsByDay.set(day, (seen = new Set()));
        seen.add(row.ip_hash);
      }

      if (row.facility_id) {
        facilityMap.set(row.facility_id, (facilityMap.get(row.facility_id) ?? 0) + 1);
      }
    }

    if (row.event_type === "program_click") {
      clicks++;
      if (point) point.clicks++;
      if (row.schedule_group_id) {
        clickedMap.set(row.schedule_group_id, (clickedMap.get(row.schedule_group_id) ?? 0) + 1);
      }
    }

    if (row.event_type === "link_click") {
      linkClicks++;
      if (point) point.linkClicks++;
    }

    if (row.event_type === "session_duration" && row.duration_ms !== null) {
      durations.push(row.duration_ms);
    }

    // A template switch is a look at that template even though it is not a
    // new view, so the breakdown counts both — it answers "what did people
    // read", not "how did the page first render".
    if (row.view_template && (isView || row.event_type === "view_change")) {
      templateMap.set(row.view_template, (templateMap.get(row.view_template) ?? 0) + 1);
    }
  }

  for (const [day, seen] of visitorsByDay) {
    const point = byDayMap.get(day);
    if (point) point.visitors = seen.size;
  }

  const byDay = dayTemplate.map((day) => byDayMap.get(day) as DayPoint);
  const visitors = byDay.reduce((sum, d) => sum + d.visitors, 0);
  const busiestDay = byDay.reduce<DayPoint | null>(
    (best, d) => (d.views > 0 && (!best || d.views > best.views) ? d : best),
    null
  );

  let busiestHour: AnalyticsSummary["busiestHour"] = null;
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const cell = heatmap[weekday][hour];
      if (cell > 0 && (!busiestHour || cell > busiestHour.views)) {
        busiestHour = { weekday, hour, views: cell };
      }
    }
  }

  const durationBucketMap = new Map<string, number>(DURATION_BUCKETS.map((b) => [b.label, 0]));
  for (const ms of durations) {
    const bucket = DURATION_BUCKETS.find((b) => ms < b.maxMs) ?? DURATION_BUCKETS[DURATION_BUCKETS.length - 1];
    durationBucketMap.set(bucket.label, (durationBucketMap.get(bucket.label) ?? 0) + 1);
  }

  const avgDurationMs =
    durations.length > 0 ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : null;
  const quickExits = durations.filter((ms) => ms < QUICK_EXIT_MS).length;
  const clickThroughRate = views > 0 ? clicks / views : null;

  return {
    range,
    eventCount: rows.length,
    truncated,
    coveredFrom,

    views,
    visitors,
    clicks,
    linkClicks,
    clickThroughRate,
    registrationRate: clicks > 0 ? linkClicks / clicks : null,
    viewsPerVisitor: visitors > 0 ? views / visitors : null,

    avgDurationMs,
    medianDurationMs: median(durations),
    durationSamples: durations.length,
    quickExitRate: durations.length > 0 ? quickExits / durations.length : null,

    previous: prev
      ? {
          range: prevRange,
          views: prev.views,
          clicks: prev.clicks,
          linkClicks: prev.linkClicks,
          clickThroughRate: prev.views > 0 ? prev.clicks / prev.views : null,
        }
      : null,

    byDay,
    busiestDay,
    byHour,
    heatmap,
    busiestHour,

    templateBreakdown: counted(templateMap, (key) => TEMPLATE_LABELS[key] ?? key),
    deviceBreakdown: counted(deviceMap, (key) => DEVICE_LABELS[key as DeviceClass] ?? key),
    surfaceBreakdown: counted(surfaceMap, (key) => SURFACE_LABELS[key as Surface] ?? key),
    topReferrers: counted(referrerMap, undefined, 8),
    durationBuckets: DURATION_BUCKETS.map((b) => {
      const count = durationBucketMap.get(b.label) ?? 0;
      return {
        key: b.label,
        label: b.label,
        count,
        share: durations.length > 0 ? count / durations.length : 0,
      };
    }),
    topFacilities: Array.from(facilityMap.entries())
      .map(([facilityId, count]) => ({ facilityId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    topClickedSchedules: Array.from(clickedMap.entries())
      .map(([scheduleGroupId, count]) => ({ scheduleGroupId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

export interface FacilityRef {
  id: string;
  name: string;
}

export interface ScheduleRef {
  id: string;
  name: string;
  facility_id: string;
  department_id: string | null;
}

/**
 * The rows behind the ids a summary reports, for the two leaderboards.
 *
 * Carries more than a name because a leaderboard entry should be a way in:
 * opening the schedule the whole town is clicking needs its facility and
 * department to build the command-centre link, and those columns cost nothing
 * once the row is being read anyway.
 */
export async function getAnalyticsRefs(
  supabase: SupabaseServerClient,
  summary: Pick<AnalyticsSummary, "topFacilities" | "topClickedSchedules">
): Promise<{ facilities: Map<string, FacilityRef>; schedules: Map<string, ScheduleRef> }> {
  const facilityIds = summary.topFacilities.map((f) => f.facilityId);
  const scheduleIds = summary.topClickedSchedules.map((s) => s.scheduleGroupId);

  const [facilities, schedules] = await Promise.all([
    facilityIds.length > 0
      ? supabase.from("facilities").select("id, name").in("id", facilityIds)
      : Promise.resolve({ data: [] as FacilityRef[] }),
    scheduleIds.length > 0
      ? supabase
          .from("schedule_groups")
          .select("id, name, facility_id, department_id")
          .in("id", scheduleIds)
      : Promise.resolve({ data: [] as ScheduleRef[] }),
  ]);

  return {
    facilities: new Map(((facilities.data ?? []) as FacilityRef[]).map((f) => [f.id, f])),
    schedules: new Map(((schedules.data ?? []) as ScheduleRef[]).map((s) => [s.id, s])),
  };
}

/**
 * Every facility and schedule name in the org.
 *
 * The raw-event export needs a name for any id that appears in any row, not
 * just the ones that made a top-ten list, and both tables are small enough
 * per org that fetching them whole is cheaper than collecting distinct ids
 * from 50,000 rows and asking for those.
 */
export async function getOrgEntityNames(
  supabase: SupabaseServerClient,
  orgId: string
): Promise<{ facilityNames: Map<string, string>; scheduleNames: Map<string, string> }> {
  const [facilities, schedules] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgId),
    supabase.from("schedule_groups").select("id, name").eq("org_id", orgId),
  ]);

  return {
    facilityNames: new Map((facilities.data ?? []).map((f) => [f.id, f.name])),
    scheduleNames: new Map((schedules.data ?? []).map((s) => [s.id, s.name])),
  };
}
