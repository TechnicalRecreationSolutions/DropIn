import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Eye,
  Gauge,
  LogOut,
  MousePointerClick,
  Percent,
  Repeat,
  Timer,
  Users,
} from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { InfoTip, PageHeader } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/dashboard/analytics/MetricCard";
import { ViewsChart } from "@/components/dashboard/analytics/ViewsChart";
import { ActivityHeatmap } from "@/components/dashboard/analytics/ActivityHeatmap";
import { BreakdownBars } from "@/components/dashboard/analytics/BreakdownBars";
import { RankedList } from "@/components/dashboard/analytics/RankedList";
import { AnalyticsToolbar } from "@/components/dashboard/analytics/AnalyticsToolbar";
import { getAnalyticsRefs, getAnalyticsSummary } from "@/lib/analytics/queries";
import { formatDay, formatRangeLabel, parseAnalyticsRange } from "@/lib/analytics/range";
import { commandCentreHref, scheduleGroupScope, widgetHref } from "@/lib/schedule/commandCentreHref";
import { formatDurationShort } from "@/lib/utils/dates";

/**
 * /dashboard/analytics — what visitors do with the published schedule.
 *
 * Reach (views, visitors, where they came from), engagement (what they opened,
 * how long they stayed, whether they went on to register) and timing (which
 * weekday and hour), over any period, for the whole organization or one
 * facility, with every number downloadable as CSV.
 *
 * The events behind it: 041_widget_analytics_expansion.sql defines what is
 * tracked, `useScheduleAnalytics` and `SessionModal` fire it, and
 * `api/analytics/track` writes it. Nothing here reads
 * `analytics_daily_summary` — that view refreshes nightly and this page is
 * meant to move as visits happen.
 *
 * **Every tile states what it actually counts, behind its (i).** These are
 * proxies, not truths: a "view" is a page load and not a person, a "visitor"
 * is a hashed IP inside one day and cannot be followed to the next. A number
 * quoted in a budget request should carry its definition with it.
 *
 * Gated on `analytics:view` (owner + manager). That permission was declared
 * in roles.ts from the start and, until this change, asked by nothing —
 * coordinators could reach the page by URL even though the sidebar never
 * offered it to them.
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

interface AnalyticsPageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string; facility?: string }>;
}

export default function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader
          title="Analytics"
          info={
            <>
              How visitors use your embedded widget and public facility pages: how many look, what
              they open, where they arrive from and when. Nothing here identifies a person — visitor
              counts come from IP addresses hashed with a salt that changes daily.
            </>
          }
        />
      </div>

      {/* Its own boundary, and a cheap one: the controls come back as soon as
          the facility list does, without waiting behind the event read. */}
      <Suspense fallback={<Skeleton className="h-9 w-full max-w-md rounded-lg" />}>
        <ToolbarLoader />
      </Suspense>

      {/* searchParams is forwarded unread — awaiting it here would pull the
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<AnalyticsBodySkeleton />}>
        <Streamed className="space-y-8">
          <AnalyticsBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function ToolbarLoader() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  if (!can({ role: orgContext.membership.role, scopes: orgContext.scopes }, "analytics:view")) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  return <AnalyticsToolbar facilities={(data ?? []) as { id: string; name: string }[]} />;
}

async function AnalyticsBody({ searchParams }: AnalyticsPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  if (!can({ role: orgContext.membership.role, scopes: orgContext.scopes }, "analytics:view")) {
    return (
      <Card className="p-6">
        <h2 className="font-semibold text-foreground">Analytics is limited to owners and managers</h2>
        <p className="text-sm text-muted-foreground">
          Visitor numbers cover the whole organization, including departments outside your scope, so
          they are not shown to coordinator or auxiliary accounts.
        </p>
      </Card>
    );
  }

  const params = await searchParams;
  const range = parseAnalyticsRange(params);
  const facilityId = params.facility ?? null;

  const supabase = await createClient();
  const summary = await getAnalyticsSummary(supabase, {
    orgId: orgContext.org.id,
    range,
    facilityId,
  });
  const refs = await getAnalyticsRefs(supabase, summary);

  const periodLabel = formatRangeLabel(range).toLowerCase();
  const previousLabel = summary.previous
    ? `${formatDay(summary.previous.range.from)} – ${formatDay(summary.previous.range.to)}`
    : null;

  if (summary.eventCount === 0) {
    return <NoDataYet periodLabel={periodLabel} facilityId={facilityId} />;
  }

  const hasVisitors = summary.visitors > 0;

  return (
    <>
      {summary.truncated && (
        <Card className="flex-row items-start gap-3 p-4 ring-amber-500/30">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" aria-hidden />
          <p className="text-sm text-muted-foreground">
            This period holds more events than one page can read, so the numbers below cover{" "}
            <span className="font-medium text-foreground">{formatDay(summary.coveredFrom ?? range.from)}</span>{" "}
            onward only. Pick a shorter period for a complete count.
          </p>
        </Card>
      )}

      {/* ── Reach ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Reach"
          info={`How many times the published schedule was opened in the ${periodLabel}, and how far that went.${
            previousLabel ? ` Changes compare against ${previousLabel}.` : ""
          }`}
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard
            icon={Eye}
            label="Views"
            value={summary.views.toLocaleString()}
            change={ratioChange(summary.views, summary.previous?.views)}
            info="Every load of your embedded widget or a public facility page. One person refreshing four times is four views — see Unique visitors for the other reading."
          />
          <MetricCard
            icon={Users}
            label="Unique visitors"
            value={summary.visitors.toLocaleString()}
            info="Distinct visitors per day, added up across the period. Someone who checks the schedule on Monday and again on Friday counts twice: visitor IP addresses are hashed with a salt that changes every day, so they cannot be matched from one day to the next. That is a privacy guarantee, not a gap to be fixed."
          />
          <MetricCard
            icon={MousePointerClick}
            label="Session clicks"
            value={summary.clicks.toLocaleString()}
            change={ratioChange(summary.clicks, summary.previous?.clicks)}
            info="Times a visitor opened a session to read its details. Staff previewing their own schedule from the dashboard are not counted."
          />
          <MetricCard
            icon={ExternalLink}
            label="Registration clicks"
            value={summary.linkClicks.toLocaleString()}
            change={ratioChange(summary.linkClicks, summary.previous?.linkClicks)}
            info="Times a visitor followed the registration link on a session. This is intent rather than interest, and the only number that says whether keeping those links current is worth the staff time."
          />
          <MetricCard
            icon={Percent}
            label="Click-through rate"
            value={formatRate(summary.clickThroughRate)}
            change={ratioChange(summary.clickThroughRate, summary.previous?.clickThroughRate)}
            info="Session clicks divided by views. A low rate usually means the schedule answered the question at a glance, which is not a failure — read it next to time on schedule."
            goodDirection="neutral"
          />
        </div>
      </section>

      {/* ── Engagement ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Engagement"
          info="What visitors did once the schedule was in front of them. Time-on-page is measured when the tab closes or is hidden, so it exists for most visits but not all."
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard
            icon={Gauge}
            label="Registration rate"
            value={formatRate(summary.registrationRate)}
            detail={`${summary.linkClicks.toLocaleString()} of ${summary.clicks.toLocaleString()} opened sessions`}
            info="Of the visitors who opened a session, how many went on to follow its registration link. Sessions with no link at all drag this down — the lowest-effort way to raise it is to add the missing links."
          />
          <MetricCard
            icon={Repeat}
            label="Views per visitor"
            value={summary.viewsPerVisitor === null ? "—" : summary.viewsPerVisitor.toFixed(1)}
            info="Views divided by unique visitors, within a day. Well above 1 means people are coming back to the same schedule repeatedly — often a sign it changes, or that what they wanted was hard to find."
            goodDirection="neutral"
          />
          <MetricCard
            icon={Clock}
            label="Avg. time on schedule"
            value={summary.avgDurationMs === null ? "—" : formatDurationShort(summary.avgDurationMs)}
            detail={`${summary.durationSamples.toLocaleString()} measured visits`}
            info="Mean length of a visit. One tab left open all afternoon pulls this up hard, which is why the median sits beside it."
          />
          <MetricCard
            icon={Timer}
            label="Median time"
            value={summary.medianDurationMs === null ? "—" : formatDurationShort(summary.medianDurationMs)}
            info="The middle visit: half were shorter, half longer. The more honest of the two averages, and the one to quote."
          />
          <MetricCard
            icon={LogOut}
            label="Quick exits"
            value={formatRate(summary.quickExitRate)}
            detail="Visits under 10 seconds"
            info="Share of measured visits that ended within ten seconds. Some of these are people who got their answer immediately; a rising share alongside falling session clicks is the combination worth investigating."
            goodDirection="down"
          />
        </div>
      </section>

      {/* ── Over time ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Views over time"
          info="One point per day across the whole period, including days with nothing on them. Hover or drag across the chart for a day's numbers."
        />
        <Card className="p-5">
          <ViewsChart data={summary.byDay} showVisitors={hasVisitors} />
          {summary.busiestDay && (
            <p className="text-xs text-muted-foreground mt-2">
              Busiest day: <span className="font-medium text-foreground">{formatDay(summary.busiestDay.day)}</span>{" "}
              with {summary.busiestDay.views.toLocaleString()} views.
            </p>
          )}
        </Card>
      </section>

      {/* ── Timing ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="When visitors look"
          info="Views by weekday and hour, summed over the whole period. Useful for deciding when a schedule change will actually be seen — and when a closure needs more than a website update."
        />
        <Card className="p-5">
          <ActivityHeatmap heatmap={summary.heatmap} busiest={summary.busiestHour} />
        </Card>
      </section>

      {/* ── Breakdowns ──────────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <SectionHeading
            title="What visitors looked at"
            info="Which of the five schedule templates was on screen. A template switch counts too, so this answers what people read rather than how the page first happened to render."
          />
          <Card className="p-5">
            <BreakdownBars
              data={summary.templateBreakdown}
              variant="categorical"
              keyOrder={["grid", "list", "map", "floorplan", "board"]}
              emptyMessage="No template data yet."
            />
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="How they got here"
            info="The website each view arrived from. “Direct / no referrer” covers bookmarks, typed addresses, QR codes and apps that strip the referrer — on a widget embedded in your own site, the host page is what you should expect to see at the top."
          />
          <Card className="p-5">
            <BreakdownBars data={summary.topReferrers} emptyMessage="No traffic sources recorded yet." />
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="What they are using"
            info="Device type, from the browser's own description of itself. Worth checking before deciding how much effort a desktop-only layout deserves."
          />
          <Card className="p-5">
            <BreakdownBars
              data={summary.deviceBreakdown}
              variant="categorical"
              keyOrder={["mobile", "tablet", "desktop", "bot", "unknown"]}
              emptyMessage="No device data yet."
            />
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Where they looked"
            info="Whether the view came through the widget embedded on your own website or through a facility page hosted here. If one is near zero, that is the surface worth attention."
          />
          <Card className="p-5">
            <BreakdownBars
              data={summary.surfaceBreakdown}
              variant="categorical"
              keyOrder={["widget", "facility", "public"]}
              emptyMessage="No surface data yet."
            />
          </Card>
        </section>
      </div>

      {/* ── Visit length ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="How long they stayed"
          info="The shape behind the averages. A tall first bar with a long tail is the usual pattern: most people check one thing and leave, a few plan their week."
        />
        <Card className="p-5">
          <BreakdownBars
            data={summary.durationBuckets}
            variant="ordinal"
            emptyMessage="No visit lengths measured yet."
          />
          <p className="text-xs text-muted-foreground mt-3">
            Measured on {summary.durationSamples.toLocaleString()} of {summary.views.toLocaleString()} views. A visit
            is only measured if the browser reports the tab closing, which some do not.
          </p>
        </Card>
      </section>

      {/* ── Leaderboards ────────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-3">
          <SectionHeading
            title="Busiest facilities"
            info="Views attributed to a facility. An embed placed on a general page without a facility set records no facility, so those views are counted in the totals above but cannot appear here."
          />
          <Card className="py-0">
            <RankedList
              unitLabel="of views"
              total={summary.views}
              emptyMessage="No views are attributed to a facility yet."
              items={summary.topFacilities.map((f) => ({
                id: f.facilityId,
                count: f.count,
                label: refs.facilities.get(f.facilityId)?.name ?? "Deleted facility",
                href: refs.facilities.has(f.facilityId)
                  ? commandCentreHref({ facilityId: f.facilityId })
                  : undefined,
              }))}
            />
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title="Most-opened schedules"
            info="Which schedule a visitor was looking at when they opened a session's details. The clearest signal on the page of what your community actually comes for."
          />
          <Card className="py-0">
            <RankedList
              unitLabel="of clicks"
              total={summary.clicks}
              emptyMessage="No sessions opened yet — this fills in once visitors tap a session on your widget or facility page."
              items={summary.topClickedSchedules.map((s) => {
                const ref = refs.schedules.get(s.scheduleGroupId);
                return {
                  id: s.scheduleGroupId,
                  count: s.count,
                  label: ref?.name ?? "Deleted schedule",
                  href: ref ? commandCentreHref(scheduleGroupScope(ref)) : undefined,
                };
              })}
            />
          </Card>
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        {summary.eventCount.toLocaleString()} events across {range.days} day
        {range.days === 1 ? "" : "s"}
        {facilityId ? `, for ${refs.facilities.get(facilityId)?.name ?? "the selected facility"}` : ""}. Export any of
        this as a spreadsheet from the Export menu above.
      </p>
    </>
  );
}

/** A heading with its explanation behind an (i), matching PageHeader's pattern. */
function SectionHeading({ title, info }: { title: string; info: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <InfoTip label={`About ${title}`}>{info}</InfoTip>
    </div>
  );
}

/**
 * What the page shows before any visitor has arrived.
 *
 * A grid of zeroes is technically accurate and tells a new customer nothing.
 * The two reasons a real organization sees this are that the widget is not
 * embedded anywhere yet, or that the period is simply older than the account.
 */
function NoDataYet({ periodLabel, facilityId }: { periodLabel: string; facilityId: string | null }) {
  return (
    <Card className="p-6 gap-3">
      <h2 className="font-semibold text-foreground">Nothing recorded in the {periodLabel}</h2>
      <p className="text-sm text-muted-foreground">
        Visits are counted once your schedule is somewhere the public can see it
        {facilityId ? ", and this facility has had none in this period" : ""}. Two things to check:
      </p>
      <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
        <li>
          The <Link href={widgetHref({})} className="text-accent hover:underline">widget</Link> is embedded on your own
          website, and its schedules are published.
        </li>
        <li>The period above covers dates after you published — try a longer one.</li>
      </ul>
    </Card>
  );
}

/** Period-over-period change as a ratio, or null when there is nothing to compare. */
function ratioChange(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function AnalyticsBodySkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      {[0, 1].map((row) => (
        <div key={row} className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ))}
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
      <div className="grid md:grid-cols-2 gap-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
