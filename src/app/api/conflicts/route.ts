import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { findOrgConflicts } from "@/lib/sessions/conflicts";

/**
 * GET /api/conflicts — every double-booking currently in the caller's org
 * (see findOrgConflicts()), used by the manager page to refresh its list
 * after an action (reassign, deactivate, dismiss, restore) without a full
 * page reload.
 */
export async function GET() {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conflicts = await findOrgConflicts(supabase, membership.org_id);
  return NextResponse.json({ conflicts });
}
