import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";

const CreateDepartmentSchema = z.object({
  facility_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullish(),
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
 * GET /api/departments?facilityId=... — list departments (optionally scoped to a facility).
 * POST /api/departments — create a department under a facility owned by the caller's org.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const facilityId = new URL(request.url).searchParams.get("facilityId");

  let query = supabase
    .from("departments")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true });

  if (facilityId) query = query.eq("facility_id", facilityId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load departments" }, { status: 500 });
  return NextResponse.json({ departments: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage departments" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateDepartmentSchema.safeParse(body);
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

  const { data, error } = await supabase
    .from("departments")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id,
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description ?? null,
      is_published: false,
    })
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not create department" }, { status: 500 });
  return NextResponse.json({ department: data }, { status: 201 });
}
