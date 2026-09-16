import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { expandSessions, type SessionWithRelations } from "@/lib/rrule/expand";
import { getWeekStart, getWeekEnd, toSessionTime, sessionWeekStart } from "@/lib/utils/dates";
import type { ExpandedSession } from "@/types/schedule.types";
import type { User } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { RESERVED_PUBLIC_LABEL } from "@/lib/sessions/occupancy";
import { subtractExclusiveClaims } from "@/lib/schedule/residual";

const QuerySchema = z.object({
  rangeStart: z.string().datetime({ offset: true }).optional(),
  rangeEnd: z.string().datetime({ offset: true }).optional(),
  /** Legacy alias for rangeStart — see the note in the handler. */
  weekStart: z.string().datetime({ offset: true }).optional(),
  orgId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  scheduleGroupId: z.string().uuid().optional(),
  /**
   * `audience=public` makes a signed-in staff caller be treated as an outsider:
   * withheld names redacted, internal sessions dropped, unapproved weeks hidden.
   * It powers the command centre's "Patron view" toggle.
   *
   * There is deliberately **no `audience=staff` value**. This parameter can only
   * ever narrow what a caller sees, never widen it — so it needs no
   * authorization of its own, and nobody can mistake it for something that
   * grants access. Staff treatment is what you get by not passing it, and it
   * still depends entirely on real org membership.
   */
  audience: z.literal("public").optional(),
  /**
   * `subtract=none` returns residual blocks exactly as staff entered them,
   * skipping the exclusive-claim subtraction below.
   *
   * For the two shadow-mode surfaces only (the availability panel and the deck
   * sheet), whose entire job is to compare what a block *publishes* against what
   * the bookings *leave*. Fed the subtracted schedule they would be comparing it
   * with itself and could never report a difference, which is a tautology
   * wearing the costume of a check. Never use it to render a schedule.
   */
  subtract: z.literal("none").optional(),
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
 * The one relational select every session read here uses — the main query and
 * the rival query below must produce the *same* shape, because both are fed to
 * `expandSessions`. Extracted so they cannot drift.
 */
const SESSION_SELECT = `
  *,
  schedule_groups (
    id, name, sport_category, activity_type, cost_cents, cost_notes,
    age_group, skill_level, max_participants,
    facilities ( id, name ),
    departments ( id, name )
  ),
  session_spaces (
    spaces ( id, name, display_order, configuration_id,
             facility_configurations ( id, name ) )
  ),
  session_templates ( id, name, color )
`;

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
 *   audience          `public` to be treated as an outsider (narrows only)
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
    audience: searchParams.get("audience") ?? undefined,
    subtract: searchParams.get("subtract") ?? undefined,
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
    audience,
    subtract,
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
    .select(SESSION_SELECT)
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

  // Resolved once and shared by both passes below — each needs to know which
  // orgs the caller is inside, and asking twice would mean two membership
  // round-trips on the app's hottest endpoint.
  // `audience=public` collapses the caller to an outsider *after* the query has
  // run. RLS still handed this staff member their own org's rows — unavoidable,
  // and fine, because the narrowing then happens in the same two passes a real
  // patron goes through. Simulating the public payload in the browser instead
  // would be a second implementation of the redaction rules, free to drift from
  // the one patrons actually get, which would make the preview worthless
  // precisely when it mattered.
  const caller =
    audience === "public"
      ? { isSuperadmin: false, orgIds: [] }
      : await resolveCallerOrgs(supabase, user);

  const approved = await filterUnapprovedPublicWeeks(supabase, expanded, caller);
  const visible = await applyDisclosure(supabase, approved, caller);

  /**
   * Drop-in blocks are residual, so what they publish depends on bookings that
   * may sit entirely outside the requested scope: a rental usually lives under a
   * *different* schedule group than the drop-in block it eats into. Subtracting
   * only within `visible` would compute full availability and be confidently
   * wrong, so a narrowed request pays for one extra, highly selective query for
   * the facility's exclusive claims — and only when actually narrowed. An
   * org-wide or facility-wide request already holds every rival it needs, and
   * spaces never cross facilities, so neither case runs this at all.
   */
  const narrowed = subtract !== "none" && (!!departmentId || !!scheduleGroupId);
  const rivalFacilityIds = [...new Set(visible.map((s) => s.facilityId))];
  let rivals = visible;

  if (narrowed && rivalFacilityIds.length > 0) {
    let rivalQuery = supabase
      .from("sessions")
      .select(SESSION_SELECT)
      .eq("is_active", true)
      .neq("occupancy_kind", "drop_in")
      .in("schedule_groups.facility_id", rivalFacilityIds)
      .not("id", "in", `(${sessionIds.join(",")})`)
      .lte("valid_from", rangeEnd.toISOString().split("T")[0]);
    rivalQuery = rivalQuery.or(
      `valid_until.is.null,valid_until.gte.${rangeStart.toISOString().split("T")[0]}`
    );

    const { data: rivalRows, error: rivalError } = await rivalQuery;
    if (rivalError) {
      // Never fail the schedule over the subtraction: a block drawn at full
      // width is the behaviour every caller had before this existed, whereas a
      // 500 here takes the whole schedule down.
      console.error("rival sessions fetch error:", rivalError);
    } else {
      const rivalSessions = (rivalRows ?? []) as unknown as SessionWithRelations[];
      const rivalIds = rivalSessions.map((s) => s.id);
      const { data: rivalExceptions } = rivalIds.length
        ? await supabase
            .from("session_exceptions")
            .select("*")
            .in("session_id", rivalIds)
            .gte("exception_date", rangeStart.toISOString().split("T")[0])
            .lte("exception_date", rangeEnd.toISOString().split("T")[0])
        : { data: [] };

      const rivalExpanded = expandSessions(rivalSessions, rivalExceptions ?? [], {
        rangeStart,
        rangeEnd,
      });
      // Rivals go through the same two passes as the main set, so an unapproved
      // week's program cannot cut a block for a patron who cannot see it, and a
      // reserved rental cuts under the name "Reserved" rather than its own.
      const rivalApproved = await filterUnapprovedPublicWeeks(supabase, rivalExpanded, caller);
      const rivalVisible = await applyDisclosure(supabase, rivalApproved, caller);
      rivals = [...visible, ...rivalVisible];
    }
  }

  // Staff keep a block their own claims have swallowed whole — it is still a row
  // they have to be able to reach — while a patron must not be shown water that
  // a rental has taken outright. `audience=public` collapses a staff caller to
  // the patron branch here exactly as it does everywhere else, so the preview
  // keeps telling the truth.
  const insiderOrgIds = new Set(caller.orgIds);
  const resolved =
    subtract === "none"
      ? visible
      : subtractExclusiveClaims(visible, rivals, {
          preserveFullyClaimed: (s) => caller.isSuperadmin || insiderOrgIds.has(s.orgId),
        });

  return withCacheHeaders(
    NextResponse.json({
      data: resolved.map((s) => ({
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

/** Which orgs the caller is inside — the one question both passes below ask. */
interface CallerOrgs {
  isSuperadmin: boolean;
  orgIds: string[];
}

/**
 * Resolves the caller's org memberships once per request.
 *
 * app_metadata only — see migration 022. user_metadata is user-writable, and
 * reading it here would let any signed-in visitor claim superadmin (and with it
 * every org's unapproved weeks and every withheld renter name) with a single
 * auth.updateUser() call.
 */
async function resolveCallerOrgs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: User | null
): Promise<CallerOrgs> {
  if (!user) return { isSuperadmin: false, orgIds: [] };

  const isSuperadmin = (user.app_metadata as { role?: string } | null)?.role === "superadmin";
  if (isSuperadmin) return { isSuperadmin: true, orgIds: [] };

  const { data: memberships } = await supabase
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", user.id);

  return { isSuperadmin: false, orgIds: (memberships ?? []).map((m) => m.org_id) };
}

/**
 * Applies migration 046's disclosure rules to an expanded week.
 *
 * Two halves, and they are opposites — which is why they live in one function
 * where the boundary between insider and outsider is stated once:
 *
 * - **Insiders** (org members, and superadmins) get `holderName`/`setupNotes`
 *   attached from `session_internal`. That table has no public-read policy, so
 *   this query returns nothing for anyone else even if it were run — it is
 *   skipped for outsiders anyway, since the hottest path in the app is the
 *   anonymous one and it has no use for the data.
 * - **Outsiders** get `reserved` occurrences stripped of every field that could
 *   name the holder: the schedule group's name (a "Swim Club Rentals" group
 *   names the renter by itself), the template's name and colour, and the
 *   cost/age/skill attributes, each of which hints at who the booking is for.
 *   The time and the spaces stay — that is the availability a patron came for,
 *   and withholding it would defeat the point of publishing the block at all.
 *
 * Internal occurrences are dropped for outsiders here **as well as** by RLS.
 * Not belt-and-braces for its own sake: `audience=public` collapses a signed-in
 * staff caller to an outsider *after* their own rows have already come back
 * through RLS, so without this filter the "Patron view" toggle would show staff
 * exactly the internal bookings it claims to be hiding — a preview that lies in
 * the one direction that matters. For a real patron the filter is a no-op,
 * because those rows never arrived.
 */
async function applyDisclosure(
  supabase: Awaited<ReturnType<typeof createClient>>,
  expanded: ExpandedSession[],
  caller: CallerOrgs
): Promise<ExpandedSession[]> {
  if (expanded.length === 0) return expanded;

  const insiderOrgIds = new Set(caller.orgIds);
  const isInsider = (s: ExpandedSession) => caller.isSuperadmin || insiderOrgIds.has(s.orgId);

  const insiderSessionIds = [
    ...new Set(expanded.filter(isInsider).map((s) => s.sessionId)),
  ];

  const internalBySession = new Map<string, { holder_name: string | null; setup_notes: string | null }>();
  if (insiderSessionIds.length > 0) {
    const { data: internalRows } = await supabase
      .from("session_internal")
      .select("session_id, holder_name, setup_notes")
      .in("session_id", insiderSessionIds);

    for (const row of internalRows ?? []) {
      internalBySession.set(row.session_id, {
        holder_name: row.holder_name,
        setup_notes: row.setup_notes,
      });
    }
  }

  const audienceVisible = expanded.filter(
    (s) => isInsider(s) || s.disclosure !== "internal"
  );

  return audienceVisible.map((s) => {
    if (isInsider(s)) {
      const internal = internalBySession.get(s.sessionId);
      if (!internal) return s;
      return { ...s, holderName: internal.holder_name, setupNotes: internal.setup_notes };
    }

    if (s.disclosure !== "reserved") return s;

    return {
      ...s,
      scheduleGroupName: RESERVED_PUBLIC_LABEL,
      templateName: null,
      templateColor: null,
      costCents: 0,
      costNotes: null,
      ageGroup: null,
      skillLevel: null,
      maxParticipants: null,
      // Belt and braces. These are already null for an outside caller — the
      // sidecar was never queried for them — and are restated here so that a
      // future edit which does populate them cannot make this branch a leak.
      holderName: null,
      setupNotes: null,
    };
  });
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
  caller: CallerOrgs
): Promise<ExpandedSession[]> {
  if (expanded.length === 0) return expanded;

  const distinctOrgIds = [...new Set(expanded.map((s) => s.orgId))];

  if (caller.isSuperadmin) return expanded;

  const publicOrgIds = distinctOrgIds.filter((orgId) => !caller.orgIds.includes(orgId));
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
