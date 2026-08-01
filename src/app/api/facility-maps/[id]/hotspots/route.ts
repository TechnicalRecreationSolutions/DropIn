import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const HotspotSchema = z.object({
  space_id: z.string().uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  rotation: z.number().min(0).max(359.999).default(0),
  label: z.string().min(1).nullable().default(null),
  // Which preset the shape was placed from — drives its illustrated
  // rendering (see 019). Unrecognized keys degrade to the generic room.
  preset_key: z.string().min(1).default("generic-large"),
  // Multi-lane presets (e.g. "4-Lane 25m Pool") place several rows sharing
  // one group_id, all carrying the identical outer rect — see
  // 018_shape_lane_groups.sql. Both null for a standalone shape.
  group_id: z.string().uuid().nullable().default(null),
  lane_index: z.number().int().nonnegative().nullable().default(null),
}).refine((h) => (h.group_id === null) === (h.lane_index === null), {
  message: "group_id and lane_index must both be set or both be null",
});

const ReplaceHotspotsSchema = z.object({
  hotspots: z.array(HotspotSchema),
});

async function getMembership(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single();

  return membership;
}

/**
 * GET /api/facility-maps/[id]/hotspots — list hotspots for a map (staff view, unfiltered by publish state).
 * PUT /api/facility-maps/[id]/hotspots — replace the full hotspot set for a map in one batch.
 *
 * A full-replace (rather than per-rect CRUD) matches how the editor works —
 * an admin drags/resizes/deletes rects locally during one editing session,
 * then saves the whole set at once. Expected hotspot count per facility is
 * small (a handful of pools/courts), so delete-and-reinsert is simplest and
 * cheap; no need for a diffing update.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("space_hotspots")
    .select("*")
    .eq("facility_map_id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not load hotspots" }, { status: 500 });
  return NextResponse.json({ hotspots: data ?? [] });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getMembership(supabase);
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

  const parsed = ReplaceHotspotsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data: map } = await supabase
    .from("facility_maps")
    .select("id, facility_id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!map) return NextResponse.json({ error: "Facility map not found" }, { status: 404 });

  // Verify every referenced space belongs to the same facility as the map —
  // space_id has no DB-level check tying it to this specific map/facility.
  const spaceIds = [...new Set(parsed.data.hotspots.map((h) => h.space_id))];
  if (spaceIds.length > 0) {
    const { data: spaces } = await supabase
      .from("spaces")
      .select("id")
      .eq("facility_id", map.facility_id)
      .in("id", spaceIds);

    const validIds = new Set((spaces ?? []).map((s) => s.id));
    const invalid = spaceIds.filter((sid) => !validIds.has(sid));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "One or more spaces do not belong to this facility" }, { status: 400 });
    }
  }

  const { error: deleteError } = await supabase
    .from("space_hotspots")
    .delete()
    .eq("facility_map_id", id)
    .eq("org_id", membership.org_id);

  if (deleteError) {
    console.error("PUT /api/facility-maps/[id]/hotspots delete failed:", deleteError);
    return NextResponse.json({ error: `Could not save hotspots: ${deleteError.message}` }, { status: 500 });
  }

  if (parsed.data.hotspots.length === 0) {
    return NextResponse.json({ hotspots: [] });
  }

  const { data, error: insertError } = await supabase
    .from("space_hotspots")
    .insert(
      parsed.data.hotspots.map((h) => ({
        org_id: membership.org_id,
        facility_map_id: id,
        space_id: h.space_id,
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
        rotation: h.rotation,
        label: h.label,
        preset_key: h.preset_key,
        group_id: h.group_id,
        lane_index: h.lane_index,
      }))
    )
    .select("*");

  if (insertError) {
    console.error("PUT /api/facility-maps/[id]/hotspots insert failed:", insertError);
    return NextResponse.json(
      {
        error:
          insertError.code === "23505"
            ? "Each space can only have one hotspot on this map."
            : `Could not save hotspots: ${insertError.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ hotspots: data ?? [] });
}
