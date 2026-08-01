import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type HotspotWithSpaceRow = Database["public"]["Tables"]["space_hotspots"]["Row"] & {
  spaces: { name: string; capacity: number | null } | null;
};

/**
 * GET /api/facility-maps/public?facilityId=...
 *
 * Public, no auth required — mirrors /api/sessions/expand's pattern of
 * relying on RLS (facility_maps_public_read_published /
 * space_hotspots_public_read_published) rather than a membership check.
 * Returns the facility's single published map plus its hotspots, each
 * joined with the linked space's name/capacity for display.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  if (!facilityId) return NextResponse.json({ error: "Missing facilityId" }, { status: 400 });

  const supabase = await createClient();

  const { data: map } = await supabase
    .from("facility_maps")
    .select("*")
    .eq("facility_id", facilityId)
    .eq("is_published", true)
    .maybeSingle();

  if (!map) return NextResponse.json({ facilityMap: null, hotspots: [] });

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: hotspots } = (await supabase
    .from("space_hotspots")
    .select("*, spaces(name, capacity)")
    .eq("facility_map_id", map.id)) as unknown as { data: HotspotWithSpaceRow[] | null };

  const hotspotsWithSpace = (hotspots ?? []).map((h) => {
    const { spaces, ...rest } = h;
    return { ...rest, spaceName: spaces?.name ?? "", spaceCapacity: spaces?.capacity ?? null };
  });

  const { data: contextElements } = await supabase
    .from("map_context_elements")
    .select("*")
    .eq("facility_map_id", map.id);

  return NextResponse.json({
    facilityMap: map,
    hotspots: hotspotsWithSpace,
    contextElements: contextElements ?? [],
  });
}
