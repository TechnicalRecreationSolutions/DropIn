import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/session";
import { canReadFacility, isReadOnly } from "@/lib/auth/roles";
import { pickFacility } from "@/lib/dashboard/scope";
import { rememberedFacilityId } from "@/lib/dashboard/scope.server";
import { loadNeedsYou } from "@/lib/dashboard/needsYou";

/**
 * GET /api/overview/needs?facility=<id>
 *
 * How many things are waiting on the caller, for the badge on the sidebar's
 * Overview row. The SAME computation the Overview renders (loadNeedsYou), so
 * the number on the row is always the length of the list behind it.
 *
 * Read-only staff get zero: they have no Overview, and nothing on it is theirs
 * to act on.
 */
export async function GET(request: Request) {
  const orgContext = await getOrgContext();
  if (!orgContext) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isReadOnly(orgContext.membership.role)) return NextResponse.json({ count: 0, urgent: 0 });

  const supabase = await createClient();
  const requested = new URL(request.url).searchParams.get("facility");

  // Same resolution as the Overview, so the badge is the length of the list
  // behind it: the named building, else the remembered one, else the first
  // the caller can read.
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id")
    .eq("org_id", orgContext.org.id)
    .order("name");
  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const readable = (facilities ?? []).filter((f) => canReadFacility(actor, f.id));
  const facilityId = pickFacility(readable, requested, await rememberedFacilityId())?.id ?? null;

  const { count, urgent } = await loadNeedsYou(supabase, orgContext, { facilityId });
  return NextResponse.json(
    { count, urgent },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
