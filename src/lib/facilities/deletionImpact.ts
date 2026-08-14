import { createClient } from "@/lib/supabase/server";

export type FacilityDeletionImpact = {
  departments: number;
  scheduleGroups: number;
  sessions: number;
  spaces: number;
  brochures: number;
};

/**
 * Counts what a facility delete would take with it.
 *
 * Deleting a facility is one of the few genuinely irreversible actions in the
 * app — every schedule in the building goes with it — so the confirmation
 * dialog states the real numbers rather than a generic "this cannot be
 * undone". Staff are far more careful about "12 schedules, 240 sessions" than
 * about a warning triangle.
 *
 * Every count is a HEAD request (`count: "exact", head: true`), so no rows
 * cross the wire; this runs on a page that already renders a form and should
 * not become the slow part of it.
 *
 * `sessions` has no `facility_id` of its own — it hangs off `schedule_groups`
 * (migration 011 collapsed `programs` away) — so it is counted through the
 * group ids rather than directly. When the facility has no schedule groups the
 * `in` filter would be an empty list, which PostgREST treats as "match
 * nothing" but is cheaper to skip outright.
 */
export async function getFacilityDeletionImpact(
  facilityId: string,
  orgId: string
): Promise<FacilityDeletionImpact> {
  const supabase = await createClient();

  const countIn = async (table: "departments" | "spaces" | "brochures") => {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityId)
      .eq("org_id", orgId);
    return count ?? 0;
  };

  const { data: groups } = await supabase
    .from("schedule_groups")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("org_id", orgId);

  const groupIds = (groups ?? []).map((g) => g.id);

  let sessions = 0;
  if (groupIds.length > 0) {
    const { count } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .in("schedule_group_id", groupIds);
    sessions = count ?? 0;
  }

  const [departments, spaces, brochures] = await Promise.all([
    countIn("departments"),
    countIn("spaces"),
    countIn("brochures"),
  ]);

  return {
    departments,
    scheduleGroups: groupIds.length,
    sessions,
    spaces,
    brochures,
  };
}
