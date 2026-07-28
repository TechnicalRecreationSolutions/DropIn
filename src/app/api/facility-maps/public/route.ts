import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: map } = await (supabase as any)
    .from("facility_maps")
    .select("*")
    .eq("facility_id", facilityId)
    .eq("is_published", true)
    .maybeSingle();

  if (!map) return NextResponse.json({ facilityMap: null, hotspots: [] });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hotspots } = await (supabase as any)
    .from("space_hotspots")
    .select("*, spaces(name, capacity)")
    .eq("facility_map_id", map.id);

  const hotspotsWithSpace = (hotspots ?? []).map(
    (h: { spaces: { name: string; capacity: number | null } | null; [key: string]: unknown }) => {
      const { spaces, ...rest } = h;
      return { ...rest, spaceName: spaces?.name ?? "", spaceCapacity: spaces?.capacity ?? null };
    }
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contextElements } = await (supabase as any)
    .from("map_context_elements")
    .select("*")
    .eq("facility_map_id", map.id);

  return NextResponse.json({
    facilityMap: map,
    hotspots: hotspotsWithSpace,
    contextElements: contextElements ?? [],
  });
}
