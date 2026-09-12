import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const CreateConfigurationSchema = z.object({
  facility_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  display_order: z.number().int().min(0).optional(),
});

/**
 * GET /api/facility-configurations?facilityId=... — list a facility's configurations.
 * POST /api/facility-configurations — create one.
 *
 * A configuration is a physical state of the building: "Long Course (50m)",
 * "Short Course (25m)", "Boards In" (migration 048). Spaces point at one, or at
 * none, which means they exist in all of them.
 *
 * Owner/admin only for writes, matching /api/spaces — configurations decide
 * which lanes even exist, so this is facility setup rather than schedule
 * editing, and `member` (which can edit schedules) is deliberately not enough.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const facilityId = new URL(request.url).searchParams.get("facilityId");

  let query = supabase
    .from("facility_configurations")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true });

  if (facilityId) query = query.eq("facility_id", facilityId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load configurations" }, { status: 500 });
  return NextResponse.json({ configurations: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only org owners and admins can manage configurations" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateConfigurationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // facility_id has no DB-level org boundary check (same gap /api/spaces
  // closes by hand) — without this, any signed-in admin could hang a
  // configuration off another org's facility.
  const { data: facility } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", parsed.data.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  // Appended after whatever is already there, so the order staff see matches
  // the order they created them in until they reorder deliberately.
  let displayOrder = parsed.data.display_order;
  if (displayOrder === undefined) {
    const { count } = await supabase
      .from("facility_configurations")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", parsed.data.facility_id);
    displayOrder = count ?? 0;
  }

  const { data, error } = await supabase
    .from("facility_configurations")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id,
      name: parsed.data.name.trim(),
      display_order: displayOrder,
    })
    .select("*")
    .single();

  if (error) {
    console.error("POST /api/facility-configurations failed:", error);
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "This facility already has a configuration with that name."
            : "Could not create configuration.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ configuration: data }, { status: 201 });
}
