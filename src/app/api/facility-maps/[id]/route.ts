import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const UpdateFacilityMapSchema = z.object({
  name: z.string().min(1).optional(),
  canvas_width: z.number().positive().optional(),
  canvas_height: z.number().positive().optional(),
  is_published: z.boolean().optional(),
});

/**
 * PATCH /api/facility-maps/[id] — resize the canvas and/or toggle publish state.
 * DELETE /api/facility-maps/[id] — remove the map (cascades its shapes).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const parsed = UpdateFacilityMapSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data, error } = await supabase
    .from("facility_maps")
    .update(parsed.data)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not update facility map" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Facility map not found" }, { status: 404 });

  return NextResponse.json({ facilityMap: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage the facility map" }, { status: 403 });
  }

  const { data: map } = await supabase
    .from("facility_maps")
    .select("id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!map) return NextResponse.json({ error: "Facility map not found" }, { status: 404 });

  const { error } = await supabase
    .from("facility_maps")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete facility map" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
