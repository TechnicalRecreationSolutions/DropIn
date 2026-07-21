import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { expandSessions } from "@/lib/rrule/expand";
import { getWeekStart, getWeekEnd } from "@/lib/utils/dates";

const QuerySchema = z.object({
  weekStart: z.string().datetime({ offset: true }).optional(),
  orgId: z.string().uuid().optional(),
  facilityId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
});

/**
 * GET /api/sessions/expand
 *
 * Expands recurring sessions into concrete occurrences for a given week.
 * Used by WeeklyScheduleGrid (public) and WeeklyScheduleEditor (dashboard).
 *
 * Query params:
 *   weekStart   ISO datetime — any date in the target week (defaults to current week)
 *   orgId       Filter to one organization
 *   facilityId  Filter to one facility
 *   programId   Filter to one program
 *
 * At least one of orgId, facilityId, or programId is required to prevent
 * unbounded queries across the entire dataset.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = QuerySchema.safeParse({
    weekStart: searchParams.get("weekStart") ?? undefined,
    orgId: searchParams.get("orgId") ?? undefined,
    facilityId: searchParams.get("facilityId") ?? undefined,
    programId: searchParams.get("programId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { weekStart: weekStartParam, orgId, facilityId, programId } = parsed.data;

  if (!orgId && !facilityId && !programId) {
    return NextResponse.json(
      { error: "At least one of orgId, facilityId, or programId is required" },
      { status: 400 }
    );
  }

  // Compute week bounds (Monday–Sunday)
  const anchorDate = weekStartParam ? new Date(weekStartParam) : new Date();
  const weekStart = getWeekStart(anchorDate);
  const weekEnd = getWeekEnd(anchorDate);

  const supabase = await createClient();

  // Build sessions query with program + facility join
  let query = supabase
    .from("sessions")
    .select(`
      *,
      programs (
        id, name, sport_category, activity_type, cost_cents, cost_notes,
        age_group, skill_level, max_participants, is_published,
        facilities ( id, name )
      )
    `)
    .eq("is_active", true)
    .lte("valid_from", weekEnd.toISOString().split("T")[0]);

  // Filter to sessions whose season overlaps the week
  query = query.or(
    `valid_until.is.null,valid_until.gte.${weekStart.toISOString().split("T")[0]}`
  );

  if (orgId) query = query.eq("org_id", orgId);
  if (facilityId) query = query.eq("programs.facility_id", facilityId);
  if (programId) query = query.eq("program_id", programId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sessions, error: sessionsError } = await query as any;

  if (sessionsError) {
    console.error("sessions fetch error:", sessionsError);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // Fetch exceptions for all sessions in the week range
  const sessionIds = (sessions as Array<{ id: string }>).map((s) => s.id);
  const { data: exceptions, error: exceptionsError } = await supabase
    .from("session_exceptions")
    .select("*")
    .in("session_id", sessionIds)
    .gte("exception_date", weekStart.toISOString().split("T")[0])
    .lte("exception_date", weekEnd.toISOString().split("T")[0]);

  if (exceptionsError) {
    console.error("exceptions fetch error:", exceptionsError);
    return NextResponse.json({ error: "Failed to fetch exceptions" }, { status: 500 });
  }

  // Expand recurring rules into concrete occurrences
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expanded = expandSessions(sessions as any, exceptions ?? [], {
    weekStart,
    weekEnd,
    orgId,
    facilityId,
    programId,
  });

  return NextResponse.json({
    data: expanded.map((s) => ({
      ...s,
      start: s.start.toISOString(),
      end: s.end.toISOString(),
    })),
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  });
}
