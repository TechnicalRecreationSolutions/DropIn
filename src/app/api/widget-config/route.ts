import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_CONFIG = {
  primary_color: "#0066CC",
  secondary_color: "#FFFFFF",
  font_family: "Inter",
  show_cost: true,
  show_location: true,
  show_age_group: true,
  time_range_start: "06:00",
  time_range_end: "22:00",
  program_ids: null as string[] | null,
  custom_title: null as string | null,
  allowed_templates: ["grid", "list", "map"] as ("grid" | "list" | "map" | "floorplan")[],
};

const UpdateConfigSchema = z.object({
  facilityId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
  allowedTemplates: z.array(z.enum(["grid", "list", "map", "floorplan"])).min(1).optional(),
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  customTitle: z.string().nullable().optional(),
});

/**
 * GET /api/widget-config?orgId=...&facilityId=...&departmentId=...
 *
 * Public — no auth required, mirrors the widget_configs_public_read RLS
 * policy. Returns the config scoped to the given facility+department
 * combination (both optional; omitted = org-wide default row), or defaults
 * if that specific scope hasn't been customized yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const facilityId = url.searchParams.get("facilityId");
  const departmentId = url.searchParams.get("departmentId");
  if (!orgId) return NextResponse.json({ error: "Missing orgId" }, { status: 400 });

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any).from("widget_configs").select("*").eq("org_id", orgId);
  query = facilityId ? query.eq("facility_id", facilityId) : query.is("facility_id", null);
  query = departmentId ? query.eq("department_id", departmentId) : query.is("department_id", null);

  const { data } = await query.maybeSingle();

  return NextResponse.json({
    config: data ?? {
      org_id: orgId,
      facility_id: facilityId ?? null,
      department_id: departmentId ?? null,
      ...DEFAULT_CONFIG,
    },
  });
}

/**
 * PATCH /api/widget-config
 *
 * Saves the authenticated org's widget appearance settings for a given
 * facility+department scope (both optional — omitted saves the org-wide
 * default config). Scoped to allowed_templates/primary_color/
 * secondary_color/custom_title for now — font_family, show_cost,
 * show_location, show_age_group, time_range_start, time_range_end, and
 * program_ids remain unwired. org_id is always derived server-side, never
 * trusted from the request body.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string; role: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage the widget" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { facilityId, departmentId, allowedTemplates, primaryColor, secondaryColor, customTitle } = parsed.data;

  // Verify facility/department belong to the caller's own org before scoping a config to them.
  if (facilityId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: facility } = await (supabase as any)
      .from("facilities")
      .select("id")
      .eq("id", facilityId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  if (departmentId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: department } = await (supabase as any)
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  const fields: Record<string, unknown> = {};
  if (allowedTemplates !== undefined) fields.allowed_templates = allowedTemplates;
  if (primaryColor !== undefined) fields.primary_color = primaryColor;
  if (secondaryColor !== undefined) fields.secondary_color = secondaryColor;
  if (customTitle !== undefined) fields.custom_title = customTitle;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("widget_configs")
    .upsert(
      {
        org_id: membership.org_id,
        facility_id: facilityId ?? null,
        department_id: departmentId ?? null,
        ...fields,
      },
      { onConflict: "org_id,facility_id,department_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not save widget config" }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}
