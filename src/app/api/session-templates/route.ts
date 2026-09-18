import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import {
  TemplateLinksSchema,
  replaceTemplateTags,
  replaceTemplateLinks,
} from "@/lib/sessions/templateRelations";

const CreateSessionTemplateSchema = z.object({
  facility_id: z.string().uuid(),
  // Null/omitted means facility-wide — reusable by every schedule in the
  // facility, not just one department. Mirrors spaces.department_id.
  department_id: z.string().uuid().nullish(),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
  // Migration 050. Shown in the public session detail modal; plain text only.
  description: z.string().trim().max(2000).nullish(),
  // Tags must already exist in the facility's vocabulary — this route assigns,
  // it never creates. POST /api/tags is how a word enters the vocabulary, and
  // keeping the two apart is what stops a typo in a template form from
  // silently minting "Womens only" beside "Women's Only".
  tag_ids: z.array(z.string().uuid()).optional().default([]),
  links: TemplateLinksSchema.optional().default([]),
  default_duration_minutes: z.number().int().positive(),
  // Seed values for sessions placed from this template (migration 047).
  occupancy_kind: z.enum(["drop_in", "program", "rental", "closure"]).optional(),
  disclosure: z.enum(["public", "reserved", "internal"]).optional(),
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


  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSessionTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // After parsing: the department the template belongs to decides the answer.
  // A facility-wide template (department_id null — see the schema's note) is
  // owner/manager territory, which is what a null yields here.
  const denied = requirePermission(
    membership,
    "session-template:write",
    parsed.data.department_id ?? null
  );
  if (denied) return denied;

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
      // Empty string is stored as NULL: "no description" has one
      // representation, so the modal's `{description && ...}` guard cannot be
      // defeated by a field someone cleared rather than never filled in.
      description: parsed.data.description?.trim() || null,
      default_duration_minutes: parsed.data.default_duration_minutes,
      occupancy_kind: parsed.data.occupancy_kind ?? "drop_in",
      disclosure: parsed.data.disclosure ?? "public",
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

  const tagError = await replaceTemplateTags(supabase, {
    templateId: data.id,
    orgId: membership.org_id,
    facilityId: parsed.data.facility_id,
    tagIds: parsed.data.tag_ids,
  });
  if (tagError) return NextResponse.json({ error: tagError }, { status: 400 });

  const linkError = await replaceTemplateLinks(supabase, {
    templateId: data.id,
    orgId: membership.org_id,
    links: parsed.data.links,
  });
  if (linkError) return NextResponse.json({ error: linkError }, { status: 400 });

  return NextResponse.json(
    {
      sessionTemplate: {
        ...data,
        default_space_ids: parsed.data.default_space_ids,
        tag_ids: parsed.data.tag_ids,
        links: parsed.data.links,
      },
    },
    { status: 201 }
  );
}
