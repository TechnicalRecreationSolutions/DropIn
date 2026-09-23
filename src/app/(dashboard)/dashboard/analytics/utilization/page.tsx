import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, LayoutGrid, Percent, Repeat } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { InfoTip, PageHeader } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/dashboard/analytics/MetricCard";
import { BreakdownBars } from "@/components/dashboard/analytics/BreakdownBars";
import { AnalyticsToolbar } from "@/components/dashboard/analytics/AnalyticsToolbar";
import { UTILIZATION_DATASETS } from "@/lib/analytics/csv";
import { getUtilization, MAX_UTILIZATION_DAYS } from "@/lib/analytics/utilization";
import { formatRangeLabel, parseAnalyticsRange } from "@/lib/analytics/range";
import { formatHours } from "@/lib/schedule/weekOverview";
import { occupancyKindLabel } from "@/lib/sessions/occupancy";
import DailyBars from "@/components/dashboard/analytics/DailyBars";

/**
 * /dashboard/analytics/utilization — what the building is programmed for.
 *
 * The week panel's overview, off one week and out of one editor. See
 * `src/lib/analytics/utilization.ts` for the arithmetic and the three rules it
 * carries over: two kinds of hour, drop-in figures as what is LEFT, and open
 * hours resolved from 058 *and* 059.
 *
 * Gated on `operations:view`, which includes coordinators — unlike Engagement.
 * A coordinator filling the schedule is exactly who needs to know how much of
 * the week is unprogrammed. `layout.tsx` has the reasoning.
 *
 * Opted in to instant-navigation validation, like its siblings; the Suspense
 * boundary lives in the page rather than the layout for the reason in
 * dashboard/facilities/page.tsx.
 */
export const instant = true;

interface UtilizationPageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string; facility?: string }>;
}

export default function UtilizationPage({ searchParams }: UtilizationPageProps) {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader
          title="Utilization"
          info={
            <>
              How much of the time you are open is actually programmed, and what it is programmed
              for. Everything here is the SCHEDULE — what the building is set up to do — not who
              turned up. Attendance answers that.
            </>
          }
        />
      </div>

      <Suspense fallback={<Skeleton className="h-9 w-full max-w-md rounded-lg" />}>
        <ToolbarLoader />
      </Suspense>

      <Suspense fallback={<UtilizationSkeleton />}>
        <Streamed className="space-y-8">
          <UtilizationBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function ToolbarLoader() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  if (!can({ role: orgContext.membership.role, scopes: orgContext.scopes }, "operations:view")) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  return <AnalyticsToolbar facilities={(data ?? []) as { id: string; name: string }[]} datasets={UTILIZATION_DATASETS} />;
}

async function UtilizationBody({ searchParams }: UtilizationPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  if (!can(actor, "operations:view")) {
    return (
      <Card className="p-6">
        <h2 className="font-semibold text-foreground">Not available for this account</h2>
        <p className="text-sm text-muted-foreground">
          Utilization covers the whole building, including departments outside your scope.
        </p>
      </Card>
    );
  }

  const params = await searchParams;
  const range = parseAnalyticsRange(params);
  const facilityId = params.facility ?? null;

  const supabase = await createClient();
  const data = await getUtilization(supabase, {
    orgId: orgContext.org.id,
    range,
    facilityId,
  });

  const periodLabel = formatRangeLabel(range).toLowerCase();

  if (data.totalOccurrences === 0) {
    return (
      <Card className="gap-3 p-6">
        <h2 className="font-semibold text-foreground">Nothing scheduled in the {periodLabel}</h2>
        <p className="text-sm text-muted-foreground">
          This page reads the schedule itself, so it fills in as soon as there are sessions in the
          period. Try a wider range, or a different building.
        </p>
      </Card>
    );
  }

  // The share of open time that has something in it. Hidden entirely when no
  // department has hours — a percentage of a denominator nobody set is not a
  // number worth printing, and the callout below names what to fix instead.
  const programmedShare = data.hasOpenHours
    ? Math.round((data.programmedMinutes / data.openMinutes) * 100)
    : null;

  const kindRows = data.byKind.map((k) => ({
    key: k.kind,
    label: occupancyKindLabel(k.kind),
    count: Math.round(k.clockMinutes / 60),
    share: data.busyMinutes > 0 ? k.clockMinutes / data.busyMinutes : 0,
  }));

  const spaceRows = data.byKind.map((k) => ({
    key: k.kind,
    label: occupancyKindLabel(k.kind),
    count: Math.round(k.spaceMinutes / 60),
    share: data.totalSpaceMinutes > 0 ? k.spaceMinutes / data.totalSpaceMinutes : 0,
  }));

  return (
    <>
      {data.clamped && (
        <Card className="flex-row items-start gap-3 p-4 ring-amber-500/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-sm text-muted-foreground">
            This page expands the schedule week by week, so it covers at most{" "}
            {MAX_UTILIZATION_DAYS} days. The figures below are the most recent{" "}
            {MAX_UTILIZATION_DAYS} days of the period you chose.
          </p>
        </Card>
      )}

      {data.departmentsWithoutHours.length > 0 && (
        <Card className="flex-row items-start gap-3 p-4 ring-amber-500/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {/* Named, not counted — the same rule the Overview's alert row follows. */}
            <span className="font-medium text-foreground">
              {data.departmentsWithoutHours.map((d) => d.name).join(", ")}
            </span>{" "}
            {data.departmentsWithoutHours.length === 1 ? "has" : "have"} no operating hours, so
            nothing here can say what share of the day was programmed.{" "}
            <Link
              href={`/dashboard/facilities/${facilityId ?? ""}/departments/${data.departmentsWithoutHours[0].id}/edit#hours`}
              className="underline underline-offset-2"
            >
              Set them
            </Link>
            .
          </p>
        </Card>
      )}

      {/* ── The shape of the period ─────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="The period"
          info={`Every figure covers the ${periodLabel}, across ${data.daysCovered} days.`}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon={CalendarClock}
            label="Programmed"
            value={formatHours(data.programmedMinutes)}
            detail={programmedShare !== null ? `${programmedShare}% of open hours` : undefined}
            info="Hours with at least one session running, counted once however many run at the same time, and clipped to the hours you are open. This is 'when is the building doing something', not 'how much is it doing'."
          />
          <MetricCard
            icon={LayoutGrid}
            label="Space-hours"
            value={formatHours(data.totalSpaceMinutes)}
            info="Every occurrence's length multiplied by the number of spaces it holds. A two-hour booking of four lanes is eight space-hours. This is the capacity measure — it is what makes a four-lane lengths block bigger than a one-lane aquafit class, which it is."
          />
          <MetricCard
            icon={Percent}
            label={data.hasOpenHours ? "Unprogrammed" : "Running outside hours"}
            value={formatHours(
              data.hasOpenHours ? data.unprogrammedMinutes : data.outsideOpenMinutes
            )}
            goodDirection="down"
            info={
              data.hasOpenHours
                ? "Hours you are open with nothing scheduled in them. Not necessarily wasted — a pool needs turnaround and maintenance windows — but it is the room you have."
                : "No department here has operating hours, so there is no open time to compare against. This is time the schedule runs at all."
            }
          />
          <MetricCard
            icon={Repeat}
            label="Occurrences"
            value={data.totalOccurrences.toLocaleString()}
            detail={`${data.totalSessions} recurring ${data.totalSessions === 1 ? "session" : "sessions"}`}
            info="Individual blocks on the calendar. The second line counts the recurring sessions behind them — one weekly lane swim is one session and about thirteen occurrences in a quarter."
          />
        </div>
      </section>

      {/* ── What the hours went to ──────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="What the time went to"
          info="Two deliberately different numbers. Clock hours answer 'when is the building doing this' and count parallel sessions once. Space-hours answer 'how much of what we have did it consume'. Adding up durations instead would double-count anything running in parallel, and a busy Saturday could report more hours than the day has."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-3 p-4">
            <h3 className="text-sm font-medium text-foreground">Clock hours</h3>
            <BreakdownBars
              data={kindRows}
              variant="categorical"
              keyOrder={["drop_in", "program", "rental", "closure"]}
              emptyMessage="Nothing scheduled in this period."
            />
          </Card>
          <Card className="gap-3 p-4">
            <h3 className="text-sm font-medium text-foreground">Space-hours</h3>
            <BreakdownBars
              data={spaceRows}
              variant="categorical"
              keyOrder={["drop_in", "program", "rental", "closure"]}
              emptyMessage="Nothing scheduled in this period."
            />
          </Card>
        </div>
        <p className="text-xs text-muted-foreground">
          Drop-in figures are what is <em>left</em>: a rental holding a lane is already subtracted,
          so these are hours actually available to the public.
        </p>
      </section>

      {/* ── Day by day ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Day by day"
          info="Programmed hours against open hours, one bar per day. Days with no bar are days nothing was scheduled — which on a day you were open is the finding, not a gap in the chart."
        />
        <Card className="p-4">
          <DailyBars
            data={data.byDate.map((d) => ({
              day: d.date,
              value: d.programmedMinutes / 60,
              reference: d.openMinutes > 0 ? d.openMinutes / 60 : null,
            }))}
            valueLabel="Programmed"
            referenceLabel="Open"
            unit="h"
          />
        </Card>
      </section>
    </>
  );
}

function SectionHeading({ title, info }: { title: string; info: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <InfoTip label={`About ${title}`}>{info}</InfoTip>
    </div>
  );
}

function UtilizationSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
