import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { slugify } from "@/lib/utils/slugify";

const CreateSpaceSchema = z.object({
  facility_id: z.string().uuid(),
  department_id: z.string().uuid().nullish(),
  name: z.string().min(1),
  description: z.string().nullish(),
  capacity: z.number().int().positive().nullish(),
  /** Free-text grouping label (migration 054) — display only, see SpacesPanel. */
  zone_name: z.string().trim().max(60).nullish(),
});

/**
 * GET /api/spaces?facilityId=...&departmentId=... — list spaces (optionally scoped).
 * POST /api/spaces — create a space under a facility owned by the caller's org.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  const departmentId = searchParams.get("departmentId");

  let query = supabase
    .from("spaces")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (facilityId) query = query.eq("facility_id", facilityId);
  if (departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load spaces" }, { status: 500 });
  return NextResponse.json({ spaces: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSpaceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Authorization runs after parsing: the department this space lands in is
  // what decides the answer. Creating a space with no department is
  // owner/manager territory, which is what `can()` returns for a null here.
  const denied = requirePermission(
    membership,
    "space:write",
    parsed.data.department_id ?? null
  );
  if (denied) return denied;

  // Verify the facility belongs to the caller's own org — facility_id has no
  // DB-level org boundary check, so this must be enforced here.
  const { data: facility } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", parsed.data.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  if (parsed.data.department_id) {
    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", parsed.data.department_id)
      .eq("facility_id", parsed.data.facility_id)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  // Append rather than pile up at 0. Every space created before migration 054
  // took the column default, so eight lanes all sorted equal and Postgres
  // returned them in heap order — which is why lane order looked random and
  // changed after an edit. New rows now get a real position.
  const { data: lastPlaced } = await supabase
    .from("spaces")
    .select("display_order")
    .eq("org_id", membership.org_id)
    .eq("facility_id", parsed.data.facility_id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("spaces")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id,
      department_id: parsed.data.department_id ?? null,
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description ?? null,
      capacity: parsed.data.capacity ?? null,
      zone_name: parsed.data.zone_name || null,
      display_order: (lastPlaced?.display_order ?? 0) + 1,
      is_published: false,
    })
    .select("*")
    .single();

  if (error) {
    console.error("POST /api/spaces failed:", error);
    return NextResponse.json(
      { error: error.code === "23505" ? "A space with this name already exists at that facility." : "Could not create space." },
      { status: 500 }
    );
  }
  return NextResponse.json({ space: data }, { status: 201 });
}
