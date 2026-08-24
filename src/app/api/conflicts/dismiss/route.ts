import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const DismissSchema = z.object({
  sessionAId: z.string().uuid(),
  sessionBId: z.string().uuid(),
  note: z.string().nullish(),
});

/** Orders a pair the same way findOrgConflicts()'s pairKey and the
 *  session_conflict_dismissals CHECK constraint do — lower id first. */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * POST /api/conflicts/dismiss — mark a conflicting session pair as known/
 * intentional. Upserts on the (session_a_id, session_b_id) unique index, so
 * dismissing an already-dismissed pair just updates the note rather than
 * erroring.
 *
 * DELETE — undo a dismissal (the pair goes back to showing as an active
 * conflict on the next scan).
 *
 * Membership-only, no owner|admin gate — dismissing a conflict is "schedule
 * editing" in the same sense drag-to-reschedule is (see
 * /api/sessions/[sessionId]/route.ts's header and SECURITY.md → L2), and
 * matches session_conflict_dismissals' member-writable RLS policy
 * (039_session_conflict_dismissals.sql).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = DismissSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const [sessionAId, sessionBId] = orderPair(parsed.data.sessionAId, parsed.data.sessionBId);

  // Both sessions must actually belong to the caller's org — session ids
  // arrive from the client, and this route has no other org boundary check.
  const { data: sessionRows } = await supabase
    .from("sessions")
    .select("id")
    .eq("org_id", membership.org_id)
    .in("id", [sessionAId, sessionBId]);
  if ((sessionRows?.length ?? 0) !== 2) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("session_conflict_dismissals")
    .upsert(
      {
        org_id: membership.org_id,
        session_a_id: sessionAId,
        session_b_id: sessionBId,
        note: parsed.data.note ?? null,
        dismissed_by: user.id,
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: "session_a_id,session_b_id" }
    )
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: "Could not dismiss this conflict." }, { status: 500 });
  return NextResponse.json({ ok: true, dismissalId: data.id });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = DismissSchema.pick({ sessionAId: true, sessionBId: true }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const [sessionAId, sessionBId] = orderPair(parsed.data.sessionAId, parsed.data.sessionBId);

  const { error } = await supabase
    .from("session_conflict_dismissals")
    .delete()
    .eq("org_id", membership.org_id)
    .eq("session_a_id", sessionAId)
    .eq("session_b_id", sessionBId);

  if (error) return NextResponse.json({ error: "Could not restore this conflict." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
