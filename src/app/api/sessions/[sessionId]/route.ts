import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { findSessionConflict } from "@/lib/sessions/conflicts";

const PatchSessionSchema = z.object({
  rrule: z.string().min(1).optional(),
  // Must be "Z"-suffixed, not an arbitrary offset — see the same note on
  // SessionSchema in /api/sessions/route.ts.
  dtstart: z.string().datetime().optional(),
  dtend_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/**
 * PATCH /api/sessions/[sessionId] — partial update for drag-to-reschedule.
 * Only accepts the fields a drag can change (day/time) so callers don't need
 * to round-trip the full session record (rrule, dtend_time, valid_from/until,
 * spaces) just to move one block on the grid — unlike POST
 * /api/sessions, which always requires the complete payload. Space
 * membership never changes through this route: a multi-space session's
 * blocks all move together on drag, and which spaces it occupies is only
 * ever changed through the create/duplicate/edit dialogs.
 *
 * Deliberately membership-only — no `owner|admin` check. Rescheduling is
 * "schedule editing", which the role model grants every member
 * (`001_initial_schema.sql:60`), and migration 024 left `sessions`,
 * `session_exceptions` and `session_spaces` member-writable at the RLS layer
 * for that same reason while narrowing every *structural* table to
 * `org_can_manage()`. Adding a role check here would contradict both.
 * See SECURITY.md → L2.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PatchSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  // A drag only sends the fields it changed — merge with the existing row to
  // build the full candidate findSessionConflict() needs. Space membership
  // never changes through this route (see header), so the session's current
  // session_spaces rows are exactly what a drag would still occupy.
  const { data: existing } = await supabase
    .from("sessions")
    .select("rrule, dtstart, dtend_time, valid_from, valid_until")
    .eq("id", sessionId)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { data: spaceRows } = await supabase
    .from("session_spaces")
    .select("space_id")
    .eq("session_id", sessionId);

  const conflict = await findSessionConflict(supabase, {
    sessionId,
    rrule: parsed.data.rrule ?? existing.rrule,
    dtstart: parsed.data.dtstart ?? existing.dtstart,
    dtend_time: parsed.data.dtend_time ?? existing.dtend_time,
    valid_from: existing.valid_from,
    valid_until: existing.valid_until,
    spaceIds: (spaceRows ?? []).map((r) => r.space_id),
  });
  if (conflict) return NextResponse.json({ error: conflict.error }, { status: 409 });

  const { error } = await supabase
    .from("sessions")
    .update(parsed.data)
    .eq("id", sessionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to update session." }, { status: 500 });
  return NextResponse.json({ ok: true, sessionId });
}
