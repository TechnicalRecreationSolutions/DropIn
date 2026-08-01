import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const UpdateSessionTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
  default_duration_minutes: z.number().int().positive().optional(),
  default_space_ids: z.array(z.string().uuid()).optional(),
  display_order: z.number().int().optional(),
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
 * PATCH /api/session-templates/[id] — update a template's name/color/duration/default space.
 * DELETE /api/session-templates/[id] — archive a template (soft-delete via is_active=false),
 * so sessions already placed from it keep a meaningful "based on template" link.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getMembership(supabase);
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

  const parsed = UpdateSessionTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { default_space_ids, ...templateFields } = parsed.data;

  if (default_space_ids && default_space_ids.length > 0) {
    const { data: template } = await supabase
      .from("session_templates")
      .select("schedule_group_id")
      .eq("id", id)
      .eq("org_id", membership.org_id)
      .maybeSingle();

    if (!template) return NextResponse.json({ error: "Session template not found" }, { status: 404 });

    const { data: scheduleGroup } = await supabase
      .from("schedule_groups")
      .select("facility_id")
      .eq("id", template.schedule_group_id)
      .maybeSingle();

    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", default_space_ids)
      .eq("facility_id", scheduleGroup?.facility_id ?? "");

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

  return NextResponse.json({ sessionTemplate: { ...data, default_space_ids: default_space_ids ?? [] } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage session templates" }, { status: 403 });
  }

  const { error } = await supabase
    .from("session_templates")
    .update({ is_active: false })
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not archive session template" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
