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
  MonitorSmartphone,
  AlertTriangle,
  ClipboardList,
  PieChart,
  Users,
  Building,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardPageSkeleton as DashboardOverviewSkeleton } from "@/components/layout/DashboardChromeSkeletons";
import { commandCentreHref, scheduleGroupScope } from "@/lib/schedule/commandCentreHref";
import { deriveScheduleStatus } from "@/lib/schedule/scheduleStatus";
import { localDateString, daysAgoIso } from "@/lib/utils/dates";
import { getSportCategory } from "@/lib/utils/sport-categories";
import ScheduleListSection, {
  type ScheduleListRow,
} from "@/components/schedule-list/ScheduleListSection";
import { StatCard } from "@/components/dashboard/StatCard";
import { VizPlaceholder } from "@/components/dashboard/VizPlaceholder";
import { findOrgConflicts } from "@/lib/sessions/conflicts";

/**
 * Validated for instant client-side navigation: Next.js checks at build time
 * that this route still produces a static shell from every entry point, so a
 * future change that reintroduces blocking data access fails the build rather
 * than quietly making navigation feel slow again.
 *
 * Nearly everything on the overview is org-specific — even the heading greets
 * the org by name — so the whole body streams behind one boundary rather than
 * being split further. The boundary has to live inside this page: see the note
 * in dashboard/facilities/page.tsx.
 */
export const unstable_instant = { prefetch: "static" };

interface DashboardPageProps {
  searchParams: Promise<{ facility?: string }>;
}

export default function DashboardPage({ searchParams }: DashboardPageProps) {
  return (
    <Suspense fallback={<DashboardOverviewSkeleton />}>
      <DashboardOverview searchParams={searchParams} />
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
  const { facility: facilityParam } = await searchParams;

  // Ordered by name to match the sidebar tree — "the first facility" means
  // the same building in both places.
  const { data: facilityRows } = await supabase
    .from("facilities")
    .select("id, name, slug, is_published, updated_at")
    .eq("org_id", orgId)
    .order("name");

  const facilities = facilityRows ?? [];
  const isNew = facilities.length === 0;
  const selectedFacility =
    facilities.find((f) => f.id === facilityParam) ?? facilities[0] ?? null;

  const thirtyDaysAgo = daysAgoIso(30);

  const [
    scheduleGroupsRes,
    recentFacilitiesRes,
    recentScheduleGroupsRes,
    allScheduleGroupsRes,
    widgetViewsRes,
    activityCountRes,
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
    supabase
      .from("facilities")
      .select("id, name, is_published, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase
      .from("schedule_groups")
      .select("id, name, status, updated_at, facility_id, department_id")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(6),
    // Org-wide published/total counts for the "Published" stat card — a
    // separate lightweight query from the facility-scoped list above.
    supabase.from("schedule_groups").select("status").eq("org_id", orgId),
    // Widget-view count for the "Widget views" stat card. analytics_events
    // is written by the embed on every load but nothing has read it until now.
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("event_type", "widget_view")
      .gte("occurred_at", thirtyDaysAgo),
    // Activity log count for the "Activity log" stat card (038_activity_log.sql).
    supabase
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("created_at", thirtyDaysAgo),
    // Conflicts stat card (039_session_conflict_dismissals.sql) — computed
    // on demand, not from a persisted count; see findOrgConflicts().
    findOrgConflicts(supabase, orgId),
  ]);

  const allStatuses =
    allScheduleGroupsRes.status === "fulfilled"
      ? ((allScheduleGroupsRes.value.data as { status: "draft" | "published" }[] | null) ?? [])
      : [];
  const publishedCount = allStatuses.filter((s) => s.status === "published").length;
  const totalScheduleCount = allStatuses.length;

  const widgetViews =
    widgetViewsRes.status === "fulfilled" ? (widgetViewsRes.value.count ?? 0) : 0;
  const activityCount =
    activityCountRes.status === "fulfilled" ? (activityCountRes.value.count ?? 0) : 0;
  const conflictCount =
    conflictsRes.status === "fulfilled" ? conflictsRes.value.filter((c) => !c.dismissed).length : 0;

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

  const scheduleIds = scheduleGroupRows.map((g) => g.id);
  const { data: sessionRows } =
    scheduleIds.length > 0
      ? await supabase
          .from("sessions")
          .select("schedule_group_id")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .in("schedule_group_id", scheduleIds)
      : { data: [] as { schedule_group_id: string }[] };

  const sessionCounts = new Map<string, number>();
  for (const s of sessionRows ?? []) {
    sessionCounts.set(s.schedule_group_id, (sessionCounts.get(s.schedule_group_id) ?? 0) + 1);
  }

  const today = localDateString();
  const scheduleListRows: ScheduleListRow[] = selectedFacility
    ? scheduleGroupRows.map((g) => {
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
        <h1 className="text-2xl font-bold text-gray-900">
          {isNew ? `Welcome back` : selectedFacility ? selectedFacility.name : orgContext.org.name}
        </h1>
        <p className="text-gray-500 mt-1">
          {isNew
            ? "Get started by adding your first facility."
            : selectedFacility
              ? "Every schedule at this building, current and stored."
              : "Here's what's happening across your organization."}
        </p>
      </div>

      {/* Org-wide stat row — all four are real. */}
      {!isNew && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={CheckCircle2}
            label="Published"
            value={`${publishedCount}/${totalScheduleCount}`}
          />
          <StatCard icon={MonitorSmartphone} label="Widget views (30d)" value={String(widgetViews)} />
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
          <h2 className="font-semibold text-gray-900 mb-4">Get started in 3 steps</h2>
          <div className="space-y-3">
            {[
              { step: 1, label: "Add a facility", desc: "Add your rec centre, pool, or arena", href: "/dashboard/facilities/new" },
              { step: 2, label: "Create a schedule", desc: "Add Lap Swim, Drop-in Hockey, or any activity", href: "/dashboard/facilities" },
              { step: 3, label: "Build your schedule", desc: "Set recurring session times for each schedule", href: "/dashboard/schedule" },
            ].map((item) => (
              <Link
                key={item.step}
                href={item.href}
                className="flex items-center gap-4 p-3 bg-white rounded-lg border border-blue-100 hover:border-blue-300 transition-colors group"
              >
                <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                  {item.step}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
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
        />
      )}

      {/* Recent activity — a compact secondary panel. Facility-level changes
          (e.g. a new building added) show up here even though the schedule
          list above only ever covers one building at a time. */}
      {!isNew && recentActivity.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent activity</h2>
          <Card className="divide-y divide-gray-100 py-0">
            {recentActivity.map((item) => {
              const Icon = item.kind === "facility" ? Building2 : Calendar;
              return (
                <Link
                  key={`${item.kind}_${item.id}`}
                  href={itemHref(item)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
                  <Badge variant={item.is_published ? "default" : "secondary"} className="shrink-0">
                    {item.is_published ? "Published" : "Draft"}
                  </Badge>
                  <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
                    {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                  </span>
                  <ArrowRight className="w-4 h-4 text-gray-300 ml-auto shrink-0" />
                </Link>
              );
            })}
          </Card>
        </div>
      )}

      {!isNew && !selectedFacility && (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No buildings yet</h3>
          <p className="text-sm text-gray-500 mb-4">Add a facility to start building its schedule.</p>
          <Link
            href="/dashboard/facilities/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a facility
          </Link>
        </div>
      )}

      {/* Chart grid — every slot here is a placeholder. No charting library
          is installed and none of these have an aggregation query behind
          them yet; see docs/RESUME-layout-rework.md for what each needs. */}
      {!isNew && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Reporting</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <VizPlaceholder
              icon={PieChart}
              title="Schedule Completion Rate"
              description="Needs a charting library + a published-vs-draft-over-time query"
            />
            <VizPlaceholder
              icon={Users}
              title="Department Performance"
              description="Needs a charting library + a definition of “performance” for this domain"
            />
            <VizPlaceholder
              icon={Building}
              title="Facility Usage"
              description="Needs a charting library + a per-facility analytics_events breakdown"
            />
            <VizPlaceholder
              icon={TrendingUp}
              title="Widget Traffic Trends"
              description="Needs a charting library + a time-bucketed analytics_events query"
            />
          </div>
        </div>
      )}
    </div>
  );
}
