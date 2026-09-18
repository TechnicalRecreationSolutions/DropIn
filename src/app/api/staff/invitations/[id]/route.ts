import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { can } from "@/lib/auth/roles";

/**
 * DELETE /api/staff/invitations/[id] — withdraw a pending invitation.
 *
 * The delete is scoped by `org_id` here and by RLS underneath: migration 056
 * lets a manager revoke anything in their org and a coordinator only what they
 * themselves sent (`invited_by = auth.uid()`). This route does not re-derive
 * that second rule — it lets the policy decide and reports what came back,
 * which keeps the two from drifting apart.
 *
 * `invitation_scopes` cascades on `invitation_id`.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const actor = { role: membership.role, scopes: membership.scopes };
  if (!can(actor, "staff:invite-aux")) {
    return NextResponse.json({ error: "You cannot manage invitations." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("staff_invitations")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not withdraw the invitation." }, { status: 500 });
  }

  // No row came back for three different reasons — wrong org, already
  // accepted, or RLS refused because a coordinator does not own this one. All
  // three are "there is nothing here for you to withdraw".
  if (!data) {
    return NextResponse.json(
      { error: "That invitation is no longer pending, or is not yours to withdraw." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
