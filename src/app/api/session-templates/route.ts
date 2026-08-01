import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CreateSessionTemplateSchema = z.object({
  schedule_group_id: z.string().uuid(),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
  default_duration_minutes: z.number().int().positive(),
  default_space_ids: z.array(z.string().uuid()).optional().default([]),
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
 * GET /api/session-templates?scheduleGroupId=... — list templates for a schedule group.
 * POST /api/session-templates — create a template under a schedule group owned by the caller's org.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scheduleGroupId = searchParams.get("scheduleGroupId");

  let query = supabase
    .from("session_templates")
    .select("*")
    .eq("org_id", membership.org_id)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (scheduleGroupId) query = query.eq("schedule_group_id", scheduleGroupId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load session templates" }, { status: 500 });
  return NextResponse.json({ sessionTemplates: data ?? [] });
}

export async function POST(request: Request) {
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

  const parsed = CreateSessionTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Verify the schedule group belongs to the caller's own org.
  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, facility_id")
    .eq("id", parsed.data.schedule_group_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!scheduleGroup) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // Every default space must belong to the same facility as the schedule group.
  if (parsed.data.default_space_ids.length > 0) {
    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", parsed.data.default_space_ids)
      .eq("facility_id", scheduleGroup.facility_id);

    if ((validSpaces?.length ?? 0) !== parsed.data.default_space_ids.length) {
      return NextResponse.json({ error: "One or more spaces not found at this facility" }, { status: 404 });
    }
  }

  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      org_id: membership.org_id,
      schedule_group_id: parsed.data.schedule_group_id,
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
