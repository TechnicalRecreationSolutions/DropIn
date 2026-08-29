import type { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/utils/dates";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type EventRow = {
  event_type: string;
  schedule_group_id: string | null;
  facility_id: string | null;
  view_template: string | null;
  duration_ms: number | null;
  referrer_url: string | null;
  occurred_at: string;
};

const ROW_CAP = 20_000;

/**
 * All analytics_events for this org in the last N days, capped so a busy
 * embed can't make this query unbounded. Raw rows, not the nightly
 * materialized view — the overview ticker and dashboard are meant to move
 * as visits happen, not once a day.
 */
async function fetchEvents(supabase: SupabaseServerClient, orgId: string, days: number): Promise<EventRow[]> {
  const { data } = await supabase
    .from("analytics_events")
    .select("event_type, schedule_group_id, facility_id, view_template, duration_ms, referrer_url, occurred_at")
    .eq("org_id", orgId)
    .gte("occurred_at", daysAgoIso(days))
    .order("occurred_at", { ascending: false })
    .limit(ROW_CAP);
  return (data as EventRow[] | null) ?? [];
}

export interface AnalyticsSummary {
  views: number;
  clicks: number;
  avgDurationMs: number | null;
  clickThroughRate: number | null;
  viewsByDay: { day: string; views: number }[];
  templateBreakdown: { template: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  topClickedSchedules: { scheduleGroupId: string; count: number }[];
}

const VIEW_EVENTS = new Set(["widget_view", "facility_view", "schedule_view"]);

/** Groups a referrer URL down to its hostname, or "Direct" with none. */
function referrerLabel(url: string | null): string {
  if (!url) return "Direct / no referrer";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Direct / no referrer";
  }
}

export async function getAnalyticsSummary(
  supabase: SupabaseServerClient,
  orgId: string,
  days = 30
): Promise<AnalyticsSummary> {
  const events = await fetchEvents(supabase, orgId, days);

  const viewRows = events.filter((e) => VIEW_EVENTS.has(e.event_type));
  const clickRows = events.filter((e) => e.event_type === "program_click");
  const durationRows = events.filter(
    (e): e is EventRow & { duration_ms: number } => e.event_type === "session_duration" && e.duration_ms !== null
  );

  const views = viewRows.length;
  const clicks = clickRows.length;
  const avgDurationMs =
    durationRows.length > 0
      ? Math.round(durationRows.reduce((sum, e) => sum + e.duration_ms, 0) / durationRows.length)
      : null;
  const clickThroughRate = views > 0 ? clicks / views : null;

  const viewsByDayMap = new Map<string, number>();
  for (const e of viewRows) {
    const day = e.occurred_at.slice(0, 10);
    viewsByDayMap.set(day, (viewsByDayMap.get(day) ?? 0) + 1);
  }
  const viewsByDay = Array.from(viewsByDayMap.entries())
    .map(([day, views]) => ({ day, views }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const templateMap = new Map<string, number>();
  for (const e of events) {
    if (!e.view_template) continue;
    if (!VIEW_EVENTS.has(e.event_type) && e.event_type !== "view_change") continue;
    templateMap.set(e.view_template, (templateMap.get(e.view_template) ?? 0) + 1);
  }
  const templateBreakdown = Array.from(templateMap.entries())
    .map(([template, count]) => ({ template, count }))
    .sort((a, b) => b.count - a.count);

  const referrerMap = new Map<string, number>();
  for (const e of viewRows) {
    const label = referrerLabel(e.referrer_url);
    referrerMap.set(label, (referrerMap.get(label) ?? 0) + 1);
  }
  const topReferrers = Array.from(referrerMap.entries())
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const clickedMap = new Map<string, number>();
  for (const e of clickRows) {
    if (!e.schedule_group_id) continue;
    clickedMap.set(e.schedule_group_id, (clickedMap.get(e.schedule_group_id) ?? 0) + 1);
  }
  const topClickedSchedules = Array.from(clickedMap.entries())
    .map(([scheduleGroupId, count]) => ({ scheduleGroupId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { views, clicks, avgDurationMs, clickThroughRate, viewsByDay, templateBreakdown, topReferrers, topClickedSchedules };
}
