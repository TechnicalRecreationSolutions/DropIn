import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const ContextElementSchema = z.object({
  kind: z.enum(["zone", "entrance"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  rotation: z.number().min(0).max(359.999).default(0),
  label: z.string().min(1).nullable().default(null),
});

const ReplaceContextElementsSchema = z.object({
  contextElements: z.array(ContextElementSchema),
});

/**
 * GET /api/facility-maps/[id]/context-elements — list a map's non-interactive
 * scenery (zones, entrance marker) for the editor, unfiltered by publish state.
 * PUT /api/facility-maps/[id]/context-elements — replace the full set in one
 * batch. Same full-replace convention as [id]/hotspots — the editor saves the
 * whole set at once and counts are tiny, so delete-and-reinsert is simplest.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("map_context_elements")
    .select("*")
    .eq("facility_map_id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not load context elements" }, { status: 500 });
  return NextResponse.json({ contextElements: data ?? [] });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = ReplaceContextElementsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data: map } = await supabase
    .from("facility_maps")
    .select("id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!map) return NextResponse.json({ error: "Facility map not found" }, { status: 404 });

  const { error: deleteError } = await supabase
    .from("map_context_elements")
    .delete()
    .eq("facility_map_id", id)
    .eq("org_id", membership.org_id);

  if (deleteError) {
    console.error("PUT /api/facility-maps/[id]/context-elements delete failed:", deleteError);
    return NextResponse.json({ error: "Could not save context elements" }, { status: 500 });
  }

  if (parsed.data.contextElements.length === 0) {
    return NextResponse.json({ contextElements: [] });
  }

  const { data, error: insertError } = await supabase
    .from("map_context_elements")
    .insert(
      parsed.data.contextElements.map((c) => ({
        org_id: membership.org_id,
        facility_map_id: id,
        kind: c.kind,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        rotation: c.rotation,
        label: c.label,
      }))
    )
    .select("*");

  if (insertError) {
    console.error("PUT /api/facility-maps/[id]/context-elements insert failed:", insertError);
    return NextResponse.json({ error: "Could not save context elements" }, { status: 500 });
  }

  return NextResponse.json({ contextElements: data ?? [] });
}
