import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";

const SessionSchema = z.object({
  schedule_group_id: z.string().uuid(),
  rrule: z.string().min(1),
  dtstart: z.string().datetime({ offset: true }),
  dtend_time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default("America/Edmonton"),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  space_ids: z.array(z.string().uuid()).optional().default([]),
  location_detail: z.string().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  season_id: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().optional(),
});

/** POST /api/sessions — create or update a recurring session */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { sessionId, ...fields } = parsed.data;

  // Verify org membership and that program belongs to user's org
  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  // Confirm the schedule belongs to this org
  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, facility_id")
    .eq("id", fields.schedule_group_id)
    .eq("org_id", membership.org_id)
    .single();

  if (!scheduleGroup) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // Every space must belong to the same facility as the schedule it's attached to
  if (fields.space_ids.length > 0) {
    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", fields.space_ids)
      .eq("facility_id", scheduleGroup.facility_id);

    if ((validSpaces?.length ?? 0) !== fields.space_ids.length) {
      return NextResponse.json({ error: "One or more spaces not found at this facility" }, { status: 404 });
    }
  }

  // A template must belong to the same schedule group the session is being placed under —
  // templates are scoped to one schedule group, not shared org-wide.
  if (fields.template_id) {
    const { data: template } = await supabase
      .from("session_templates")
      .select("id")
      .eq("id", fields.template_id)
      .eq("schedule_group_id", fields.schedule_group_id)
      .single();

    if (!template) return NextResponse.json({ error: "Session template not found" }, { status: 404 });
  }

  // Seasons are org-level, so the only boundary to enforce is that the season
  // belongs to the caller's own org (migration 027 leaves this to the route
  // layer, as with facility/department ownership elsewhere in this directory).
  if (fields.season_id) {
    const { data: season } = await supabase
      .from("seasons")
      .select("id")
      .eq("id", fields.season_id)
      .eq("org_id", membership.org_id)
      .maybeSingle();

    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  }

  const { space_ids, ...sessionFields } = fields;
  const payload = {
    ...sessionFields,
    org_id: membership.org_id,
    source: "manual" as const,
    is_active: true,
  };

  const table = supabase.from("sessions");

  let targetSessionId: string;

  if (sessionId) {
    const { error } = await table.update(payload).eq("id", sessionId).eq("org_id", membership.org_id);
    if (error) return NextResponse.json({ error: "Failed to update session." }, { status: 500 });
    targetSessionId = sessionId;
  } else {
    const { data: session, error } = await table.insert(payload).select("id").single();
    if (error) return NextResponse.json({ error: "Failed to create session." }, { status: 500 });
    targetSessionId = session.id;
  }

  const { error: deleteSpacesError } = await supabase
    .from("session_spaces")
    .delete()
    .eq("session_id", targetSessionId);

  if (deleteSpacesError) {
    return NextResponse.json({ error: "Failed to update session spaces." }, { status: 500 });
  }

  if (space_ids.length > 0) {
    const { error: insertSpacesError } = await supabase
      .from("session_spaces")
      .insert(space_ids.map((space_id) => ({ session_id: targetSessionId, space_id, org_id: membership.org_id })));

    if (insertSpacesError) {
      return NextResponse.json({ error: "Failed to attach spaces to session." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, sessionId: targetSessionId });
}

/** DELETE /api/sessions?sessionId=uuid — deactivate a session */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { error } = await supabase
    .from("sessions")
    .update({ is_active: false })
    .eq("id", sessionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete session." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
