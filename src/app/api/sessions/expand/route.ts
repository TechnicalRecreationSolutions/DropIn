import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { expandSessions, type SessionWithRelations } from "@/lib/rrule/expand";
import { getWeekStart, getWeekEnd, toSessionTime, sessionWeekStart } from "@/lib/utils/dates";
import type { ExpandedSession } from "@/types/schedule.types";
import type { User } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const QuerySchema = z.object({
  rangeStart: z.string().datetime({ offset: true }).optional(),
  rangeEnd: z.string().datetime({ offset: true }).optional(),
  /** Legacy alias for rangeStart — see the note in the handler. */
  weekStart: z.string().datetime({ offset: true }).optional(),
  orgId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  scheduleGroupId: z.string().uuid().optional(),
});

/**
 * Widest range a single call may expand. A month grid asks for ~6 weeks.
 * Beyond that the cost is unbounded — expansion is O(occurrences), so a year
 * of an org-wide schedule is tens of thousands of objects built and
 * serialized for a view no one can read anyway. Callers that genuinely need
 * more should page by month.
 */
const MAX_RANGE_DAYS = 120;

/**
 * GET /api/sessions/expand
 *
 * Expands recurring sessions into concrete occurrences over a date range.
 * Used by every schedule surface: the weekly grid/list/map, the floorplan,
 * the public widget, and the command centre.
 *
 * Query params:
 *   rangeStart        ISO datetime — start of the range (defaults to the current week's Monday)
 *   rangeEnd          ISO datetime — end of the range (defaults to rangeStart's Sunday)
 *   weekStart         Legacy alias for rangeStart
 *   orgId             Filter to one organization
 *   facilityId        Filter to one facility
 *   departmentId      Filter to one department
 *   scheduleGroupId   Filter to one schedule group
 *
 * At least one of orgId, facilityId, or scheduleGroupId is required to
 * prevent unbounded queries across the entire dataset.
 *
 * RANGE SEMANTICS. This endpoint was once strictly week-shaped, and the old
 * contract was subtly lossy: it snapped whatever you sent to the enclosing
 * Monday–Sunday. Callers now say exactly what they want. `weekStart` alone
 * still behaves precisely as before — it snaps to that week — so nothing that
 * predates the change has to change.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = QuerySchema.safeParse({
    rangeStart: searchParams.get("rangeStart") ?? undefined,
    rangeEnd: searchParams.get("rangeEnd") ?? undefined,
    weekStart: searchParams.get("weekStart") ?? undefined,
    orgId: searchParams.get("orgId") ?? undefined,
    facilityId: searchParams.get("facilityId") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
    scheduleGroupId: searchParams.get("scheduleGroupId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const {
    rangeStart: rangeStartParam,
    rangeEnd: rangeEndParam,
    weekStart: weekStartParam,
    orgId,
    facilityId,
    departmentId,
    scheduleGroupId,
  } = parsed.data;

  if (!orgId && !facilityId && !scheduleGroupId) {
    return NextResponse.json(
      { error: "At least one of orgId, facilityId, or scheduleGroupId is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // No auth requirement on this endpoint at all — unlike every other costly
  // route in the app, so it needs its own rate limit rather than inheriting
  // safety from an auth check. Keyed on user id when signed in (so one
  // abusive account can't throttle everyone behind its office NAT); IP
  // otherwise, which is the only identity a public widget/facility visitor has.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const rateLimitKey = user?.id ?? (await getClientIp());
  if (!(await checkRateLimit("sessionsExpand", rateLimitKey))) {
    return rateLimitResponse("sessionsExpand");
  }

  // An explicit rangeStart is taken literally — both it and weekStart, when
  // supplied, are already in the session-Date convention (see useScheduleRange,
  // the only internal caller). Without either we fall back to the enclosing
  // Monday–Sunday of today, computed via real server-local Date arithmetic and
  // only *then* re-encoded via toSessionTime — getWeekStart/getWeekEnd need a
  // genuine local Date to find the right calendar day in the first place, and
  // this is the one branch with no client-supplied value to already be one.
  const explicitStart = rangeStartParam ? new Date(rangeStartParam) : null;
  const anchorDate = weekStartParam ? new Date(weekStartParam) : null;

  let rangeStart: Date;
  let rangeEnd: Date;

  if (explicitStart) {
    rangeStart = explicitStart;
    rangeEnd = rangeEndParam ? new Date(rangeEndParam) : getWeekEnd(explicitStart);
  } else if (anchorDate) {
    rangeStart = getWeekStart(anchorDate);
    rangeEnd = rangeEndParam ? new Date(rangeEndParam) : getWeekEnd(anchorDate);
  } else {
    const today = new Date();
    rangeStart = toSessionTime(getWeekStart(today));
    rangeEnd = rangeEndParam ? new Date(rangeEndParam) : toSessionTime(getWeekEnd(today));
  }

  if (rangeEnd < rangeStart) {
    return NextResponse.json(
      { error: "rangeEnd must be on or after rangeStart" },
      { status: 400 }
    );
  }

  const rangeDays = (rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000;
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Range too wide — expand at most ${MAX_RANGE_DAYS} days per request` },
      { status: 400 }
    );
  }

  // Build sessions query with schedule group + facility + department join
  let query = supabase
    .from("sessions")
    .select(`
      *,
      schedule_groups (
        id, name, sport_category, activity_type, cost_cents, cost_notes,
        age_group, skill_level, max_participants,
        facilities ( id, name ),
        departments ( id, name )
      ),
      session_spaces ( spaces ( id, name, display_order ) ),
      session_templates ( id, name, color )
    `)
    .eq("is_active", true)
    .lte("valid_from", rangeEnd.toISOString().split("T")[0]);

  // Keep only sessions whose own valid_from/valid_until window overlaps the range
  query = query.or(
    `valid_until.is.null,valid_until.gte.${rangeStart.toISOString().split("T")[0]}`
  );

  if (orgId) query = query.eq("org_id", orgId);
  if (facilityId) query = query.eq("schedule_groups.facility_id", facilityId);
  if (departmentId) query = query.eq("schedule_groups.department_id", departmentId);
  if (scheduleGroupId) query = query.eq("schedule_group_id", scheduleGroupId);

  const { data, error: sessionsError } = await query;
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const sessions = data as unknown as SessionWithRelations[] | null;

  if (sessionsError) {
    console.error("sessions fetch error:", sessionsError);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }

  if (!sessions || sessions.length === 0) {
    return withCacheHeaders(NextResponse.json({ data: [] }), !user);
  }

  // Fetch exceptions for all sessions in the range
  const sessionIds = sessions.map((s) => s.id);
  const { data: exceptions, error: exceptionsError } = await supabase
    .from("session_exceptions")
    .select("*")
    .in("session_id", sessionIds)
    .gte("exception_date", rangeStart.toISOString().split("T")[0])
    .lte("exception_date", rangeEnd.toISOString().split("T")[0]);

  if (exceptionsError) {
    console.error("exceptions fetch error:", exceptionsError);
    return NextResponse.json({ error: "Failed to fetch exceptions" }, { status: 500 });
  }

  // Expand recurring rules into concrete occurrences
  const expanded = expandSessions(sessions, exceptions ?? [], {
    rangeStart,
    rangeEnd,
    orgId,
    facilityId,
    departmentId,
    scheduleGroupId,
  });

  const visible = await filterUnapprovedPublicWeeks(supabase, expanded, user);

  return withCacheHeaders(
    NextResponse.json({
      data: visible.map((s) => ({
        ...s,
        start: s.start.toISOString(),
        end: s.end.toISOString(),
      })),
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    }),
    !user
  );
}

/**
 * Caching is safe only for the anonymous response. `filterUnapprovedPublicWeeks`
 * already collapses every anonymous caller down to the same publicly-visible
 * data for a given query string — but an authenticated org member sees their
 * own org's unapproved weeks too, and that response must never end up in a
 * shared cache where a later anonymous request for the identical URL could be
 * served someone else's staff-only view.
 *
 * 30s is imperceptible for a schedule (nothing here needs sub-minute
 * freshness) but cuts both DB load and the blast radius of a request flood by
 * orders of magnitude — this is the endpoint every widget/public schedule
 * load hits, and it has no auth requirement to fall back on.
 */
function withCacheHeaders(response: NextResponse, isPublic: boolean): NextResponse {
  response.headers.set(
    "Cache-Control",
    isPublic
      ? "public, max-age=30, s-maxage=30, stale-while-revalidate=60"
      : "private, no-store"
  );
  return response;
}

/**
 * Hides occurrences that fall in a week no admin has approved yet (migration
 * 037) — but only from callers outside the org that owns the schedule. Staff
 * viewing their own org's data (the command centre) must keep seeing every
 * week regardless of review status; that's the whole point of a review step.
 *
 * A session is a recurring template, not a per-week row, so this can't be a
 * row-level RLS policy the way `sessions_public_read_active` gates by
 * schedule_groups.status — it has to run after expansion, against each
 * occurrence's own calendar week.
 */
async function filterUnapprovedPublicWeeks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  expanded: ExpandedSession[],
  user: User | null
): Promise<ExpandedSession[]> {
  if (expanded.length === 0) return expanded;

  const distinctOrgIds = [...new Set(expanded.map((s) => s.orgId))];

  let isSuperadmin = false;
  let callerOrgIds: string[] = [];
  if (user) {
    // app_metadata only — see migration 022. user_metadata is user-writable
    // and reading it here would let any signed-in visitor bypass every
    // schedule's week-approval gate with a single auth.updateUser() call.
    isSuperadmin = (user.app_metadata as { role?: string } | null)?.role === "superadmin";
    if (!isSuperadmin) {
      const { data: memberships } = await supabase
        .from("org_memberships")
        .select("org_id")
        .eq("user_id", user.id);
      callerOrgIds = (memberships ?? []).map((m) => m.org_id);
    }
  }
  if (isSuperadmin) return expanded;

  const publicOrgIds = distinctOrgIds.filter((orgId) => !callerOrgIds.includes(orgId));
  if (publicOrgIds.length === 0) return expanded;

  const publicScheduleGroupIds = [
    ...new Set(
      expanded.filter((s) => publicOrgIds.includes(s.orgId)).map((s) => s.scheduleGroupId)
    ),
  ];

  const { data: reviews } = await supabase
    .from("schedule_week_reviews")
    .select("schedule_group_id, week_start, status")
    .in("schedule_group_id", publicScheduleGroupIds);

  const approvedWeeks = new Set(
    (reviews ?? [])
      .filter((r) => r.status === "approved")
      .map((r) => `${r.schedule_group_id}:${r.week_start}`)
  );

  return expanded.filter((s) => {
    if (!publicOrgIds.includes(s.orgId)) return true;
    // sessionWeekStart reads UTC getters, the correct convention for a
    // session-Date occurrence (see rrule/README.md) — not a viewer-local one.
    const weekStartKey = sessionWeekStart(s.start).toISOString().slice(0, 10);
    return approvedWeeks.has(`${s.scheduleGroupId}:${weekStartKey}`);
  });
}
