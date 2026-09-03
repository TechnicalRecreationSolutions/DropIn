import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Building2,
  Calendar,
  ArrowRight,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardPageSkeleton as DashboardOverviewSkeleton } from "@/components/layout/DashboardChromeSkeletons";
import { NO_DEPARTMENT, commandCentreHref, scheduleGroupScope } from "@/lib/schedule/commandCentreHref";
import { deriveScheduleStatus } from "@/lib/schedule/scheduleStatus";
import { localDateString, daysAgoIso, formatDurationShort } from "@/lib/utils/dates";
import { getSportCategory } from "@/lib/utils/sport-categories";
import ScheduleListSection, {
  type ScheduleListRow,
} from "@/components/schedule-list/ScheduleListSection";
import { StatCard } from "@/components/dashboard/StatCard";
import { AnalyticsTicker, type TickerStat } from "@/components/dashboard/analytics/AnalyticsTicker";
import { findOrgConflicts } from "@/lib/sessions/conflicts";
import { getAnalyticsSummary } from "@/lib/analytics/queries";
import Streamed from "@/components/ui/streamed";

/**
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * Nearly everything on the overview is org-specific — even the heading greets
 * the org by name — so the whole body streams behind one boundary rather than
 * being split further. The boundary has to live inside this page: see the note
 * in dashboard/facilities/page.tsx.
 */
export const instant = true;

interface DashboardPageProps {
  searchParams: Promise<{ facility?: string; department?: string; schedule?: string }>;
}

export default function DashboardPage({ searchParams }: DashboardPageProps) {
  return (
    <Suspense fallback={<DashboardOverviewSkeleton />}>
      <Streamed>
        <DashboardOverview searchParams={searchParams} />
      </Streamed>
    </Suspense>
  );
}

type RecentFacility = {
  id: string;
  name: string;
  is_published: boolean;
  updated_at: string;
  kind: "facility";
};

type RecentScheduleGroup = {
  id: string;
  name: string;
  is_published: boolean;
  updated_at: string;
  facility_id: string;
  department_id: string | null;
  kind: "schedule_group";
};

type RecentItem = RecentFacility | RecentScheduleGroup;

function scheduleGroupHref(sg: { facility_id: string; department_id: string | null; id: string }) {
  return commandCentreHref(scheduleGroupScope(sg));
}

async function DashboardOverview({ searchParams }: DashboardPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const {
    facility: facilityParam,
    department: departmentParam,
    schedule: scheduleParam,
  } = await searchParams;

  const thirtyDaysAgo = daysAgoIso(30);

  // Only the schedule-groups read needs to know which facility is selected, and
  // picking that needs the facility list first. Everything else is scoped by
  // org alone, so it is issued in the *same* wave as the facility list rather
  // than waiting behind it. Hosted Supabase charges ~80ms per hop regardless of
  // the query, so the ordering here is what the page costs: two waves, not
  // three.
  //
  // `start()` is not decoration. A PostgREST builder is lazy — it holds the
  // query and only issues the request when something calls `.then()` on it, so
  // assigning one to a const starts nothing. Without this, the four org-scoped
  // reads below would not begin until the `Promise.allSettled` further down,
  // which is *after* the facility list has been awaited: the code would read as
  // parallel and run as a third sequential wave.
  const start = <T,>(builder: PromiseLike<T>): Promise<T> => Promise.resolve(builder);

  const facilityListPromise = start(
    supabase
      // Ordered by name to match the sidebar tree — "the first facility" means
      // the same building in both places.
      .from("facilities")
      .select("id, name, slug, is_published, updated_at")
      .eq("org_id", orgId)
      .order("name")
  );

  const recentFacilitiesPromise = start(
    supabase
      .from("facilities")
      .select("id, name, is_published, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(6)
  );

  const recentScheduleGroupsPromise = start(
    supabase
      .from("schedule_groups")
      .select("id, name, status, updated_at, facility_id, department_id")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(6)
  );

  // Raw rows, not a head count — the "Activity (30d)" stat card is scoped
  // to the current facility/department/schedule filter in JS below.
  // activity_log spans six tables (038_activity_log.sql) with no
  // facility_id column of its own, so each row is matched against the id
  // sets the facility/department/schedule-scoped queries below produce.
  const activityLogPromise = start(
    supabase
      .from("activity_log")
      .select("table_name, row_id")
      .eq("org_id", orgId)
      .gte("created_at", thirtyDaysAgo)
      .limit(5000)
  );

  // Conflicts stat card (039_session_conflict_dismissals.sql) — computed
  // on demand, not from a persisted count; see findOrgConflicts(). Also
  // scoped to the current filter in JS below.
  const conflictsPromise = findOrgConflicts(supabase, orgId);

  const { data: facilityRows } = await facilityListPromise;

  const facilities = facilityRows ?? [];
  const isNew = facilities.length === 0;
  const selectedFacility =
    facilities.find((f) => f.id === facilityParam) ?? facilities[0] ?? null;

  const [
    scheduleGroupsRes,
    recentFacilitiesRes,
    recentScheduleGroupsRes,
    activityLogRes,
    conflictsRes,
  ] = await Promise.allSettled([
    selectedFacility
      ? supabase
          .from("schedule_groups")
          .select(
            "id, name, sport_category, status, starts_on, ends_on, updated_at, published_at, department_id, departments ( name )"
          )
          .eq("org_id", orgId)
          .eq("facility_id", selectedFacility.id)
          .order("display_order", { ascending: true })
      : Promise.resolve({ data: null, error: null }),
    recentFacilitiesPromise,
    recentScheduleGroupsPromise,
    activityLogPromise,
    conflictsPromise,
  ]);

  type ScheduleGroupRow = {
    id: string;
    name: string;
    sport_category: string;
    status: "draft" | "published";
    starts_on: string | null;
    ends_on: string | null;
    updated_at: string;
    published_at: string | null;
    department_id: string | null;
    departments: { name: string } | null;
  };

  const scheduleGroupRows: ScheduleGroupRow[] =
    scheduleGroupsRes.status === "fulfilled"
      ? ((scheduleGroupsRes.value.data as unknown as ScheduleGroupRow[] | null) ?? [])
      : [];

  // Narrow to the sidebar's department/schedule filters, same params
  // commandCentreHref uses — the facility filter above already scoped the
  // query itself.
  const departmentFiltered = departmentParam
    ? scheduleGroupRows.filter((g) =>
        departmentParam === NO_DEPARTMENT
          ? !g.department_id
          : g.department_id === departmentParam
      )
    : scheduleGroupRows;
  const visibleScheduleGroupRows = scheduleParam
    ? departmentFiltered.filter((g) => g.id === scheduleParam)
    : departmentFiltered;

  const scheduleIds = visibleScheduleGroupRows.map((g) => g.id);
  const departmentRowId =
    departmentParam && departmentParam !== NO_DEPARTMENT ? departmentParam : null;

  const [{ data: sessionRows }, { data: spaceRows }, { data: templateRows }, analyticsSummary] =
    await Promise.all([
      scheduleIds.length > 0
        ? supabase
            .from("sessions")
            .select("id, schedule_group_id")
            .eq("org_id", orgId)
            .eq("is_active", true)
            .in("schedule_group_id", scheduleIds)
        : Promise.resolve({ data: [] as { id: string; schedule_group_id: string }[] }),
      // Spaces don't belong to a single schedule — only facility/department
      // narrow them, same as the sidebar filter itself does.
      selectedFacility
        ? supabase
            .from("spaces")
            .select("id, department_id")
            .eq("org_id", orgId)
            .eq("facility_id", selectedFacility.id)
        : Promise.resolve({ data: [] as { id: string; department_id: string | null }[] }),
      // Templates don't belong to a single schedule — only facility/department
      // narrow them, same as spaces just above.
      selectedFacility
        ? supabase
            .from("session_templates")
            .select("id, department_id")
            .eq("org_id", orgId)
            .eq("facility_id", selectedFacility.id)
        : Promise.resolve({ data: [] as { id: string; department_id: string | null }[] }),
      // Org-wide, not scoped to the facility/department/schedule filter above
      // — the ticker is a rotating org-level pulse, same spirit as the old
      // "Widget views" card, and links through to the full breakdown.
      getAnalyticsSummary(supabase, orgId, 30),
    ]);

  const sessionCounts = new Map<string, number>();
  for (const s of sessionRows ?? []) {
    sessionCounts.set(s.schedule_group_id, (sessionCounts.get(s.schedule_group_id) ?? 0) + 1);
  }

  // Id sets the "Activity (30d)" and "Conflicts" cards below match
  // activity_log/findOrgConflicts rows against, so both follow the exact
  // same facility/department/schedule scope as the rest of the page.
  const visibleScheduleIdSet = new Set(scheduleIds);
  const visibleSessionIdSet = new Set((sessionRows ?? []).map((s) => s.id));
  const visibleSpaceIdSet = new Set(
    (spaceRows ?? [])
      .filter((s) =>
        !departmentParam
          ? true
          : departmentParam === NO_DEPARTMENT
            ? !s.department_id
            : s.department_id === departmentParam
      )
      .map((s) => s.id)
  );
  const visibleTemplateIdSet = new Set(
    (templateRows ?? [])
      .filter((t) =>
        !departmentParam
          ? true
          : departmentParam === NO_DEPARTMENT
            ? !t.department_id
            : t.department_id === departmentParam
      )
      .map((t) => t.id)
  );

  function matchesCurrentScope(row: { table_name: string; row_id: string }): boolean {
    switch (row.table_name) {
      case "facilities":
        return !departmentParam && !scheduleParam && row.row_id === selectedFacility?.id;
      case "departments":
        return !scheduleParam && departmentRowId !== null && row.row_id === departmentRowId;
      case "schedule_groups":
        return visibleScheduleIdSet.has(row.row_id);
      case "sessions":
        return visibleSessionIdSet.has(row.row_id);
      case "spaces":
        return !scheduleParam && visibleSpaceIdSet.has(row.row_id);
      case "session_templates":
        return visibleTemplateIdSet.has(row.row_id);
      default:
        return false;
    }
  }

  const publishedCount = visibleScheduleGroupRows.filter((g) => g.status === "published").length;
  const totalScheduleCount = visibleScheduleGroupRows.length;
  const tickerStats: TickerStat[] = [
    { label: "Widget views (30d)", value: String(analyticsSummary.views) },
    { label: "Clicks (30d)", value: String(analyticsSummary.clicks) },
    {
      label: "Avg. time on schedule",
      value: analyticsSummary.avgDurationMs !== null ? formatDurationShort(analyticsSummary.avgDurationMs) : "—",
    },
  ];
  const activityCount =
    activityLogRes.status === "fulfilled"
      ? (activityLogRes.value.data ?? []).filter(matchesCurrentScope).length
      : 0;
  const conflictCount =
    conflictsRes.status === "fulfilled"
      ? conflictsRes.value.filter(
          (c) =>
            !c.dismissed &&
            (visibleScheduleIdSet.has(c.sessionA.scheduleGroupId) ||
              visibleScheduleIdSet.has(c.sessionB.scheduleGroupId))
        ).length
      : 0;

  const today = localDateString();
  const scheduleListRows: ScheduleListRow[] = selectedFacility
    ? visibleScheduleGroupRows.map((g) => {
        const sport = getSportCategory(g.sport_category);
        return {
          id: g.id,
          name: g.name,
          typeLabel: sport?.label ?? g.sport_category,
          typeIcon: sport?.icon ?? "🎯",
          departmentName: g.departments?.name ?? null,
          startsOn: g.starts_on,
          endsOn: g.ends_on,
          sessionsCount: sessionCounts.get(g.id) ?? 0,
          scheduleStatus: deriveScheduleStatus(
            {
              status: g.status,
              startsOn: g.starts_on,
              endsOn: g.ends_on,
              updatedAt: g.updated_at,
              publishedAt: g.published_at,
            },
            today
          ),
          editHref: scheduleGroupHref({
            facility_id: selectedFacility.id,
            department_id: g.department_id,
            id: g.id,
          }),
          previewHref: `/facility/${selectedFacility.slug}`,
        };
      })
    : [];

  const recentFacilities: RecentFacility[] =
    recentFacilitiesRes.status === "fulfilled" && recentFacilitiesRes.value.data
      ? recentFacilitiesRes.value.data.map((f) => ({
          id: f.id,
          name: f.name,
          is_published: f.is_published,
          updated_at: f.updated_at,
          kind: "facility" as const,
        }))
      : [];
  const recentScheduleGroups: RecentScheduleGroup[] =
    recentScheduleGroupsRes.status === "fulfilled" && recentScheduleGroupsRes.value.data
      ? recentScheduleGroupsRes.value.data.map((sg) => ({
          id: sg.id,
          name: sg.name,
          is_published: sg.status === "published",
          updated_at: sg.updated_at,
          facility_id: sg.facility_id,
          department_id: sg.department_id,
          kind: "schedule_group" as const,
        }))
      : [];

  const recentActivity: RecentItem[] = [...recentFacilities, ...recentScheduleGroups]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  function itemHref(item: RecentItem) {
    return item.kind === "facility" ? commandCentreHref({ facilityId: item.id }) : scheduleGroupHref(item);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {isNew ? `Welcome back` : selectedFacility ? selectedFacility.name : orgContext.org.name}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isNew
            ? "Get started by adding your first facility."
            : selectedFacility
              ? "Every schedule at this building, current and stored."
              : "Here's what's happening across your organization."}
        </p>
      </div>

      {/* Stat row — all four are real, and scoped to the current
          facility/department/schedule filter, same as the list below. */}
      {!isNew && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={CheckCircle2}
            label="Published"
            value={`${publishedCount}/${totalScheduleCount}`}
          />
          <AnalyticsTicker stats={tickerStats} />
          <Link href="/dashboard/conflicts" className="block rounded-xl transition-opacity hover:opacity-80">
            <StatCard icon={AlertTriangle} label="Conflicts" value={String(conflictCount)} />
          </Link>
          <Link href="/dashboard/activity" className="block rounded-xl transition-opacity hover:opacity-80">
            <StatCard icon={ClipboardList} label="Activity (30d)" value={String(activityCount)} />
          </Link>
        </div>
      )}

      {/* Quick actions for new orgs */}
      {isNew && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-4">Get started in 3 steps</h2>
          <div className="space-y-3">
            {[
              { step: 1, label: "Add a facility", desc: "Add your rec centre, pool, or arena", href: "/dashboard/facilities/new" },
              { step: 2, label: "Create a schedule", desc: "Add Lap Swim, Drop-in Hockey, or any activity", href: "/dashboard/facilities" },
              { step: 3, label: "Build your schedule", desc: "Set recurring session times for each schedule", href: "/dashboard/schedule" },
            ].map((item) => (
              <Link
                key={item.step}
                href={item.href}
                className="flex items-center gap-4 p-3 bg-card rounded-lg border border-blue-100 hover:border-blue-300 transition-colors group"
              >
                <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                  {item.step}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-blue-500 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* The schedule list — the primary reason to be on this page day to day */}
      {!isNew && selectedFacility && (
        <ScheduleListSection
          orgId={orgId}
          facilityName={selectedFacility.name}
          rows={scheduleListRows}
          newScheduleHref={`/dashboard/facilities/${selectedFacility.id}/schedule-groups/new`}
          emptyMessage={
            departmentParam || scheduleParam
              ? "Nothing matches the selected filters."
              : undefined
          }
        />
      )}

      {/* Recent activity — a compact secondary panel. Facility-level changes
          (e.g. a new building added) show up here even though the schedule
          list above only ever covers one building at a time. */}
      {!isNew && recentActivity.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Recent activity</h2>
          <Card className="divide-y divide-border py-0">
            {recentActivity.map((item) => {
              const Icon = item.kind === "facility" ? Building2 : Calendar;
              return (
                <Link
                  key={`${item.kind}_${item.id}`}
                  href={itemHref(item)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted transition-colors"
                >
                  <Icon className="w-4 h-4 text-muted-foreground/70 shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                  <Badge variant={item.is_published ? "default" : "secondary"} className="shrink-0">
                    {item.is_published ? "Published" : "Draft"}
                  </Badge>
                  <span className="text-xs text-muted-foreground/70 shrink-0 hidden sm:inline">
                    {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/70 ml-auto shrink-0" />
                </Link>
              );
            })}
          </Card>
        </div>
      )}

      {!isNew && !selectedFacility && (
        <div className="text-center py-16 bg-card rounded-xl border border-dashed border-border">
          <Building2 className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
          <h3 className="font-medium text-foreground mb-1">No buildings yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Add a facility to start building its schedule.</p>
          <Link
            href="/dashboard/facilities/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a facility
          </Link>
        </div>
      )}
    </div>
  );
}
