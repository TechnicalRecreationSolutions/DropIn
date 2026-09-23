import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ClipboardList, Clock, Thermometer, Users } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { can, canReadFacility } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { InfoTip, PageHeader } from "@/components/ui/info-tip";
import { MetricCard } from "@/components/dashboard/analytics/MetricCard";
import { ActivityHeatmap } from "@/components/dashboard/analytics/ActivityHeatmap";
import { BreakdownBars } from "@/components/dashboard/analytics/BreakdownBars";
import { AnalyticsToolbar } from "@/components/dashboard/analytics/AnalyticsToolbar";
import { ATTENDANCE_DATASETS } from "@/lib/analytics/csv";
import DailyBars from "@/components/dashboard/analytics/DailyBars";
import { fetchReadings, summariseAttendance } from "@/lib/analytics/attendance";
import { formatRangeLabel, parseAnalyticsRange } from "@/lib/analytics/range";
import { METRICS, formatReading } from "@/lib/conditions/readings";

/**
 * /dashboard/analytics/attendance — who actually showed up.
 *
 * The third of the three stories (`layout.tsx`): Engagement is who looked at
 * the schedule, Utilization is what the building was programmed for, this is
 * what happened. Reads `facility_readings` (migration 061) — the head counts
 * lifeguards enter on `/dashboard/counts`.
 *
 * ## ⚠️ What these numbers are, and what they are not
 *
 * A head count is a number a person wrote down after looking at a pool. It is
 * not a turnstile. Two counts an hour apart may be the same forty people or
 * eighty different ones, so:
 *
 *   - **The peak is the defensible figure** — the most people observed at once.
 *   - **The average is an average of OBSERVATIONS**, not of attendance. An
 *     afternoon counted twice weighs the same as a morning counted ten times.
 *   - **There is deliberately no total.** Summing head counts produces a number
 *     that looks like "visits" and is nothing of the kind. A budget request
 *     wanting that number wants a turnstile.
 *
 * Every tile says so behind its (i), because a proxy quoted without its
 * definition is how a dashboard ends up in a council report meaning something
 * it never measured.
 *
 * Gated on `operations:view` — coordinators included.
 */
export const instant = true;

interface AttendancePageProps {
  searchParams: Promise<{ range?: string; from?: string; to?: string; facility?: string }>;
}

export default function AttendancePage({ searchParams }: AttendancePageProps) {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader
          title="Attendance"
          info={
            <>
              Head counts recorded by staff on the head count tool, and the water and air
              temperatures logged alongside them. These are observations made by eye, not
              turnstile numbers — read the note on each tile before quoting one.
            </>
          }
        />
      </div>

      <Suspense fallback={<Skeleton className="h-9 w-full max-w-md rounded-lg" />}>
        <ToolbarLoader />
      </Suspense>

      <Suspense fallback={<AttendanceSkeleton />}>
        <Streamed className="space-y-8">
          <AttendanceBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function ToolbarLoader() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  if (!can(actor, "operations:view")) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  // A coordinator is offered only the buildings they hold. Offering one whose
  // readings they cannot read would render an empty page that looks like "we
  // never count there".
  const visible = (data ?? []).filter((f) => canReadFacility(actor, f.id));
  return <AnalyticsToolbar facilities={visible as { id: string; name: string }[]} datasets={ATTENDANCE_DATASETS} />;
}

async function AttendanceBody({ searchParams }: AttendancePageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  if (!can(actor, "operations:view")) {
    return (
      <Card className="p-6">
        <h2 className="font-semibold text-foreground">Not available for this account</h2>
        <p className="text-sm text-muted-foreground">
          Attendance covers the whole building, including departments outside your scope.
        </p>
      </Card>
    );
  }

  const params = await searchParams;
  const range = parseAnalyticsRange(params);
  const facilityId = params.facility ?? null;

  const supabase = await createClient();

  const [{ data: facilityRows }, { data: spaceRows }] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgContext.org.id),
    supabase.from("spaces").select("id, name").eq("org_id", orgContext.org.id),
  ]);

  // Scoped roles are confined to their own buildings. RLS already refuses the
  // rows; passing the list keeps the query from asking for them at all.
  const scopedIds = (facilityRows ?? [])
    .map((f) => f.id)
    .filter((id) => canReadFacility(actor, id));

  const fetched = await fetchReadings(supabase, {
    orgId: orgContext.org.id,
    range,
    facilityId,
    facilityIds: scopedIds,
  });
  const summary = summariseAttendance(fetched, range);

  const spaceNames = new Map((spaceRows ?? []).map((s) => [s.id, s.name]));
  const periodLabel = formatRangeLabel(range).toLowerCase();

  if (summary.readingCount === 0) {
    return <NothingCounted periodLabel={periodLabel} facilityId={facilityId} />;
  }

  // 7 × 24, the shape ActivityHeatmap takes. Averages rather than counts: the
  // question is "how busy is a Tuesday at 6pm", not "how often did we count".
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let busiest: { weekday: number; hour: number; views: number } | null = null;
  for (const cell of summary.heatmap) {
    const value = Math.round(cell.average);
    grid[cell.dayIndex][cell.hour] = value;
    if (!busiest || value > busiest.views) {
      busiest = { weekday: cell.dayIndex, hour: cell.hour, views: value };
    }
  }

  const spaceBreakdown = summary.bySpace.map((s) => ({
    key: s.spaceId ?? "facility",
    label: s.spaceId ? (spaceNames.get(s.spaceId) ?? "A space") : "Whole building",
    count: s.peak,
    share: summary.peak ? s.peak / summary.peak.value : 0,
  }));

  return (
    <>
      {summary.truncated && (
        <Card className="flex-row items-start gap-3 p-4 ring-amber-500/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-sm text-muted-foreground">
            This period holds more readings than one page can read, so the figures below cover
            only the most recent part of it. Pick a shorter period for a complete count.
          </p>
        </Card>
      )}

      {/* ── The numbers ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Head counts"
          info={`Every count staff recorded in the ${periodLabel}.`}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            icon={Users}
            label="Peak"
            value={summary.peak ? String(Math.round(summary.peak.value)) : "—"}
            detail={
              summary.peak
                ? new Date(summary.peak.recordedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                  })
                : undefined
            }
            info="The most people recorded in one count. The most defensible number on this page — it is a single observation, not an average of several, and it is the figure a capacity argument rests on."
          />
          <MetricCard
            icon={Users}
            label="Typical count"
            value={summary.averageCount != null ? String(Math.round(summary.averageCount)) : "—"}
            info="The mean of every count recorded. NOT average attendance: an afternoon counted twice weighs the same as a morning counted ten times, so this moves when counting habits change, not only when attendance does."
          />
          <MetricCard
            icon={Clock}
            label="Busiest hour"
            value={summary.busiestHour != null ? formatHour(summary.busiestHour) : "—"}
            info="The hour of the day with the highest average count, across every weekday. Needs at least three counts in an hour before it will name it, so one quiet Sunday evening cannot become 'the busiest hour'."
          />
          <MetricCard
            icon={ClipboardList}
            label="Counts recorded"
            value={summary.readingCount.toLocaleString()}
            detail={`on ${summary.daysCovered} ${summary.daysCovered === 1 ? "day" : "days"}`}
            info="How much data is behind everything else here. A low number over a long period means the averages are thin — the second line says how many separate days were covered."
          />
        </div>
        {/* The one thing this page will be asked for and must not invent. */}
        <p className="text-xs text-muted-foreground">
          There is no total-visits figure here on purpose: adding head counts together would
          double-count anyone present for two of them.
        </p>
      </section>

      {/* ── Day by day ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Day by day"
          info="The highest count recorded on each day. A day with no bar is a day nobody counted, which is not the same as a day nobody came — and is worth noticing either way."
        />
        <Card className="p-4">
          <DailyBars
            data={summary.byDay.map((d) => ({ day: d.day, value: d.peak }))}
            valueLabel="Peak count"
            precision={0}
          />
        </Card>
      </section>

      {/* ── When ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="When people are here"
          info="The average count for each weekday and hour. This is the chart that changes a schedule: an hour that is reliably empty is an hour you can move a program into, and one that is reliably full is one to staff for."
        />
        <Card className="p-4">
          {/* The grid is Engagement's, and its default noun is "views".
                Head counts are people — see ActivityHeatmap's `unit`. */}
            <ActivityHeatmap
              heatmap={grid}
              busiest={busiest}
              unit={{ one: "person on average", many: "people on average" }}
            />
        </Card>
      </section>

      {/* ── Where ───────────────────────────────────────────────────────── */}
      {spaceBreakdown.length > 1 && (
        <section className="space-y-3">
          <SectionHeading
            title="Where"
            info="Peak count per space. 'Whole building' is the counts recorded without naming a space — at most facilities that is all of them."
          />
          <Card className="p-4">
            <BreakdownBars data={spaceBreakdown} variant="single" />
          </Card>
        </section>
      )}

      {/* ── Temperatures ────────────────────────────────────────────────── */}
      {summary.temperatures.length > 0 && (
        <section className="space-y-3">
          <SectionHeading
            title="Temperature"
            info="Recorded on the same tool as the head counts. One reading is a fact; a period of them is how a failing boiler shows up before anyone complains."
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.temperatures.map((t) => (
              <MetricCard
                key={t.metric}
                icon={Thermometer}
                label={METRICS[t.metric].label}
                value={formatReading(t.metric, t.average)}
                detail={`${formatReading(t.metric, t.min)} – ${formatReading(t.metric, t.max)}`}
                info={`The mean of ${t.samples} ${t.samples === 1 ? "reading" : "readings"} in this period, with the lowest and highest underneath. A wide spread on water temperature is worth a look at the plant.`}
              />
            ))}
          </div>
        </section>
      )}
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

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * What the page shows before anyone has counted anything.
 *
 * A grid of dashes is accurate and useless. The one reason a real organization
 * sees this is that nobody has used the tool yet, so the page says that and
 * links straight to it.
 */
function NothingCounted({
  periodLabel,
  facilityId,
}: {
  periodLabel: string;
  facilityId: string | null;
}) {
  return (
    <Card className="gap-3 p-6">
      <h2 className="font-semibold text-foreground">No counts recorded in the {periodLabel}</h2>
      <p className="text-sm text-muted-foreground">
        Head counts are entered by staff on the head count tool — a lifeguard on deck taps a
        number and it lands here. Once a few weeks have been recorded, this page can say when the
        building is busy, and the public schedule can say how busy it is right now.
      </p>
      <Link
        href={facilityId ? `/dashboard/counts?facility=${facilityId}` : "/dashboard/counts"}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-2"
      >
        Open the head count tool
        <ArrowUpRight className="size-4" aria-hidden />
      </Link>
    </Card>
  );
}

function AttendanceSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
