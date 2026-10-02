import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { pickFacility } from "@/lib/dashboard/scope";
import { rememberedFacilityId } from "@/lib/dashboard/scope.server";
import { can, canWriteNotice, isReadOnly, isScoped, canReadFacility } from "@/lib/auth/roles";
import { loadNeedsYou, SOON_DAYS } from "@/lib/dashboard/needsYou";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Building2, ArrowRight, Plus, CalendarPlus, Megaphone } from "lucide-react";
import { DashboardPageSkeleton as DashboardOverviewSkeleton } from "@/components/layout/DashboardChromeSkeletons";
import { NO_DEPARTMENT, commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { localDateString, formatDayFull, daysAgoIso } from "@/lib/utils/dates";
import { SEVERITY_RANK } from "@/lib/status/notices";
import type { NoticeSeverity } from "@/types/app.types";
import TodayStrip from "@/components/dashboard/today/TodayStrip";
import { getAnalyticsSummary } from "@/lib/analytics/queries";
import { rangeFromPreset } from "@/lib/analytics/range";
import NeedsYou from "@/components/dashboard/overview/NeedsYou";
import ComingUp from "@/components/dashboard/overview/ComingUp";
import RightNow, { type RightNowNotice, type RightNowReading } from "@/components/dashboard/overview/RightNow";
import QuickActions, { type QuickAction } from "@/components/dashboard/overview/QuickActions";
import WorthALook, { type HealthItem } from "@/components/dashboard/overview/WorthALook";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";

/**
 * The Overview: an inbox, not a mirror.
 *
 * An admin already knows what is on in their own building. They open Dropin
 * to find out what needs them and to get one thing done — usually on a phone,
 * usually for under a minute (docs/prompts/overview-ux.md). The page used to
 * be built around "what is running today": a ribbon, the schedule list, stat
 * tiles and an activity feed. That was a copy of the Schedule page. It is now:
 *
 *   1. Needs you — named items with one action each: staff reports to publish
 *      (063), conflicts by name (039), weeks patrons can't see yet because no
 *      one approved them (037), drafts about to start, schedules running out.
 *      Empty says "All clear".
 *   2. Today — the strip, kept small, with its now-line.
 *   3. Coming up — the next three weeks, one chip per department, because each
 *      coordinator approves their own slice; and any schedule that ends with
 *      nothing behind it.
 *   4. Right now / Quick actions / Worth a look — the rail. Health shows only
 *      when something is off, and only to owners and managers.
 *
 * On a phone the order is Needs you, the four quick-action tiles, Today, Right
 * now, Coming up. Activity has its own page; analytics have theirs.
 *
 * Opted in to instant-navigation validation; the whole body streams behind one
 * boundary because nearly everything on it is org-specific.
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

async function DashboardOverview({ searchParams }: DashboardPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  // Aux staff land on the schedule, not here: nothing on this page is theirs
  // to act on, and a lifeguard checking tomorrow's lanes shouldn't wade past it.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam, department: departmentParam, schedule: scheduleParam } = await searchParams;

  const permissions = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const unscoped = !isScoped(orgContext.membership.role);
  const canViewAnalytics = can(permissions, "analytics:view");
  const canViewActivity = can(permissions, "activity:view");
  const canManageStaff = can(permissions, "staff:manage");
  // Asked as "is this role read-only" rather than can(…, "session:write"):
  // that permission is department-scoped and answers false for a coordinator
  // without a department, which would hide creates from the role that fills
  // schedules in. The routes enforce the per-schedule answer.
  const canWriteSessions = !isReadOnly(orgContext.membership.role);

  const now = new Date();
  const nowIso = now.toISOString();
  const today = localDateString(now);

  // `start()` because a PostgREST builder is lazy: it only issues the request
  // when something awaits it. Everything scoped by org alone starts in the
  // same wave as the facility list (hosted Supabase costs ~80ms a hop).
  const start = <T,>(builder: PromiseLike<T>): Promise<T> => Promise.resolve(builder);

  const facilityListPromise = start(
    supabase.from("facilities").select("id, name, slug").eq("org_id", orgId).order("name")
  );
  const invitesPromise = canManageStaff
    ? start(
        supabase
          .from("staff_invitations")
          .select("id, created_at")
          .eq("org_id", orgId)
          .is("accepted_at", null)
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: true })
      )
    : Promise.resolve({ data: [] as { id: string; created_at: string }[] });
  // Last 7 days against the 7 before, org-wide. Only a drop is shown.
  const viewsPromise = canViewAnalytics
    ? getAnalyticsSummary(supabase, { orgId, range: rangeFromPreset("7d"), compare: true }).catch(() => null)
    : Promise.resolve(null);

  const { data: facilityRows } = await facilityListPromise;
  // A coordinator is offered only the buildings they hold — before the
  // default is picked, or they land in one they cannot read.
  const facilities = (facilityRows ?? []).filter((f) => canReadFacility(permissions, f.id));
  const isNew = facilities.length === 0;
  // The URL's building, else the one the sidebar's switcher remembers, else
  // the first — the same order as the switcher and the inbox count.
  const selectedFacility = pickFacility(facilities, facilityParam, await rememberedFacilityId());

  const facilityId = selectedFacility?.id ?? null;
  const empty = Promise.resolve({ data: [] as never[] });

  const needsPromise = loadNeedsYou(supabase, orgContext, { facilityId, departmentParam, scheduleParam, now });

  const [spacesRes, noticesRes, readingsRes] = await Promise.all([
    facilityId
      ? supabase.from("spaces").select("id, name, department_id").eq("org_id", orgId).eq("facility_id", facilityId)
      : empty,
    // Live notices (060), filtered in SQL with the same predicate 060's public
    // policy applies — see src/lib/status/notices.ts.
    facilityId
      ? supabase
          .from("facility_notices")
          .select("id, headline, severity, spaces(name)")
          .eq("facility_id", facilityId)
          .eq("is_published", true)
          .lte("starts_at", nowIso)
          .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      : empty,
    // Readings (061) from the last six hours: older than that is not "right now".
    facilityId
      ? supabase
          .from("facility_readings")
          .select("metric, value, recorded_at, space_id, spaces(name)")
          .eq("facility_id", facilityId)
          .gte("recorded_at", daysAgoIso(0.25, now))
          .order("recorded_at", { ascending: false })
          .limit(200)
      : empty,
  ]);

  const spaces = (spacesRes.data ?? []) as { id: string; name: string; department_id: string | null }[];

  const [invitesRes, views] = await Promise.allSettled([invitesPromise, viewsPromise]);
  const { items: needs, weeks, runouts, allGroups, departmentNames, reviewHref, newScheduleHref } = await needsPromise;

  const facilityScope = { facilityId };
  const statusHref = facilityId ? `/dashboard/facilities/${facilityId}/status` : "/dashboard/facilities";
  const newSessionHref = "/dashboard/schedule/sessions/new";
  const canPostNotice = facilityId
    ? canWriteNotice(permissions, { auxCanPostNotices: orgContext.org.aux_can_post_notices }, facilityId)
    : false;

  // ── Right now ─────────────────────────────────────────────────────────────
  type NoticeRow = { id: string; headline: string; severity: NoticeSeverity; spaces: { name: string } | null };
  const notices: RightNowNotice[] = ((noticesRes.data ?? []) as unknown as NoticeRow[])
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((n) => ({ id: n.id, severity: n.severity, headline: n.headline, where: n.spaces?.name ?? null }));

  type ReadingRow = {
    metric: "headcount" | "water_temp_c" | "air_temp_c";
    value: number;
    recorded_at: string;
    space_id: string | null;
    spaces: { name: string } | null;
  };
  const readingsBySpace = new Map<string, RightNowReading>();
  // Newest first, so the first value seen per (space, metric) is the current one.
  for (const r of (readingsRes.data ?? []) as unknown as ReadingRow[]) {
    const key = r.space_id ?? "building";
    const row =
      readingsBySpace.get(key) ??
      ({ where: r.spaces?.name ?? null, headcount: null, waterTempC: null, airTempC: null, at: r.recorded_at } as RightNowReading);
    const value = Number(r.value);
    if (r.metric === "headcount" && row.headcount === null) row.headcount = value;
    if (r.metric === "water_temp_c" && row.waterTempC === null) row.waterTempC = value;
    if (r.metric === "air_temp_c" && row.airTempC === null) row.airTempC = value;
    readingsBySpace.set(key, row);
  }
  const readings = [...readingsBySpace.values()];

  // ── Quick actions ─────────────────────────────────────────────────────────
  const deckHref = facilityId ? `/dashboard/schedule/deck?facility=${facilityId}&date=${today}` : null;
  const changeHref = commandCentreHref(facilityScope);
  const tiles = ([
    canPostNotice ? { label: "Post a notice", href: statusHref, icon: "notice" as const } : null,
    canWriteSessions ? { label: "Change or cancel a session", href: changeHref, icon: "change" as const } : null,
    { label: "Log count or temp", href: statusHref, icon: "reading" as const },
    deckHref ? { label: "Today's deck sheet", href: deckHref, icon: "deck" as const } : null,
    canWriteSessions ? { label: "New session", href: newSessionHref, icon: "session" as const } : null,
  ] as (QuickAction | null)[]).filter((a): a is QuickAction => a !== null);
  const railActions = ([
    canWriteSessions ? { label: "Change or cancel a session", href: changeHref, icon: "change" as const } : null,
    deckHref ? { label: "Print today's deck sheet", href: deckHref, icon: "deck" as const } : null,
    canWriteSessions && newScheduleHref ? { label: "New schedule", href: newScheduleHref, icon: "schedule" as const } : null,
  ] as (QuickAction | null)[]).filter((a): a is QuickAction => a !== null);

  // ── Worth a look: owners and managers, and only when something is off ─────
  const health: HealthItem[] = [];
  const v = views.status === "fulfilled" ? views.value : null;
  if (v?.previous && v.previous.views >= 10 && v.views <= v.previous.views * 0.6) {
    const drop = Math.round((1 - v.views / v.previous.views) * 100);
    health.push({
      id: "views",
      icon: "views",
      warn: true,
      title: `Schedule views fell ${drop}% this week`,
      detail: `${v.views} in the last 7 days, down from ${v.previous.views}. If the widget is embedded on your site, check it still loads.`,
      linkLabel: "Open the widget",
      href: "/dashboard/widget",
    });
  }
  const invites = invitesRes.status === "fulfilled" ? ((invitesRes.value.data ?? []) as { id: string; created_at: string }[]) : [];
  if (invites.length > 0) {
    const oldestDays = Math.floor((now.getTime() - Date.parse(invites[0].created_at)) / 86_400_000);
    health.push({
      id: "invites",
      icon: "invites",
      title: `${invites.length} ${invites.length === 1 ? "invite hasn't" : "invites haven't"} been accepted`,
      detail: oldestDays >= 1 ? `The oldest was sent ${oldestDays} ${oldestDays === 1 ? "day" : "days"} ago` : "Sent today",
      linkLabel: "Open staff",
      href: "/dashboard/settings/staff",
    });
  }
  if (unscoped && departmentNames.size > 0) {
    const orphanSpaces = spaces.filter((s) => !s.department_id);
    const orphanGroups = allGroups.filter((g) => !g.department_id);
    const names = [...orphanSpaces.map((s) => s.name), ...orphanGroups.map((g) => g.name)];
    if (names.length > 0) {
      health.push({
        id: "department",
        icon: "department",
        title: names.length === 1 ? `${names[0]} has no department` : `${names.length} spaces or schedules have no department`,
        detail: "Coordinators can't see or edit them",
        linkLabel: "Assign departments",
        href: orphanSpaces.length > 0 ? `/dashboard/spaces?facility=${facilityId}` : `/dashboard/departments?facility=${facilityId}`,
      });
    }
  }

  const comingWeeks = weeks.slice(1);
  const laterRunouts = runouts.filter((r) => r.daysLeft > SOON_DAYS);

  // One ink button per view: posting a notice when this person can, else a session.
  const headerActions = !isNew && (
    <div className="flex items-center gap-2">
      {canWriteSessions && (
        <Button asChild variant={canPostNotice ? "outline" : "default"}>
          <Link href={newSessionHref}>
            <CalendarPlus className="size-4" aria-hidden />
            New session
          </Link>
        </Button>
      )}
      {canPostNotice && (
        <Button asChild>
          <Link href={statusHref}>
            <Megaphone className="size-4" aria-hidden />
            Post a notice
          </Link>
        </Button>
      )}
    </div>
  );

  const activityLink = canViewActivity && (
    <Link href="/dashboard/activity" className="inline-flex items-center gap-1 px-1 text-caption font-medium text-brand hover:underline underline-offset-4">
      All activity <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* The date is not decoration: everything below is relative to today. */}
      <PageHeader
        title={isNew ? "Welcome" : selectedFacility ? selectedFacility.name : orgContext.org.name}
        subtitle={<span className="text-sm">{formatDayFull(now)}</span>}
        actions={headerActions}
      />

      {isNew && (
        <div className="rounded-panel bg-muted p-6">
          <h2 className="text-heading text-foreground mb-4">Get started in 3 steps</h2>
          <div className="space-y-3">
            {[
              { step: 1, label: "Add a facility", desc: "Add your rec centre, pool, or arena", href: "/dashboard/facilities/new" },
              { step: 2, label: "Create a schedule", desc: "Add Lap Swim, Drop-in Hockey, or any activity", href: "/dashboard/facilities" },
              { step: 3, label: "Build your schedule", desc: "Set recurring session times for each schedule", href: "/dashboard/schedule" },
            ].map((item) => (
              <Link
                key={item.step}
                href={item.href}
                className="flex items-center gap-4 p-3 bg-card rounded-card border border-border shadow-card hover:border-input transition-colors group"
              >
                <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-semibold tabular-nums flex items-center justify-center shrink-0">
                  {item.step}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-brand transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isNew && !selectedFacility && (
        <div className="text-center py-16 bg-card rounded-card border border-dashed border-border">
          <Building2 className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
          <h3 className="text-card-title text-foreground mb-1">No buildings yet</h3>
          <p className="text-caption text-muted-foreground mb-4">Add a facility to start building its schedule.</p>
          <Button asChild variant="outline">
            <Link href="/dashboard/facilities/new">
              <Plus className="w-4 h-4" />
              Add a facility
            </Link>
          </Button>
        </div>
      )}

      {!isNew && selectedFacility && (
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-10">
            <NeedsYou items={needs} checkedAt={nowIso} />

            <div className="lg:hidden">
              <QuickActions actions={tiles} layout="tiles" />
            </div>

            <TodayStrip
              orgId={orgId}
              facilityId={selectedFacility.id}
              facilityName={selectedFacility.name}
              departmentId={departmentParam && departmentParam !== NO_DEPARTMENT ? departmentParam : undefined}
              scheduleGroupId={scheduleParam}
              newSessionHref={canWriteSessions ? newSessionHref : undefined}
            />

            <div className="lg:hidden">
              <RightNow now={nowIso} notices={notices} readings={readings} statusHref={statusHref} headingId="right-now-phone" />
            </div>

            <ComingUp
              weeks={comingWeeks}
              runouts={laterRunouts}
              reviewHref={reviewHref}
              newScheduleHref={canWriteSessions ? newScheduleHref : null}
            />

            <div className="flex flex-col gap-6 lg:hidden">
              <WorthALook items={unscoped ? health : []} headingId="worth-a-look-phone" />
              {activityLink}
            </div>
          </div>

          <aside className="hidden flex-col gap-6 lg:flex" aria-label="At a glance">
            <RightNow now={nowIso} notices={notices} readings={readings} statusHref={statusHref} />
            <QuickActions actions={railActions} layout="list" />
            <WorthALook items={unscoped ? health : []} />
            {activityLink}
          </aside>
        </div>
      )}
    </div>
  );
}
