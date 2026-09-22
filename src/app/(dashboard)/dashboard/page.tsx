import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { getClaims } from "@/lib/auth/claims";
import { can, isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  Building2,
  ArrowRight,
  Plus,
  CalendarPlus,
  ClipboardList,
  BarChart3,
} from "lucide-react";
import { DashboardPageSkeleton as DashboardOverviewSkeleton } from "@/components/layout/DashboardChromeSkeletons";
import { NO_DEPARTMENT, commandCentreHref, scheduleGroupScope } from "@/lib/schedule/commandCentreHref";
import { deriveScheduleStatus } from "@/lib/schedule/scheduleStatus";
import { localDateString, daysAgoIso, formatDayFull } from "@/lib/utils/dates";
import { getSportCategory } from "@/lib/utils/sport-categories";
import ScheduleListSection, {
  type ScheduleListRow,
} from "@/components/schedule-list/ScheduleListSection";
import { StatTile } from "@/components/dashboard/StatCard";
import { Sparkline } from "@/components/dashboard/Sparkline";
import OverviewAlerts from "@/components/dashboard/OverviewAlerts";
import RecentActivityPanel, { type RecentActivityEntry } from "@/components/dashboard/RecentActivityPanel";
import TodayStrip from "@/components/dashboard/today/TodayStrip";
import WeekTile from "@/components/dashboard/today/WeekTile";

import { findOrgConflicts } from "@/lib/sessions/conflicts";
import { fetchActivityScopeRows } from "@/lib/activity/queries";
import { getAnalyticsSummary } from "@/lib/analytics/queries";
import { rangeFromPreset } from "@/lib/analytics/range";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";

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
 *
 * What this page is for, and why it is shaped this way, is written down in
 * docs/prompts/overview-ux.md. The short version: a coordinator opens it for
 * under a minute to answer "what is running, is anything broken, let me fix one
 * thing". So the order on screen is today's schedule (a picture), then anything
 * wrong (named, not counted), then the schedules themselves, and only then the
 * numbers. Counts that could not be acted on were removed rather than restyled.
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

function scheduleGroupHref(sg: { facility_id: string; department_id: string | null; id: string }) {
  return commandCentreHref(scheduleGroupScope(sg));
}

async function DashboardOverview({ searchParams }: DashboardPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  // Aux staff land on the schedule, not here.
  //
  // This page is a management overview — conflict counts, analytics, "add a
  // facility", schedules needing review. None of it is actionable for someone
  // who can only read, and a lifeguard opening the app to check tomorrow's
  // lanes should not have to navigate past it. Their scoped facility is picked
  // up by the command centre from the sidebar, which only offers theirs.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

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
  // assigning one to a const starts nothing. Without this, the org-scoped reads
  // below would not begin until the `Promise.allSettled` further down, which is
  // *after* the facility list has been awaited: the code would read as parallel
  // and run as a third sequential wave.
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

  // Two separate activity reads, on purpose.
  //
  // The count is scoped to the current facility/department/schedule filter, and
  // activity_log spans six tables (038_activity_log.sql) with no facility_id
  // column of its own — so every row in the window has to be matched in JS
  // against the id sets the scoped queries below produce. That read is paged
  // (see lib/activity/queries.ts): a bare `.limit()` is silently capped at 1000
  // by PostgREST, which is how the tile used to report a ceiling as a total.
  //
  // The panel, by contrast, needs six whole rows with their labels and actors.
  // Asking the paged read for those columns would mean dragging `before`/`after`
  // JSON across twenty thousand rows to render six lines.
  const activityCountPromise = fetchActivityScopeRows(supabase, { orgId, sinceIso: thirtyDaysAgo });
  const recentActivityPromise = start(
    supabase
      .from("activity_log")
      .select("id, table_name, action, entity_label, actor_email, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(6)
  );

  // Conflicts (039_session_conflict_dismissals.sql) — computed on demand, not
  // from a persisted count; see findOrgConflicts(). Also scoped to the current
  // filter in JS below.
  const conflictsPromise = findOrgConflicts(supabase, orgId);

  const claimsPromise = getClaims();

  const { data: facilityRows } = await facilityListPromise;

  const facilities = facilityRows ?? [];
  const isNew = facilities.length === 0;
  const selectedFacility =
    facilities.find((f) => f.id === facilityParam) ?? facilities[0] ?? null;

  const [scheduleGroupsRes, activityCountRes, recentActivityRes, conflictsRes, claimsRes] =
    await Promise.allSettled([
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
      activityCountPromise,
      recentActivityPromise,
      conflictsPromise,
      claimsPromise,
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
      // — the views tile is an org-level pulse and links through to the full
      // breakdown. `compare: false` skips the previous-period queries; the
      // sparkline is drawn from `byDay`, which this call already computes.
      getAnalyticsSummary(supabase, { orgId, range: rangeFromPreset("30d"), compare: false }),
    ]);

  const sessionCounts = new Map<string, number>();
  for (const s of sessionRows ?? []) {
    sessionCounts.set(s.schedule_group_id, (sessionCounts.get(s.schedule_group_id) ?? 0) + 1);
  }

  // Id sets the "Activity (30d)" tile and the conflict notice match their rows
  // against, so both follow the exact same facility/department/schedule scope
  // as the rest of the page.
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

  const permissions = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const canViewAnalytics = can(permissions, "analytics:view");
  const canViewActivity = can(permissions, "activity:view");
  // Asked as "is this role read-only" rather than can(…, "session:write"),
  // for the same reason the command centre and the bottom nav ask it that way:
  // both write permissions are department-scoped, and `can()` without a
  // department answers **false** for a coordinator — which would hide the
  // create buttons from the one role whose whole job is filling in schedules.
  // The per-schedule answer belongs to the routes, which enforce it.
  const canWriteSessions = !isReadOnly(orgContext.membership.role);
  const canWriteSchedules = canWriteSessions;

  const draftCount = visibleScheduleGroupRows.filter((g) => g.status === "draft").length;

  const activityRows = activityCountRes.status === "fulfilled" ? activityCountRes.value : null;
  const activityCount = activityRows ? activityRows.rows.filter(matchesCurrentScope).length : 0;
  // A truncated read can only undercount, so the number is a floor and says so
  // rather than passing itself off as a total.
  const activityValue = `${activityCount}${activityRows?.truncated ? "+" : ""}`;

  const scopedConflicts =
    conflictsRes.status === "fulfilled"
      ? conflictsRes.value.filter(
          (c) =>
            !c.dismissed &&
            (visibleScheduleIdSet.has(c.sessionA.scheduleGroupId) ||
              visibleScheduleIdSet.has(c.sessionB.scheduleGroupId))
        )
      : [];
  const firstConflict = scopedConflicts[0] ?? null;
  // Named, not counted — see OverviewAlerts. The space is what makes it
  // findable; the two schedule names are what make it recognisable.
  const conflictSummary = firstConflict
    ? `${firstConflict.sessionA.scheduleGroupName} × ${firstConflict.sessionB.scheduleGroupName}` +
      (firstConflict.spaceNames.length > 0 ? ` in ${firstConflict.spaceNames[0]}` : "") +
      ` · ${firstConflict.occurrenceTime}`
    : null;

  const recentActivity: RecentActivityEntry[] =
    recentActivityRes.status === "fulfilled" && recentActivityRes.value.data
      ? (recentActivityRes.value.data as unknown as RecentActivityEntry[])
      : [];
  const viewerEmail =
    claimsRes.status === "fulfilled" ? (claimsRes.value?.email ?? null) : null;

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

  const newScheduleHref = selectedFacility
    ? `/dashboard/facilities/${selectedFacility.id}/schedule-groups/new`
    : "/dashboard/facilities";
  const newSessionHref = "/dashboard/schedule/sessions/new";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* The date is not decoration: everything below it — the ribbon, "on
          now", what counts as a draft — is relative to today, and a page that
          never says which day it means is one left open overnight. */}
      <PageHeader
        title={isNew ? "Welcome" : selectedFacility ? selectedFacility.name : orgContext.org.name}
        subtitle={<span className="text-sm">{formatDayFull(new Date())}</span>}
        actions={
          !isNew && (
            <div className="flex items-center gap-2">
              {canWriteSessions && (
                <Link
                  href={newSessionHref}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <CalendarPlus className="size-4" aria-hidden />
                  New session
                </Link>
              )}
              {/* Hidden on a phone, where the title and one button already fill
                  the row — and not lost there: ScheduleListSection carries its
                  own "+ New schedule" above the table on every viewport. */}
              {canWriteSchedules && selectedFacility && (
                <Link
                  href={newScheduleHref}
                  className="hidden items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:inline-flex"
                >
                  <Plus className="size-4" aria-hidden />
                  New schedule
                </Link>
              )}
            </div>
          )
        }
      />

      {/* Anything wrong, named, before anything else. */}
      {!isNew && selectedFacility && (
        <OverviewAlerts
          conflictCount={scopedConflicts.length}
          conflictSummary={conflictSummary}
          draftCount={draftCount}
        />
      )}

      {/* The picture of today — the one thing on this page that shows the
          product rather than an inventory of it. */}
      {!isNew && selectedFacility && (
        <TodayStrip
          orgId={orgId}
          facilityId={selectedFacility.id}
          facilityName={selectedFacility.name}
          departmentId={departmentRowId ?? undefined}
          scheduleGroupId={scheduleParam}
          newSessionHref={canWriteSessions ? newSessionHref : undefined}
        />
      )}

      {/* Quick actions for new orgs */}
      {isNew && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 dark:bg-blue-500/10 dark:border-blue-500/20">
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
                className="flex items-center gap-4 p-3 bg-card rounded-lg border border-blue-100 hover:border-blue-300 transition-colors group dark:border-blue-500/20"
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

      {/* The schedule list — what to open when today is not the question */}
      {!isNew && selectedFacility && (
        <ScheduleListSection
          orgId={orgId}
          facilityName={selectedFacility.name}
          rows={scheduleListRows}
          newScheduleHref={newScheduleHref}
          emptyMessage={
            departmentParam || scheduleParam
              ? "Nothing matches the selected filters."
              : undefined
          }
        />
      )}

      {/* Numbers last, and only the ones that lead somewhere that can explain
          them. The "Published 4/6" tile that used to sit at the top of the page
          is gone: it restated the Status column below it, and what it was
          really reporting — drafts patrons cannot see — is now a sentence in
          the alert row, where it names the count instead of a ratio. */}
      {/* The columns follow the tiles, not the other way round: the views tile
          is twice the width of the other two because it carries a 30-day
          sparkline, and when a role cannot see it the remaining pair should
          fill the row rather than sit in two thirds of it. */}
      {!isNew && selectedFacility && (
        <div className={`grid grid-cols-2 gap-3 ${canViewAnalytics ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
          {canViewAnalytics && (
            <StatTile
              className="col-span-2"
              icon={BarChart3}
              label="Schedule views (30d)"
              value={String(analyticsSummary.views)}
              hint={`${analyticsSummary.visitors} visitors · ${analyticsSummary.clicks} session clicks`}
              href="/dashboard/analytics"
              visual={
                analyticsSummary.byDay.length >= 2 ? (
                  <Sparkline
                    values={analyticsSummary.byDay.map((d) => d.views)}
                    label="Schedule views"
                    className="h-7 w-full"
                  />
                ) : undefined
              }
            />
          )}
          {/* The one tile that looks forward rather than back, and the only one
              whose link lands on exactly what it describes — the command centre
              opens on this week. Ungated: anyone who can open this page can
              open the schedule. */}
          <WeekTile
            orgId={orgId}
            facilityId={selectedFacility.id}
            departmentId={departmentRowId ?? undefined}
            scheduleGroupId={scheduleParam}
          />
          {canViewActivity && (
            <StatTile
              icon={ClipboardList}
              label="Changes (30d)"
              value={activityValue}
              href="/dashboard/activity"
            />
          )}
        </div>
      )}

      {/* What changed, as changes — not a second copy of the list above. */}
      {!isNew && canViewActivity && (
        <RecentActivityPanel entries={recentActivity} viewerEmail={viewerEmail} />
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
