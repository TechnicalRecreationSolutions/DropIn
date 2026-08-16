import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { expandSessions, type SessionWithRelations } from "@/lib/rrule/expand";
import { getWeekStart, getWeekEnd, toSessionTime } from "@/lib/utils/dates";

const QuerySchema = z.object({
  rangeStart: z.string().datetime({ offset: true }).optional(),
  rangeEnd: z.string().datetime({ offset: true }).optional(),
  /** Legacy alias for rangeStart — see the note in the handler. */
  weekStart: z.string().datetime({ offset: true }).optional(),
  orgId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  scheduleGroupId: z.string().uuid().optional(),
  seasonId: z.string().uuid().optional(),
  eventsOnly: z.enum(["true", "false"]).optional(),
});

/**
 * Widest range a single call may expand. A month grid asks for ~6 weeks; a
 * season view would ask for ~16. Beyond that the cost is unbounded — expansion
 * is O(occurrences), so a year of an org-wide schedule is tens of thousands of
 * objects built and serialized for a view no one can read anyway. Callers that
 * genuinely need more should page by month.
 */
const MAX_RANGE_DAYS = 120;

/**
 * GET /api/sessions/expand
 *
 * Expands recurring sessions into concrete occurrences over a date range.
 * Used by every schedule surface: the weekly grid/list/map, the floorplan,
 * the month event calendar, the public widget, and the command centre.
 *
 * Query params:
 *   rangeStart        ISO datetime — start of the range (defaults to the current week's Monday)
 *   rangeEnd          ISO datetime — end of the range (defaults to rangeStart's Sunday)
 *   weekStart         Legacy alias for rangeStart
 *   orgId             Filter to one organization
 *   facilityId        Filter to one facility
 *   departmentId      Filter to one department
 *   scheduleGroupId   Filter to one schedule group
 *   seasonId          Filter to sessions explicitly assigned to one season
 *   eventsOnly        "true" to return only sessions flagged is_event
 *
 * At least one of orgId, facilityId, or scheduleGroupId is required to
 * prevent unbounded queries across the entire dataset. seasonId does not
 * satisfy that requirement on its own — it narrows a scope rather than
 * being one, and a season spans every facility in the org.
 *
 * Note that seasonId matches sessions.season_id exactly: sessions left
 * unassigned are excluded even when their dates fall inside the season, which
 * is the point of the column being explicit rather than inferred (see the
 * header of migration 027).
 *
 * RANGE SEMANTICS. This endpoint was week-shaped until the event calendar
 * needed a month, and the old contract was subtly lossy: it snapped whatever
 * you sent to the enclosing Monday–Sunday. Callers now say exactly what they
 * want. `weekStart` alone still behaves precisely as before — it snaps to that
 * week — so nothing that predates the change has to change.
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
    seasonId: searchParams.get("seasonId") ?? undefined,
    eventsOnly: searchParams.get("eventsOnly") ?? undefined,
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
    seasonId,
    eventsOnly,
  } = parsed.data;

  if (!orgId && !facilityId && !scheduleGroupId) {
    return NextResponse.json(
      { error: "At least one of orgId, facilityId, or scheduleGroupId is required" },
      { status: 400 }
    );
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

  const supabase = await createClient();

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
      session_templates ( id, name, color ),
      session_features (
        title, summary, description, image_url,
        link_url, link_label, event_category, accent_color
      )
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
  if (seasonId) query = query.eq("season_id", seasonId);
  // The event calendar spans a whole month across every building, which is far
  // too many occurrences to render as a schedule — it wants only what staff
  // deliberately flagged as worth showing.
  if (eventsOnly === "true") query = query.eq("is_event", true);

  const { data, error: sessionsError } = await query;
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const sessions = data as unknown as SessionWithRelations[] | null;

  if (sessionsError) {
    console.error("sessions fetch error:", sessionsError);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ data: [] });
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
    seasonId,
  });

  return NextResponse.json({
    data: expanded.map((s) => ({
      ...s,
      start: s.start.toISOString(),
      end: s.end.toISOString(),
    })),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
  });
}
