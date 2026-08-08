import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import type { Database } from "@/types/database.types";

type FacilityMapUpsert = Database["public"]["Tables"]["facility_maps"]["Insert"];

const CreateFacilityMapSchema = z.object({
  facility_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  canvas_width: z.number().positive().optional(),
  canvas_height: z.number().positive().optional(),
});

/**
 * GET /api/facility-maps?facilityId=... — fetch the caller's facility map row (v1: at most one).
 * POST /api/facility-maps — create the canvas config row for a facility (lazily, on first shape placement).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  if (!facilityId) return NextResponse.json({ error: "Missing facilityId" }, { status: 400 });

  const { data, error } = await supabase
    .from("facility_maps")
    .select("*")
    .eq("org_id", membership.org_id)
    .eq("facility_id", facilityId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not load facility map" }, { status: 500 });
  return NextResponse.json({ facilityMap: data ?? null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage the facility map" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateFacilityMapSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Verify the facility belongs to the caller's own org — facility_id has no
  // DB-level org boundary check, so this must be enforced here.
  const { data: facility } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", parsed.data.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  // v1: a facility has at most one map. Replace an existing (unpublished or
  // published) row rather than accumulating orphaned rows.
  const { data: existing } = await supabase
    .from("facility_maps")
    .select("id")
    .eq("org_id", membership.org_id)
    .eq("facility_id", parsed.data.facility_id)
    .maybeSingle();

  const payload: FacilityMapUpsert = {
    ...(existing ? { id: existing.id } : {}),
    org_id: membership.org_id,
    facility_id: parsed.data.facility_id,
    name: parsed.data.name ?? "Facility Map",
  };
  if (!existing) {
    // Only set on first creation — canvas dimensions default at the DB
    // level, and an existing row's canvas size is changed via PATCH, not re-asserted here.
    if (parsed.data.canvas_width !== undefined) payload.canvas_width = parsed.data.canvas_width;
    if (parsed.data.canvas_height !== undefined) payload.canvas_height = parsed.data.canvas_height;
    payload.is_published = false;
  }

  const { data, error } = await supabase
    .from("facility_maps")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();

  if (error) {
    console.error("POST /api/facility-maps failed:", error);
    return NextResponse.json({ error: "Could not save facility map" }, { status: 500 });
  }
  return NextResponse.json({ facilityMap: data }, { status: 201 });
}
