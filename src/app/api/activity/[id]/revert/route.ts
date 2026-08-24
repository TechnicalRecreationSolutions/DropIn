import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

/**
 * POST /api/activity/[id]/revert — undo a single logged change.
 *
 * The actual revert logic (including the owner/admin check) lives in the
 * revert_activity() Postgres function (038_activity_log.sql) — this route is
 * a thin RLS-authenticated wrapper. The role check here is a fast, friendly
 * 403 for the common case; revert_activity() re-checks it itself (via
 * org_can_manage()) as the real gate, since this route can't be trusted to
 * be the only caller of a SECURITY DEFINER RPC.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can revert a change" }, { status: 403 });
  }

  const { error } = await supabase.rpc("revert_activity", { p_activity_id: id });
  if (error) {
    return NextResponse.json({ error: error.message || "Could not revert this change." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
