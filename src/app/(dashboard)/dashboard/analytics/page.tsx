import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Eye, MousePointerClick, Clock, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/dashboard/StatCard";
import { ViewsChart } from "@/components/dashboard/analytics/ViewsChart";
import { TemplateBreakdown } from "@/components/dashboard/analytics/TemplateBreakdown";
import { getAnalyticsSummary } from "@/lib/analytics/queries";
import { formatDurationShort } from "@/lib/utils/dates";
import Streamed from "@/components/ui/streamed";

/**
 * /dashboard/analytics — what visitors do with the published schedule:
 * widget + public facility page views, which template they looked at, which
 * sessions they clicked into, where they came from, and how long they stayed.
 * See 041_widget_analytics_expansion.sql for what's tracked and by which
 * events, and useScheduleAnalytics/SessionModal for the instrumentation.
 *
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * The Suspense boundary has to live inside this page — see the note in
 * dashboard/facilities/page.tsx for why a boundary in the layout is not
 * enough for navigations arriving from a sibling route.
 */
export const instant = true;

export default function AnalyticsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground mt-1">
          How visitors use your published schedule — the embedded widget and your public facility pages, last 30 days.
        </p>
      </div>

      <Suspense fallback={<AnalyticsBodySkeleton />}>
        <Streamed className="space-y-8">
          <AnalyticsBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function AnalyticsBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const orgId = orgContext.org.id;

  const summary = await getAnalyticsSummary(supabase, orgId, 30);

  const scheduleGroupIds = summary.topClickedSchedules.map((s) => s.scheduleGroupId);
  const { data: scheduleGroupRows } =
    scheduleGroupIds.length > 0
      ? await supabase.from("schedule_groups").select("id, name").in("id", scheduleGroupIds)
      : { data: [] as { id: string; name: string }[] };
  const scheduleGroupNames = new Map((scheduleGroupRows ?? []).map((g) => [g.id, g.name]));

  const clickThroughDisplay =
    summary.clickThroughRate !== null ? `${Math.round(summary.clickThroughRate * 100)}%` : "—";

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Eye} label="Views" value={String(summary.views)} />
        <StatCard icon={MousePointerClick} label="Session clicks" value={String(summary.clicks)} />
        <StatCard icon={Percent} label="Click-through rate" value={clickThroughDisplay} />
        <StatCard
          icon={Clock}
          label="Avg. time on schedule"
          value={summary.avgDurationMs !== null ? formatDurationShort(summary.avgDurationMs) : "—"}
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Views over time</h2>
        <Card className="p-5">
          <ViewsChart data={summary.viewsByDay} />
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">What visitors looked at</h2>
          <Card className="p-5">
            <TemplateBreakdown data={summary.templateBreakdown} />
          </Card>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Where views came from</h2>
          <Card className="divide-y divide-border py-0">
            {summary.topReferrers.length === 0 ? (
              <p className="text-sm text-muted-foreground/70 text-center py-6">No referrer data yet.</p>
            ) : (
              summary.topReferrers.map((r) => (
                <div key={r.referrer} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-foreground truncate">{r.referrer}</span>
                  <span className="font-medium text-foreground tabular-nums shrink-0 ml-3">{r.count}</span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Most-clicked sessions</h2>
        <Card className="divide-y divide-border py-0">
          {summary.topClickedSchedules.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-6">
              No clicks yet — this fills in once visitors open a session&apos;s details on your widget or facility page.
            </p>
          ) : (
            summary.topClickedSchedules.map((s) => (
              <div key={s.scheduleGroupId} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-foreground truncate">
                  {scheduleGroupNames.get(s.scheduleGroupId) ?? "Deleted schedule"}
                </span>
                <span className="font-medium text-foreground tabular-nums shrink-0 ml-3">{s.count}</span>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}

function AnalyticsBodySkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid md:grid-cols-2 gap-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
