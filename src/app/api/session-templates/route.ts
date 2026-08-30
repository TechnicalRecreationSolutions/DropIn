import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const CreateSessionTemplateSchema = z.object({
  facility_id: z.string().uuid(),
  // Null/omitted means facility-wide — reusable by every schedule in the
  // facility, not just one department. Mirrors spaces.department_id.
  department_id: z.string().uuid().nullish(),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
  default_duration_minutes: z.number().int().positive(),
  default_space_ids: z.array(z.string().uuid()).optional().default([]),
});

/**
 * GET /api/session-templates?facilityId=...&departmentId=... — list templates for a facility (optionally narrowed to a department).
 * POST /api/session-templates — create a template under a facility (optionally scoped to a department) owned by the caller's org.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  const departmentId = searchParams.get("departmentId");

  let query = supabase
    .from("session_templates")
    .select("*")
    .eq("org_id", membership.org_id)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (facilityId) query = query.eq("facility_id", facilityId);
  if (departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load session templates" }, { status: 500 });
  return NextResponse.json({ sessionTemplates: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage session templates" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSessionTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Verify the facility belongs to the caller's own org.
  const { data: facility } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", parsed.data.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  // The department, if given, must belong to that same facility.
  if (parsed.data.department_id) {
    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", parsed.data.department_id)
      .eq("facility_id", parsed.data.facility_id)
      .eq("org_id", membership.org_id)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  // Every default space must belong to the same facility as the template.
  if (parsed.data.default_space_ids.length > 0) {
    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", parsed.data.default_space_ids)
      .eq("facility_id", parsed.data.facility_id);

    if ((validSpaces?.length ?? 0) !== parsed.data.default_space_ids.length) {
      return NextResponse.json({ error: "One or more spaces not found at this facility" }, { status: 404 });
    }
  }

  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      org_id: membership.org_id,
      facility_id: parsed.data.facility_id,
      department_id: parsed.data.department_id ?? null,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
      default_duration_minutes: parsed.data.default_duration_minutes,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) {
    console.error("POST /api/session-templates failed:", error);
    return NextResponse.json({ error: "Could not create session template." }, { status: 500 });
  }

  if (parsed.data.default_space_ids.length > 0) {
    const { error: insertSpacesError } = await supabase
      .from("session_template_spaces")
      .insert(
        parsed.data.default_space_ids.map((space_id) => ({
          session_template_id: data.id,
          space_id,
          org_id: membership.org_id,
        }))
      );

    if (insertSpacesError) {
      console.error("POST /api/session-templates space insert failed:", insertSpacesError);
      return NextResponse.json({ error: "Could not attach spaces to session template." }, { status: 500 });
    }
  }

  return NextResponse.json({ sessionTemplate: { ...data, default_space_ids: parsed.data.default_space_ids } }, { status: 201 });
}
