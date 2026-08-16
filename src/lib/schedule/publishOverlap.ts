import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Checks whether publishing `scheduleGroupId` with the given [startsOn, endsOn]
 * range would double-book a space already claimed by another published
 * schedule group at the same facility.
 *
 * Only meaningful for an *existing* schedule group — one being created has no
 * sessions yet, so it can't structurally claim any space. `POST
 * /api/schedule-groups` never calls this for that reason; only the PATCH
 * route (an existing row transitioning to, or already at, 'published') does.
 *
 * A NULL starts_on/ends_on on either side (the OTHER schedule group, or
 * `endsOn` here — publishing no longer requires an end date, see the PATCH
 * route's gate) is not "unknown": see migration 033's backfill, it only
 * leaves ends_on NULL when that group's sessions are genuinely open-ended (no
 * valid_until). So it's treated as unbounded past/future, not skipped — an
 * indefinite "Lane Swim" that's already published correctly blocks a new
 * schedule from claiming the same lane starting any time after Lane Swim's
 * own start date, and publishing a new *open-ended* schedule is likewise
 * checked as running forever, not just up to some assumed end.
 */
export async function findPublishOverlap(
  supabase: SupabaseServerClient,
  params: { scheduleGroupId: string; facilityId: string; startsOn: string; endsOn: string | null }
): Promise<{ error: string } | null> {
  const { scheduleGroupId, facilityId, startsOn, endsOn } = params;

  // This schedule group's own claimed spaces, via its active sessions.
  const { data: sessionRows } = await supabase
    .from("sessions")
    .select("id")
    .eq("schedule_group_id", scheduleGroupId)
    .eq("is_active", true);
  const sessionIds = (sessionRows ?? []).map((r) => r.id);
  if (sessionIds.length === 0) return null;

  const { data: spaceRows } = await supabase
    .from("session_spaces")
    .select("space_id")
    .in("session_id", sessionIds);
  const spaceIds = Array.from(new Set((spaceRows ?? []).map((r) => r.space_id)));
  if (spaceIds.length === 0) return null;

  // Other published schedule groups at this facility whose date range overlaps.
  const { data: candidates } = await supabase
    .from("schedule_groups")
    .select("id, name, starts_on, ends_on")
    .eq("facility_id", facilityId)
    .eq("status", "published")
    .neq("id", scheduleGroupId);

  const dateOverlapping = (candidates ?? []).filter((g) => {
    const endsOk = g.ends_on === null || g.ends_on >= startsOn;
    const startsOk = g.starts_on === null || endsOn === null || g.starts_on <= endsOn;
    return endsOk && startsOk;
  });
  if (dateOverlapping.length === 0) return null;

  // Of those, which actually claim one of our spaces via their own active sessions.
  const candidateIds = dateOverlapping.map((g) => g.id);
  const { data: candidateSessions } = await supabase
    .from("sessions")
    .select("id, schedule_group_id")
    .in("schedule_group_id", candidateIds)
    .eq("is_active", true);
  const candidateSessionIds = (candidateSessions ?? []).map((r) => r.id);
  if (candidateSessionIds.length === 0) return null;

  const { data: candidateSpaceRows } = await supabase
    .from("session_spaces")
    .select("session_id, space_id")
    .in("session_id", candidateSessionIds)
    .in("space_id", spaceIds);
  if (!candidateSpaceRows || candidateSpaceRows.length === 0) return null;

  const conflictingSessionIds = new Set(candidateSpaceRows.map((r) => r.session_id));
  const conflictingGroupIds = new Set(
    (candidateSessions ?? [])
      .filter((r) => conflictingSessionIds.has(r.id))
      .map((r) => r.schedule_group_id)
  );
  const conflictingNames = dateOverlapping
    .filter((g) => conflictingGroupIds.has(g.id))
    .map((g) => g.name);

  return {
    error:
      conflictingNames.length === 1
        ? `Overlaps with the already-published schedule "${conflictingNames[0]}" — they share a space during that date range.`
        : `Overlaps with already-published schedules (${conflictingNames.join(", ")}) — they share a space during that date range.`,
  };
}
