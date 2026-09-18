import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { departmentOfSession } from "@/lib/auth/scope-lookup";
import { findSessionConflict } from "@/lib/sessions/conflicts";

const SessionSchema = z.object({
  schedule_group_id: z.string().uuid(),
  rrule: z.string().min(1),
  // Must be "Z"-suffixed, not an arbitrary offset — dtstart's digits are the
  // literal local wall-clock time, never a real instant to be converted
  // (see dropin/docs/RESUME-timezone-removal.md). zod's datetime() without
  // `offset: true` requires exactly that.
  dtstart: z.string().datetime(),
  dtend_time: z.string().regex(/^\d{2}:\d{2}$/),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  space_ids: z.array(z.string().uuid()).optional().default([]),
  location_detail: z.string().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  // Occupancy + disclosure (migration 046). Deliberately WITHOUT zod
  // `.default()`, unlike space_ids above: several callers send a partial
  // payload through this route — the conflict manager's "move to another
  // space" and the command centre's reschedule/duplicate — and a default here
  // would put the field in `payload` on every request, silently resetting a
  // rental to a public drop-in on any update that didn't mention it. Absent
  // means "leave whatever is there"; the column defaults cover inserts.
  occupancy_kind: z.enum(["drop_in", "program", "rental", "closure"]).optional(),
  disclosure: z.enum(["public", "reserved", "internal"]).optional(),
  // The staff-only sidecar's fields. Same presence contract: a key that isn't
  // sent is left alone, an empty string clears the stored value. Only
  // SessionForm sends these, because only it has the whole record in hand.
  holder_name: z.string().nullable().optional(),
  setup_notes: z.string().nullable().optional(),
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
    .select("id, facility_id, department_id")
    .eq("id", fields.schedule_group_id)
    .eq("org_id", membership.org_id)
    .single();

  if (!scheduleGroup) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // This route had NO role check at all before migration 055 — org membership
  // alone was the gate, which was the documented intent when `member` meant
  // "read plus schedule editing". With `aux` in the ladder that same code
  // hands a lifeguard the power to rewrite the schedule, so the gate is now
  // the destination schedule's department.
  const denied = requirePermission(membership, "session:write", scheduleGroup.department_id);
  if (denied) return denied;

  // Moving an existing session between schedules needs authority over where it
  // is coming FROM as well, or a coordinator could pull another department's
  // session into their own — the destination check above would wave it through.
  if (sessionId) {
    const sourceDepartment = await departmentOfSession(supabase, sessionId, membership.org_id);
    if (sourceDepartment === undefined) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const deniedSource = requirePermission(membership, "session:write", sourceDepartment);
    if (deniedSource) return deniedSource;
  }

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

  // A template must belong to the same facility as the schedule it's being
  // placed under, and either be facility-wide (department_id null) or match
  // the schedule's own department — templates are scoped per department (or
  // shared facility-wide), not per schedule.
  if (fields.template_id) {
    const { data: template } = await supabase
      .from("session_templates")
      .select("id, department_id")
      .eq("id", fields.template_id)
      .eq("facility_id", scheduleGroup.facility_id)
      .single();

    const usable =
      !!template && (template.department_id === null || template.department_id === scheduleGroup.department_id);

    if (!usable) return NextResponse.json({ error: "Session template not found" }, { status: 404 });
  }

  // An update that doesn't mention occupancy_kind keeps the stored one (see
  // the schema note) — but the conflict check still has to reason with the
  // real value, not the column default, or editing a rental's times would
  // 409 against the drop-in block it is allowed to overlap.
  let effectiveKind = fields.occupancy_kind;
  if (!effectiveKind && sessionId) {
    const { data: existing } = await supabase
      .from("sessions")
      .select("occupancy_kind")
      .eq("id", sessionId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    effectiveKind = existing?.occupancy_kind;
  }

  const conflict = await findSessionConflict(supabase, {
    sessionId: sessionId ?? null,
    rrule: fields.rrule,
    dtstart: fields.dtstart,
    dtend_time: fields.dtend_time,
    valid_from: fields.valid_from,
    valid_until: fields.valid_until ?? null,
    spaceIds: fields.space_ids,
    occupancyKind: effectiveKind,
  });
  if (conflict) return NextResponse.json({ error: conflict.error }, { status: 409 });

  // holder_name/setup_notes belong to session_internal, not to `sessions` —
  // keeping the renter's name off this table is the whole point of the sidecar
  // (migration 046, decision 4), so they must not reach the payload below.
  const { space_ids, holder_name, setup_notes, ...sessionFields } = fields;
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

  // The staff-only sidecar. Touched only when the caller actually sent one of
  // its fields: a partial payload (reschedule, duplicate, the conflict
  // manager's space move) must leave an existing holder name alone rather than
  // blank it. An explicitly empty string clears the value, which is how staff
  // remove a name they typed by mistake.
  if (holder_name !== undefined || setup_notes !== undefined) {
    const holder = holder_name?.trim() || null;
    const notes = setup_notes?.trim() || null;

    if (holder === null && notes === null) {
      // Nothing left worth a row. Deleting rather than storing two NULLs keeps
      // "has internal detail" answerable by the row's existence.
      const { error: clearError } = await supabase
        .from("session_internal")
        .delete()
        .eq("session_id", targetSessionId);
      if (clearError) {
        return NextResponse.json({ error: "Failed to clear staff-only details." }, { status: 500 });
      }
    } else {
      const { error: internalError } = await supabase
        .from("session_internal")
        .upsert(
          {
            session_id: targetSessionId,
            org_id: membership.org_id,
            holder_name: holder,
            setup_notes: notes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "session_id" }
        );
      if (internalError) {
        return NextResponse.json({ error: "Failed to save staff-only details." }, { status: 500 });
      }
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

  const department = await departmentOfSession(supabase, sessionId, membership.org_id);
  if (department === undefined) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const denied = requirePermission(membership, "session:write", department);
  if (denied) return denied;

  const { error } = await supabase
    .from("sessions")
    .update({ is_active: false })
    .eq("id", sessionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete session." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
