import { Suspense } from "react";
import { AlertOctagon, Clock, Megaphone, TriangleAlert } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { can, canReadFacility } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { InfoTip, PageHeader } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/dashboard/analytics/MetricCard";
import { BreakdownBars } from "@/components/dashboard/analytics/BreakdownBars";
import { AnalyticsToolbar } from "@/components/dashboard/analytics/AnalyticsToolbar";
import NoticeHistoryList, { type NoticeHistoryRow } from "@/components/dashboard/analytics/NoticeHistoryList";
import { NOTICE_DATASETS } from "@/lib/analytics/csv";
import { fetchNoticeHistory, noticeDurationMinutes } from "@/lib/analytics/notices";
import { formatRangeLabel, parseAnalyticsRange } from "@/lib/analytics/range";
import { CATEGORY_LABEL, isNoticeFinished } from "@/lib/status/notices";

/**
 * /dashboard/analytics/notices — every status notice in a period.
 *
 * The facility status page used to end in a folded "History" list: the last
 * 20 finished notices, one building at a time. On 2026-10-01 the user moved it
 * here — the status page is for what is wrong now, and history wants a period,
 * a facility filter and an export like the rest of this section.
 *
 * Not `/analytics/status`: the sidebar's Status item lights up for any path
 * ending in `/status`, and would have claimed this page.
 *
 * Gated on `operations:view` (owner, manager, coordinator), the same as
 * Attendance — it is about the building's operation, not visitor data.
 */
export const instant = true;

interface NoticesPageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string; facility?: string }>;
}

export default function NoticeHistoryPage({ searchParams }: NoticesPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Status history"
          info={
            <>
              Every closure, caution and notice posted on a facility status page, including
              the ones since cleared. A notice is counted in every period it was in force.
            </>
          }
        />
      </div>

      <Suspense fallback={<Skeleton className="h-9 w-full max-w-md rounded-full" />}>
        <ToolbarLoader />
      </Suspense>

      <Suspense fallback={<HistorySkeleton />}>
        <Streamed className="space-y-8">
          <NoticesBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

/**
 * The period and export controls. The building is not chosen here — it is
 * the sidebar's switcher ("All facilities" included, for owners and managers),
 * read from the same `?facility` the body and the export use.
 */
async function ToolbarLoader() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  if (!can(actor, "operations:view")) return null;

  return <AnalyticsToolbar datasets={NOTICE_DATASETS} />;
}

async function NoticesBody({ searchParams }: NoticesPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  if (!can(actor, "operations:view")) {
    return (
      <Card className="p-6">
        <h2 className="text-card-title text-foreground">Not available for this account</h2>
        <p className="text-sm text-muted-foreground">
          Status history is available to owners, managers and coordinators.
        </p>
      </Card>
    );
  }

  const params = await searchParams;
  const range = parseAnalyticsRange(params);
  const facilityId = params.facility ?? null;
  const supabase = await createClient();

  const [{ data: facilityRows }, { data: spaceRows }, { data: departmentRows }] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgContext.org.id),
    supabase.from("spaces").select("id, name").eq("org_id", orgContext.org.id),
    supabase.from("departments").select("id, name").eq("org_id", orgContext.org.id),
  ]);

  const scopedIds = (facilityRows ?? []).map((f) => f.id).filter((id) => canReadFacility(actor, id));
  const { notices, truncated } = await fetchNoticeHistory(supabase, {
    orgId: orgContext.org.id,
    range,
    facilityId,
    facilityIds: scopedIds,
  });

  const periodLabel = formatRangeLabel(range).toLowerCase();

  if (notices.length === 0) {
    return (
      <Card className="gap-2 p-6">
        <h2 className="text-card-title text-foreground">Nothing posted in the {periodLabel}</h2>
        <p className="text-sm text-muted-foreground">
          No status notices were in force at {facilityId ? "this facility" : "any facility"} during
          this period.
        </p>
      </Card>
    );
  }

  const now = new Date();
  const facilityNames = new Map((facilityRows ?? []).map((f) => [f.id, f.name]));
  const spaceNames = new Map((spaceRows ?? []).map((s) => [s.id, s.name]));
  const departmentNames = new Map((departmentRows ?? []).map((d) => [d.id, d.name]));

  const closures = notices.filter((n) => n.severity === "closure");
  const closureHours = closures.reduce((sum, n) => sum + noticeDurationMinutes(n, now), 0) / 60;
  const live = notices.filter((n) => !isNoticeFinished(n, now) && new Date(n.starts_at) <= now);

  const byCategory = new Map<string, number>();
  for (const n of notices) byCategory.set(n.category, (byCategory.get(n.category) ?? 0) + 1);
  const categoryBars = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      key: category,
      label: CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category,
      count,
      share: count / notices.length,
    }));

  const rows: NoticeHistoryRow[] = notices.map((n) => ({
    id: n.id,
    headline: n.headline,
    severity: n.severity,
    category: CATEGORY_LABEL[n.category] ?? n.category,
    facility: facilityNames.get(n.facility_id) ?? "A facility",
    where:
      (n.space_id ? spaceNames.get(n.space_id) : undefined) ??
      (n.department_id ? departmentNames.get(n.department_id) : undefined) ??
      "Whole facility",
    startsAt: n.starts_at,
    endsAt: n.ends_at,
    minutes: noticeDurationMinutes(n, now),
    state: new Date(n.starts_at) > now ? "scheduled" : isNoticeFinished(n, now) ? "ended" : "up",
  }));

  return (
    <>
      {truncated && (
        <Banner variant="warning" role={undefined}>
          This period has more notices than one page shows, so the list covers only the most
          recent. Pick a shorter period for all of them.
        </Banner>
      )}

      <section className="space-y-3">
        <SectionHeading
          title="In this period"
          info={`Notices in force at any point in the ${periodLabel}, cleared or not. Unpublished drafts and staff reports that were never approved are not counted — they never reached the public.`}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon={Megaphone}
            label="Notices"
            value={notices.length.toLocaleString()}
            info="Every published notice whose window overlaps this period. One that ran across the start or end of the period is counted in both periods."
          />
          <MetricCard
            icon={AlertOctagon}
            label="Closures"
            value={closures.length.toLocaleString()}
            info="Notices posted at closure severity — the ones that told patrons a space or the building was shut."
          />
          <MetricCard
            icon={Clock}
            label="Hours closed"
            value={closureHours >= 10 ? String(Math.round(closureHours)) : closureHours.toFixed(1)}
            info="How long the closure notices were in force, added together, from posting to clearing (or to now, if still up). Two closures at once count twice — this is notice-hours, not building-hours."
          />
          <MetricCard
            icon={TriangleAlert}
            label="Up right now"
            value={live.length.toLocaleString()}
            info="Notices in this list that have not been cleared yet."
          />
        </div>
      </section>

      {categoryBars.length > 1 && (
        <section className="space-y-3">
          <SectionHeading
            title="What happened"
            info="Notices by category. A category that keeps coming back — a heater, a lane rope — is a maintenance conversation."
          />
          <Card className="p-4">
            <BreakdownBars data={categoryBars} variant="single" />
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading title="Every notice" info="Newest first, with how long each one was up." />
        <NoticeHistoryList
          rows={rows}
          showFacility={!facilityId && new Set(notices.map((n) => n.facility_id)).size > 1}
        />
      </section>
    </>
  );
}

function SectionHeading({ title, info }: { title: string; info: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-heading text-foreground">{title}</h2>
      <InfoTip label={`About ${title}`}>{info}</InfoTip>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
