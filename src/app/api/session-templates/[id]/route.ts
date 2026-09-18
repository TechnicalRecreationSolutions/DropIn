import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { departmentOfTemplate } from "@/lib/auth/scope-lookup";
import {
  TemplateLinksSchema,
  replaceTemplateTags,
  replaceTemplateLinks,
} from "@/lib/sessions/templateRelations";

const UpdateSessionTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
  // Migration 050. Like the pair below, absence means "leave it alone" — only
  // an explicit null or "" clears a description.
  description: z.string().trim().max(2000).nullish(),
  tag_ids: z.array(z.string().uuid()).optional(),
  links: TemplateLinksSchema.optional(),
  default_duration_minutes: z.number().int().positive().optional(),
  // Migration 047. Optional with no default, so a PATCH that does not mention
  // them leaves the stored seeds alone — same presence contract POST
  // /api/sessions uses for the session-level pair.
  occupancy_kind: z.enum(["drop_in", "program", "rental", "closure"]).optional(),
  disclosure: z.enum(["public", "reserved", "internal"]).optional(),
  default_space_ids: z.array(z.string().uuid()).optional(),
  display_order: z.number().int().optional(),
});

/**
 * PATCH /api/session-templates/[id] — update a template's name/color/duration/default space.
 * DELETE /api/session-templates/[id] — archive a template (soft-delete via is_active=false),
 * so sessions already placed from it keep a meaningful "based on template" link.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const department = await departmentOfTemplate(supabase, id, membership.org_id);
  if (department === undefined) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  const denied = requirePermission(membership, "session-template:write", department);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSessionTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { default_space_ids, tag_ids, links, description, ...restFields } = parsed.data;

  const templateFields = {
    ...restFields,
    // Only touched when the caller actually sent the key — `nullish()` makes
    // undefined and null distinguishable, and they mean different things:
    // "don't change it" versus "clear it".
    ...(description !== undefined ? { description: description?.trim() || null } : {}),
    // Always present, and load-bearing beyond bookkeeping: a PATCH carrying
    // only `tag_ids` or only `links` leaves every other key undefined, and
    // `.update({})` matches no rows — so the route returned 404 "not found"
    // for a template that exists and then never wrote the tags either. The
    // edit form always posts every field, so this only ever surfaced through a
    // partial API call. Setting updated_at means the statement always has
    // something to write, and it is true regardless: the template did change.
    updated_at: new Date().toISOString(),
  };

  // Both the space check below and the tag check further down need the
  // template's facility, so it is fetched once for either. It also doubles as
  // the 404 for a template that is not the caller's.
  const needsFacility =
    (default_space_ids && default_space_ids.length > 0) || (tag_ids && tag_ids.length > 0);

  let templateFacilityId: string | null = null;
  if (needsFacility) {
    const { data: template } = await supabase
      .from("session_templates")
      .select("facility_id")
      .eq("id", id)
      .eq("org_id", membership.org_id)
      .maybeSingle();

    if (!template) return NextResponse.json({ error: "Session template not found" }, { status: 404 });
    templateFacilityId = template.facility_id;
  }

  if (default_space_ids && default_space_ids.length > 0) {
    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", default_space_ids)
      // Non-null here by construction: needsFacility is true whenever
      // default_space_ids is non-empty, and the fetch above returns or 404s.
      .eq("facility_id", templateFacilityId!);

    if ((validSpaces?.length ?? 0) !== default_space_ids.length) {
      return NextResponse.json({ error: "One or more spaces not found at this facility" }, { status: 404 });
    }
  }

  const { data, error } = await supabase
    .from("session_templates")
    .update(templateFields)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not update session template." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Session template not found" }, { status: 404 });

  if (default_space_ids !== undefined) {
    const { error: deleteSpacesError } = await supabase
      .from("session_template_spaces")
      .delete()
      .eq("session_template_id", id);

    if (deleteSpacesError) {
      return NextResponse.json({ error: "Could not update session template spaces." }, { status: 500 });
    }

    if (default_space_ids.length > 0) {
      const { error: insertSpacesError } = await supabase
        .from("session_template_spaces")
        .insert(
          default_space_ids.map((space_id) => ({
            session_template_id: id,
            space_id,
            org_id: membership.org_id,
          }))
        );

      if (insertSpacesError) {
        return NextResponse.json({ error: "Could not attach spaces to session template." }, { status: 500 });
      }
    }
  }

  if (tag_ids !== undefined) {
    // templateFacilityId is set whenever tag_ids is non-empty (see above); an
    // empty array only ever clears, so it needs no facility to validate against.
    const tagError = await replaceTemplateTags(supabase, {
      templateId: id,
      orgId: membership.org_id,
      facilityId: templateFacilityId ?? data.facility_id,
      tagIds: tag_ids,
    });
    if (tagError) return NextResponse.json({ error: tagError }, { status: 400 });
  }

  if (links !== undefined) {
    const linkError = await replaceTemplateLinks(supabase, {
      templateId: id,
      orgId: membership.org_id,
      links,
    });
    if (linkError) return NextResponse.json({ error: linkError }, { status: 400 });
  }

  return NextResponse.json({
    sessionTemplate: {
      ...data,
      default_space_ids: default_space_ids ?? [],
      ...(tag_ids !== undefined ? { tag_ids } : {}),
      ...(links !== undefined ? { links } : {}),
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const department = await departmentOfTemplate(supabase, id, membership.org_id);
  if (department === undefined) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  const denied = requirePermission(membership, "session-template:write", department);
  if (denied) return denied;

  const { error } = await supabase
    .from("session_templates")
    .update({ is_active: false })
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not archive session template" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
