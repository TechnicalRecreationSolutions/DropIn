import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";

const PatchSessionSchema = z.object({
  rrule: z.string().min(1).optional(),
  dtstart: z.string().datetime({ offset: true }).optional(),
  dtend_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/**
 * PATCH /api/sessions/[sessionId] — partial update for drag-to-reschedule.
 * Only accepts the fields a drag can change (day/time) so callers don't need
 * to round-trip the full session record (rrule, dtend_time, valid_from/until,
 * timezone, spaces) just to move one block on the grid — unlike POST
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

  const { error } = await supabase
    .from("sessions")
    .update(parsed.data)
    .eq("id", sessionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to update session." }, { status: 500 });
  return NextResponse.json({ ok: true, sessionId });
}
