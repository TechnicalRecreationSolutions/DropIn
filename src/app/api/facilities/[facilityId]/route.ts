import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

/**
 * DELETE /api/facilities/[facilityId] — remove a facility and everything under it.
 *
 * Owner/admin only, matching `/api/departments/[id]`. Migration 024 draws the
 * line at structural-vs-content: a member may edit the schedule inside a
 * building but may not remove the building. Deleting a facility removes every
 * schedule in it, so it sits firmly on the structural side.
 *
 * The cascade is entirely in the schema — `departments`, `schedule_groups`,
 * `spaces`, `facility_maps` and `widget_configs` all declare `ON DELETE
 * CASCADE` on `facility_id`, and `sessions` follow their schedule group down.
 * Nothing is deleted here row by row, deliberately: a hand-rolled cascade
 * would need updating every time a table gains a `facility_id`, and would
 * silently miss the one that was forgotten.
 *
 * `analytics_events.facility_id` is `ON DELETE SET NULL` instead, so historical
 * counts survive the building they were recorded against.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params;
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can delete a facility." },
      { status: 403 }
    );
  }

  // Scoped by org_id as well as id — RLS already restricts the row, but the
  // explicit predicate means a policy regression can't turn this into a
  // cross-org delete, and it lets a missing row answer 404 rather than a
  // silent 200 over zero rows.
  const { data, error } = await supabase
    .from("facilities")
    .delete()
    .eq("id", facilityId)
    .eq("org_id", membership.org_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not delete this facility." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
