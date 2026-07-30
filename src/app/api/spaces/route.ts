import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";

const CreateSpaceSchema = z.object({
  facility_id: z.string().uuid(),
  department_id: z.string().uuid().nullish(),
  name: z.string().min(1),
  description: z.string().nullish(),
  capacity: z.number().int().positive().nullish(),
});

async function getMembership(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  return membership;
}

/**
 * GET /api/spaces?facilityId=...&departmentId=... — list spaces (optionally scoped).
 * POST /api/spaces — create a space under a facility owned by the caller's org.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  const departmentId = searchParams.get("departmentId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("spaces")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true });

  if (facilityId) query = query.eq("facility_id", facilityId);
  if (departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load spaces" }, { status: 500 });
  return NextResponse.json({ spaces: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage spaces" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSpaceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Verify the facility belongs to the caller's own org — facility_id has no
  // DB-level org boundary check, so this must be enforced here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: facility } = await (supabase as any)
    .from("facilities")
    .select("id")
    .eq("id", parsed.data.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  if (parsed.data.department_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: department } = await (supabase as any)
      .from("departments")
      .select("id")
      .eq("id", parsed.data.department_id)
      .eq("facility_id", parsed.data.facility_id)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("spaces")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id,
      department_id: parsed.data.department_id ?? null,
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description ?? null,
      capacity: parsed.data.capacity ?? null,
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
