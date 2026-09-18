import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

/**
 * POST /api/staff/members/leave — resign from this organization.
 *
 * Deliberately separate from DELETE /api/staff/members/[id], which is "someone
 * removed you". Migration 055 §7 blocks self-modification on org_memberships
 * outright — that is what stops self-promotion — so without this route nobody
 * could ever leave. `public.leave_organization()` is the sanctioned exception.
 *
 * The owner cannot leave: an organization with no owner has nobody who can pay
 * for it or delete it. Transfer ownership first.
 */
export async function POST() {
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const { error } = await supabase.rpc("leave_organization", {
    p_org_id: membership.org_id,
  });

  if (error) {
    // The function raises with a message already written for a person —
    // "Transfer ownership before leaving this organization".
    return NextResponse.json(
      { error: error.message || "Could not leave this organization." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
