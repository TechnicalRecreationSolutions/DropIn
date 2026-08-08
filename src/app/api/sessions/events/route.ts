import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";

/**
 * GET /api/sessions/events — does the caller's org have anything on its event
 * calendar?
 *
 * Only ever answers a yes/no plus a count. The dashboard needs this to gate the
 * "Events" widget layout the same way the floorplan layout is gated on a
 * published facility map (`/api/facility-maps`): an org must not be able to
 * publish a widget view that renders nothing.
 *
 * Deliberately not answered by `/api/sessions/expand?eventsOnly=true`. That
 * question is "are there events in *this range*", and an org whose only event
 * is in December would have the checkbox silently disabled every other month.
 * This one is range-free — it asks whether the flag has ever been set.
 *
 * Scoped to the caller's own org from their membership rather than from a query
 * param, so it cannot be used to probe another org's data.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { count, error } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", membership.org_id)
    .eq("is_event", true)
    .eq("is_active", true);

  if (error) {
    console.error("event session count error:", error);
    return NextResponse.json({ error: "Failed to count events" }, { status: 500 });
  }

  return NextResponse.json({ hasEvents: (count ?? 0) > 0, count: count ?? 0 });
}
