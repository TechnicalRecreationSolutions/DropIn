/**
 * Everything the Overview's "Needs you" list is built from, in one place, so
 * the Overview page and the sidebar's inbox count (GET /api/overview/needs)
 * can never disagree about what is waiting on someone.
 *
 * Ordered most urgent first: staff reports (063), conflicts by name (039),
 * this week's and next week's unapproved weeks per department (037), drafts
 * about to start, schedules running out with nothing behind them.
 */
import type { createClient } from "@/lib/supabase/server";
import { can, canWriteNotice, isReadOnly, isScoped } from "@/lib/auth/roles";
import { NO_DEPARTMENT, commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { findOrgConflicts, type OrgConflict } from "@/lib/sessions/conflicts";
import { SEVERITY_RANK } from "@/lib/status/notices";
import { localDateString } from "@/lib/utils/dates";
import type { NoticeSeverity, OrgContext } from "@/types/app.types";
import type { NeedsYouItem } from "@/components/dashboard/overview/NeedsYou";
import {
  buildWeekReadiness,
  findRunouts,
  inDays,
  shortDay,
  upcomingWeekStarts,
  type DepartmentKey,
  type OverviewReview,
  type OverviewScheduleGroup,
  type RunoutWarning,
  type WeekReadiness,
} from "./overview";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** How far ahead a draft or a running-out schedule counts as "needs you". */
export const SOON_DAYS = 21;
/** How far ahead a running-out schedule is worth a line under Coming up. */
export const RUNOUT_HORIZON_DAYS = 84;
/** More conflicts than this collapse into one "and N more" row. */
const MAX_CONFLICT_ROWS = 4;

export interface NeedsYouResult {
  items: NeedsYouItem[];
  /** Total things waiting, counting every conflict (not just the rows shown). */
  count: number;
  urgent: number;
  weeks: WeekReadiness[];
  runouts: (RunoutWarning & { departmentName: string | null })[];
  allGroups: OverviewScheduleGroup[];
  departmentNames: Map<string, string>;
  reviewHref: (departmentId: string | null, weekStart: string) => string;
  newScheduleHref: string | null;
}

export async function loadNeedsYou(
  supabase: Supabase,
  orgContext: OrgContext,
  opts: { facilityId: string | null; departmentParam?: string; scheduleParam?: string; now?: Date }
): Promise<NeedsYouResult> {
  const orgId = orgContext.org.id;
  const { facilityId, departmentParam, scheduleParam } = opts;
  const now = opts.now ?? new Date();
  const today = localDateString(now);
  const permissions = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const unscoped = !isScoped(orgContext.membership.role);
  const canWriteSessions = !isReadOnly(orgContext.membership.role);
  const noticeRule = { auxCanPostNotices: orgContext.org.aux_can_post_notices };

  const [groupsRes, departmentsRes, conflictsRes, reportsRes] = await Promise.allSettled([
    facilityId
      ? supabase
          .from("schedule_groups")
          .select("id, name, status, starts_on, ends_on, department_id")
          .eq("org_id", orgId)
          .eq("facility_id", facilityId)
          .order("display_order", { ascending: true })
      : Promise.resolve({ data: [] }),
    facilityId
      ? supabase.from("departments").select("id, name").eq("org_id", orgId).eq("facility_id", facilityId)
      : Promise.resolve({ data: [] }),
    findOrgConflicts(supabase, orgId),
    // Org-wide on purpose: a contamination at the other building is still the
    // most urgent thing this person can act on.
    supabase
      .from("facility_notices")
      .select("id, facility_id, headline, severity, created_at, facilities(name), spaces(name)")
      .eq("org_id", orgId)
      .eq("needs_review", true)
      .is("ends_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const allGroups =
    groupsRes.status === "fulfilled" ? ((groupsRes.value.data ?? []) as OverviewScheduleGroup[]) : [];
  const departmentNames = new Map(
    (departmentsRes.status === "fulfilled"
      ? ((departmentsRes.value.data ?? []) as { id: string; name: string }[])
      : []
    ).map((d) => [d.id, d.name])
  );

  // A coordinator sees their departments; everyone sees the sidebar's narrowing.
  const inScope = (dept: DepartmentKey) => {
    if (!unscoped && (!dept || !orgContext.scopes.departmentIds.includes(dept))) return false;
    if (departmentParam) return departmentParam === NO_DEPARTMENT ? dept === null : dept === departmentParam;
    return true;
  };
  const groups = allGroups.filter((g) => inScope(g.department_id) && (!scheduleParam || g.id === scheduleParam));
  const groupIds = new Set(groups.map((g) => g.id));

  const weekStarts = upcomingWeekStarts(now, 4);
  const reviewsRes =
    groups.length > 0
      ? await supabase
          .from("schedule_week_reviews")
          .select("schedule_group_id, week_start, status")
          .in("schedule_group_id", [...groupIds])
          .gte("week_start", weekStarts[0])
          .lte("week_start", weekStarts[weekStarts.length - 1])
      : { data: [] as OverviewReview[] };

  const conflicts: OrgConflict[] =
    conflictsRes.status === "fulfilled"
      ? conflictsRes.value
          .filter(
            (c) =>
              !c.dismissed &&
              (groupIds.has(c.sessionA.scheduleGroupId) || groupIds.has(c.sessionB.scheduleGroupId))
          )
          .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))
      : [];

  const weeks = buildWeekReadiness({
    weekStarts,
    firstWeekIndex: 0,
    groups,
    reviews: (reviewsRes.data ?? []) as OverviewReview[],
    conflicts: conflicts.map((c) => ({
      occurrenceDate: c.occurrenceDate,
      departmentIds: [c.sessionA.departmentId, c.sessionB.departmentId],
    })),
    departmentNames,
  });

  const runouts = findRunouts(groups, now, RUNOUT_HORIZON_DAYS).map((r) => ({
    ...r,
    departmentName: r.departmentId ? (departmentNames.get(r.departmentId) ?? null) : null,
  }));

  const reviewHref = (dept: string | null, weekStart: string) => {
    const base = commandCentreHref({
      facilityId,
      departmentId: dept ?? (departmentNames.size > 0 ? NO_DEPARTMENT : null),
    });
    return `${base}${base.includes("?") ? "&" : "?"}week=${weekStart}`;
  };
  const newScheduleHref = facilityId ? `/dashboard/facilities/${facilityId}/schedule-groups/new` : null;

  const items: NeedsYouItem[] = [];

  type ReportRow = {
    id: string;
    facility_id: string;
    headline: string;
    severity: NoticeSeverity;
    created_at: string;
    facilities: { name: string } | null;
    spaces: { name: string } | null;
  };
  const reports = (reportsRes.status === "fulfilled" ? ((reportsRes.value.data ?? []) as unknown as ReportRow[]) : [])
    // Only reports this person could publish: no row they'd open and find no button on.
    .filter((r) => canWriteNotice(permissions, noticeRule, r.facility_id))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  for (const r of reports) {
    items.push({
      id: `report:${r.id}`,
      tone: r.severity === "closure" ? "urgent" : "warning",
      icon: "report",
      title: r.spaces?.name ? `${r.headline} · ${r.spaces.name}` : r.headline,
      meta: ["Staff report", r.facility_id !== facilityId ? r.facilities?.name : null, "patrons have not been told"]
        .filter(Boolean)
        .join(" · "),
      metaTime: r.created_at,
      primary: { kind: "publish-report", label: "Publish notice", facilityId: r.facility_id, noticeId: r.id },
      secondary: { kind: "dismiss-report", label: "Dismiss", facilityId: r.facility_id, noticeId: r.id },
    });
  }

  for (const c of conflicts.slice(0, MAX_CONFLICT_ROWS)) {
    const when = c.occurrenceDate >= today ? shortDay(c.occurrenceDate) : `Since ${shortDay(c.occurrenceDate)}`;
    items.push({
      id: `conflict:${c.key}`,
      tone: "warning",
      icon: "conflict",
      title: `${c.spaceNames[0] ?? "Same space"}: ${c.sessionA.scheduleGroupName} × ${c.sessionB.scheduleGroupName}`,
      meta: `${when} · ${c.occurrenceTime} · both booked at once`,
      primary: { kind: "link", label: "Fix", href: "/dashboard/conflicts" },
      secondary: canWriteSessions
        ? { kind: "allow-conflict", label: "Allow", sessionAId: c.sessionA.sessionId, sessionBId: c.sessionB.sessionId }
        : undefined,
    });
  }
  if (conflicts.length > MAX_CONFLICT_ROWS) {
    const more = conflicts.length - MAX_CONFLICT_ROWS;
    items.push({
      id: "conflict:more",
      tone: "warning",
      icon: "conflict",
      title: `${more} more ${more === 1 ? "conflict" : "conflicts"}`,
      meta: "Two sessions booked into the same space at the same time",
      primary: { kind: "link", label: "See all", href: "/dashboard/conflicts" },
    });
  }

  for (const w of weeks.slice(0, 2)) {
    for (const d of w.departments) {
      if (d.status === "approved") continue;
      if (!can(permissions, "week-review:write", d.departmentId)) continue;
      items.push({
        id: `week:${w.weekStart}:${d.departmentId ?? "none"}`,
        tone: w.relative === "This week" ? "warning" : "info",
        icon: "week",
        title: `${d.departmentName}, ${w.relative.toLowerCase()} (${w.label}), ${
          d.status === "needs_changes" ? "needs changes" : "isn't approved"
        }`,
        meta: `Patrons can't see ${d.scheduleCount === 1 ? "its schedule" : `its ${d.scheduleCount} schedules`} that week until it is`,
        primary: { kind: "link", label: "Review week", href: reviewHref(d.departmentId, w.weekStart) },
      });
    }
  }

  for (const g of groups) {
    if (g.status !== "draft" || !g.starts_on) continue;
    const startsIn = Math.round((Date.parse(g.starts_on) - Date.parse(today)) / 86_400_000);
    if (startsIn > SOON_DAYS) continue;
    items.push({
      id: `draft:${g.id}`,
      tone: startsIn <= 0 ? "warning" : "info",
      icon: "week",
      title: `${g.name} is still a draft`,
      meta: `${startsIn <= 0 ? "Started" : "Starts"} ${shortDay(g.starts_on)} · patrons can't see it until it's published`,
      primary: {
        kind: "link",
        label: "Open",
        href: commandCentreHref({ facilityId, departmentId: g.department_id, scheduleGroupId: g.id }),
      },
    });
  }

  for (const r of runouts.filter((r) => r.daysLeft <= SOON_DAYS)) {
    items.push({
      id: `runout:${r.scheduleGroupId}`,
      tone: "warning",
      icon: "week",
      title: `${r.name} ends ${shortDay(r.endsOn)}`,
      meta: `Nothing is set up after it, so the widget goes empty ${inDays(r.daysLeft + 1)}`,
      primary: newScheduleHref
        ? { kind: "link", label: "Set up the next one", href: newScheduleHref }
        : { kind: "link", label: "Open", href: commandCentreHref({ facilityId, scheduleGroupId: r.scheduleGroupId }) },
    });
  }

  const conflictRows = Math.min(conflicts.length, MAX_CONFLICT_ROWS) + (conflicts.length > MAX_CONFLICT_ROWS ? 1 : 0);
  return {
    items,
    count: items.length - conflictRows + conflicts.length,
    urgent: items.filter((i) => i.tone === "urgent").length,
    weeks,
    runouts,
    allGroups,
    departmentNames,
    reviewHref,
    newScheduleHref,
  };
}
