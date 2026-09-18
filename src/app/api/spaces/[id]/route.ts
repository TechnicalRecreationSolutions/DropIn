import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { departmentOfSpace } from "@/lib/auth/scope-lookup";
import { slugify } from "@/lib/utils/slugify";

const UpdateSpaceSchema = z.object({
  name: z.string().min(1).optional(),
  department_id: z.string().uuid().nullish(),
  description: z.string().nullish(),
  capacity: z.number().int().positive().nullish(),
  /** Free-text grouping label (migration 054) — display only, see SpacesPanel. */
  zone_name: z.string().trim().max(60).nullish(),
  is_published: z.boolean().optional(),
});

/**
 * PATCH /api/spaces/[id] — update a space's name/department/capacity/publish state.
 * DELETE /api/spaces/[id] — remove a space.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A coordinator may manage only the spaces in their own departments.
  // A space with no department (11 of 23 today) is owner/manager territory.
  const department = await departmentOfSpace(supabase, id, membership.org_id);
  if (department === undefined) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  const denied = requirePermission(membership, "space:write", department);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSpaceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // department_id has to belong to this space's own facility, and that boundary
  // is not enforced by the schema — so the space's facility is resolved here.
  if (parsed.data.department_id) {
    const { data: space } = await supabase
      .from("spaces")
      .select("facility_id")
      .eq("id", id)
      .eq("org_id", membership.org_id)
      .maybeSingle();

    if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", parsed.data.department_id)
      .eq("facility_id", space.facility_id)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  const payload = {
    ...parsed.data,
    ...(parsed.data.name ? { slug: slugify(parsed.data.name) } : {}),
    // A cleared field arrives as "" from the form; "" and null both mean
    // "not in a zone", and storing only one of them keeps the page's grouping
    // from sprouting an empty-named section.
    ...("zone_name" in parsed.data ? { zone_name: parsed.data.zone_name || null } : {}),
  };

  const { data, error } = await supabase
    .from("spaces")
    .update(payload)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A space with this name already exists at that facility." : "Could not update space." },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  return NextResponse.json({ space: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A coordinator may manage only the spaces in their own departments.
  // A space with no department (11 of 23 today) is owner/manager territory.
  const department = await departmentOfSpace(supabase, id, membership.org_id);
  if (department === undefined) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  const denied = requirePermission(membership, "space:write", department);
  if (denied) return denied;

  const { error } = await supabase
    .from("spaces")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete space" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
