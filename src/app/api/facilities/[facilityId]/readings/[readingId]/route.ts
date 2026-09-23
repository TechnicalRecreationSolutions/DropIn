import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership, toActor } from "@/lib/auth/membership";
import { canReadFacility } from "@/lib/auth/roles";
import { requirePermission } from "@/lib/auth/guard";

/**
 * DELETE /api/facilities/[facilityId]/readings/[readingId]
 *
 * The only way to change a recorded observation, and it removes it rather than
 * editing it. There is no PATCH here and no UPDATE policy in the database: a
 * count either happened or it did not, and a guard who miscounted records
 * another one — the newest is what the public sees.
 *
 * Delete is for the other case: 400 typed instead of 40, or a count filed
 * against the wrong space. Left in place, that row sits in the
 * typical-attendance average for the next eight weeks.
 *
 * **Who may:** the person who recorded it, or an owner/manager. Enforced by
 * the DELETE policy in 061; the check here exists to give a sentence back
 * instead of a silent no-op — a policy that matches no rows deletes nothing
 * and reports success, which would look like the button not working.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ facilityId: string; readingId: string }> }
) {
  const { facilityId, readingId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = requirePermission(membership, "reading:write");
  if (denied) return denied;
  if (!canReadFacility(toActor(membership), facilityId)) {
    return NextResponse.json({ error: "That facility is not one of yours." }, { status: 403 });
  }

  // `.select()` on the delete so a row count comes back. Without it a delete
  // the policy refused is indistinguishable from one that succeeded, and the
  // guard whose row survived would press the button again.
  const { data, error } = await supabase
    .from("facility_readings")
    .delete()
    .eq("id", readingId)
    .eq("facility_id", facilityId)
    .eq("org_id", membership.org_id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: "Could not delete that reading" }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "That reading is not there, or it was recorded by someone else." },
      { status: 404 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
