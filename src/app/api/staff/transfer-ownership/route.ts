import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { can } from "@/lib/auth/roles";

const TransferSchema = z.object({
  /** The membership row to promote — not a user id, which the UI never sees. */
  membershipId: z.string().uuid(),
  /** The organization's name, typed by the owner. See below. */
  confirmName: z.string().min(1),
});

/**
 * POST /api/staff/transfer-ownership
 *
 * Hands the organization to an existing member and demotes the caller to
 * Manager, in one statement inside `public.transfer_ownership()` (migration
 * 055 §8). One statement matters: a two-step version that died between them
 * would leave the org with either no owner or two.
 *
 * ## The typed confirmation
 *
 * This is the only action in the product the person taking it cannot undo
 * alone — afterwards they are a Manager, and Managers cannot transfer
 * ownership, so reversing it requires the *new* owner to agree. Requiring the
 * organization's name to be typed is the standard guard for exactly that shape
 * of action, and it costs one field.
 *
 * It is not a security control. The real ones are in the function: the caller
 * must be the current owner, and the recipient must already be a member, so
 * ownership cannot be handed to a stranger in a single unreviewable step.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const actor = { role: membership.role, scopes: membership.scopes };
  if (!can(actor, "org:transfer-ownership")) {
    return NextResponse.json(
      { error: "Only the owner can transfer ownership." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = TransferSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.org_id)
    .maybeSingle();

  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  if (parsed.data.confirmName.trim() !== org.name.trim()) {
    return NextResponse.json(
      { error: `Type the organization's name exactly — "${org.name}" — to confirm.` },
      { status: 400 }
    );
  }

  const { data: target } = await supabase
    .from("org_memberships")
    .select("user_id, role")
    .eq("id", parsed.data.membershipId)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const { error } = await supabase.rpc("transfer_ownership", {
    p_org_id: membership.org_id,
    p_new_owner_id: target.user_id,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Could not transfer ownership." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
