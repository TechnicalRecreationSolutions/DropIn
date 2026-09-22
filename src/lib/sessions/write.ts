import { NextResponse } from "next/server";
import { z } from "zod";
import type { RouteMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { departmentOfSession } from "@/lib/auth/scope-lookup";
import { findSessionConflict } from "@/lib/sessions/conflicts";
import { fetchOperatingHours } from "@/lib/schedule/operating-hours-query";
import {
  hasAnyWindow,
  firstOpenDayFrom,
  widestWindowOfDay,
  minutesToTime,
} from "@/lib/schedule/operating-hours";
import type { SupabaseServerClient } from "@/lib/sessions/conflicts";

/**
 * The one place a `sessions` row is created or replaced.
 *
 * This was the body of `POST /api/sessions` and nothing about it changed when
 * it moved here — it was extracted because `POST /api/sessions/batch` needs the
 * identical behaviour for a pasted block, and a second copy of it would be a
 * second copy of the operating-hours snapshot rule, the template/space scoping
 * checks, the two "absent means leave it alone" contracts and the sidecar
 * handling. Those are exactly the rules that were each learned the hard way; a
 * duplicate would start correct and quietly stop being.
 *
 * Returns a `NextResponse` on failure rather than throwing, so both callers
 * forward the same status and the same human-readable reason.
 */

export const SessionSchema = z.object({
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
  // Migration 058, same presence contract as occupancy_kind above and for the
  // same reason: the reschedule/duplicate/move-space callers send a partial
  // payload, and a `.default(false)` here would quietly convert an all-day
  // session into a fixed-time one on any update that didn't mention it —
  // pinning it to the snapshot times it happened to be carrying.
  follows_operating_hours: z.boolean().optional(),
  // The staff-only sidecar's fields. Same presence contract: a key that isn't
  // sent is left alone, an empty string clears the stored value. Only
  // SessionForm sends these, because only it has the whole record in hand.
  holder_name: z.string().nullable().optional(),
  setup_notes: z.string().nullable().optional(),
  sessionId: z.string().uuid().optional(),
});

export type SessionWriteInput = z.infer<typeof SessionSchema>;

export type SessionWriteResult =
  | { ok: true; sessionId: string }
  | { ok: false; response: NextResponse };

export async function writeSession(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  input: SessionWriteInput
): Promise<SessionWriteResult> {
  const fail = (error: string, status: number): SessionWriteResult => ({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });

  const { sessionId, ...fields } = input;

  // Confirm the schedule belongs to this org
  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, facility_id, department_id")
    .eq("id", fields.schedule_group_id)
    .eq("org_id", membership.org_id)
    .single();

  if (!scheduleGroup) return fail("Schedule not found", 404);

  // This route had NO role check at all before migration 055 — org membership
  // alone was the gate, which was the documented intent when `member` meant
  // "read plus schedule editing". With `aux` in the ladder that same code
  // hands a lifeguard the power to rewrite the schedule, so the gate is now
  // the destination schedule's department.
  const denied = requirePermission(membership, "session:write", scheduleGroup.department_id);
  if (denied) return { ok: false, response: denied };

  // Moving an existing session between schedules needs authority over where it
  // is coming FROM as well, or a coordinator could pull another department's
  // session into their own — the destination check above would wave it through.
  if (sessionId) {
    const sourceDepartment = await departmentOfSession(supabase, sessionId, membership.org_id);
    if (sourceDepartment === undefined) return fail("Session not found", 404);
    const deniedSource = requirePermission(membership, "session:write", sourceDepartment);
    if (deniedSource) return { ok: false, response: deniedSource };
  }

  // Every space must belong to the same facility as the schedule it's attached to
  if (fields.space_ids.length > 0) {
    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", fields.space_ids)
      .eq("facility_id", scheduleGroup.facility_id);

    if ((validSpaces?.length ?? 0) !== fields.space_ids.length) {
      return fail("One or more spaces not found at this facility", 404);
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

    if (!usable) return fail("Session template not found", 404);
  }

  // Both occupancy_kind and follows_operating_hours use the "absent means
  // leave it alone" contract, so both have to be resolved against the stored
  // row before anything downstream can reason about them. An update that
  // doesn't mention occupancy_kind keeps the stored one — but the conflict
  // check still needs the real value, not the column default, or editing a
  // rental's times would 409 against the drop-in block it is allowed to
  // overlap. Same for the flag: checking an all-day session against its
  // snapshot times would compare the wrong hours entirely (migration 058).
  let effectiveKind = fields.occupancy_kind;
  let effectiveFollows = fields.follows_operating_hours;
  if ((!effectiveKind || effectiveFollows === undefined) && sessionId) {
    const { data: existing } = await supabase
      .from("sessions")
      .select("occupancy_kind, follows_operating_hours")
      .eq("id", sessionId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    effectiveKind ??= existing?.occupancy_kind;
    effectiveFollows ??= existing?.follows_operating_hours;
  }

  // Turning the flag ON requires something to follow (058). Rejected rather
  // than accepted-and-degraded: a session saved this way would render at its
  // snapshot times while the form said "all day", and the mismatch would only
  // surface on the public schedule.
  //
  // Only an EXPLICIT `true` is rejected. An inherited one — a partial update
  // to a session that already follows hours since deleted — still saves, and
  // lands in the documented fallback, which is recoverable; refusing it would
  // make a whole category of edits impossible until the hours came back.
  if (fields.follows_operating_hours === true && !scheduleGroup.department_id) {
    return fail("Only a schedule inside a department can follow operating hours.", 400);
  }

  // THE SNAPSHOT IS WRITTEN HERE, NOT IN THE FORM.
  //
  // `dtstart`/`dtend_time` are a following session's fallback when its hours
  // cannot be resolved (see migration 058 §2), so they have to be plausible
  // for EVERY caller — not just the one that happens to compute them client
  // side. SessionForm is only one of several writers: the command centre's
  // duplicate, the conflict manager's space move, the import committer and
  // now the canvas's paste all post here too, and each of them would
  // otherwise pin a fallback to whatever times it had in hand.
  //
  // Deriving it server-side from the same hours expansion will use makes the
  // invariant true by construction. The widest window of the start day is
  // used — earliest open to latest close, spanning any midday gap — because
  // these two columns can hold exactly one range.
  if (effectiveFollows === true && scheduleGroup.department_id) {
    const hours = await fetchOperatingHours(supabase, [scheduleGroup.department_id]);
    const departmentHours = hours.get(scheduleGroup.department_id);

    if (!departmentHours || !hasAnyWindow(departmentHours)) {
      // Same split as above: an explicit request to start following gets a
      // real error, an inherited one is left alone in the fallback.
      if (fields.follows_operating_hours === true) {
        return fail("This department has no operating hours set yet.", 400);
      }
    } else {
      // getUTCDay() on the "Z"-suffixed literal, never getDay() — valid_from
      // is wall-clock digits, and the runtime-local getter would pick the
      // wrong weekday's hours off UTC (src/lib/schedule/operating-hours.ts).
      // The recurring week, not the holiday overrides (059): the snapshot is
      // a stand-in for the session's ordinary hours, and pinning it to
      // whatever Christmas Day happens to be would make the fallback worse
      // than useless the one time it gets read.
      const startDay = new Date(`${fields.valid_from}T00:00:00Z`).getUTCDay();
      const day = Number.isNaN(startDay) ? null : firstOpenDayFrom(departmentHours.week, startDay);
      const widest = day === null ? null : widestWindowOfDay(departmentHours.week, day);
      if (widest) {
        fields.dtstart = `${fields.valid_from}T${minutesToTime(widest.opens)}:00Z`;
        fields.dtend_time = minutesToTime(widest.closes);
      }
    }
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
    followsOperatingHours: effectiveFollows === true,
    departmentId: scheduleGroup.department_id,
  });
  if (conflict) return fail(conflict.error, 409);

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
    if (error) return fail("Failed to update session.", 500);
    targetSessionId = sessionId;
  } else {
    const { data: session, error } = await table.insert(payload).select("id").single();
    if (error) return fail("Failed to create session.", 500);
    targetSessionId = session.id;
  }

  const { error: deleteSpacesError } = await supabase
    .from("session_spaces")
    .delete()
    .eq("session_id", targetSessionId);

  if (deleteSpacesError) return fail("Failed to update session spaces.", 500);

  if (space_ids.length > 0) {
    const { error: insertSpacesError } = await supabase
      .from("session_spaces")
      .insert(space_ids.map((space_id) => ({ session_id: targetSessionId, space_id, org_id: membership.org_id })));

    if (insertSpacesError) return fail("Failed to attach spaces to session.", 500);
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
      if (clearError) return fail("Failed to clear staff-only details.", 500);
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
      if (internalError) return fail("Failed to save staff-only details.", 500);
    }
  }

  return { ok: true, sessionId: targetSessionId };
}

// ---------------------------------------------------------------------------
// Partial updates
// ---------------------------------------------------------------------------

/** What a canvas gesture is allowed to change on an existing session. */
export interface SessionPatchFields {
  rrule?: string;
  /** "Z"-suffixed literal wall-clock, same convention as everywhere else. */
  dtstart?: string;
  dtend_time?: string;
  valid_from?: string;
  /** Replaces the whole set. Omitted leaves `session_spaces` untouched. */
  space_ids?: string[];
  /** Deletion is soft (migration 001), so undo is this field flipped back. */
  is_active?: boolean;
}

export type SessionPatchResult =
  | {
      ok: true;
      /**
       * The values these fields held before the write, in the shape of another
       * patch. Posting it back is an exact undo — which is why the canvas can
       * offer Undo instead of a confirmation dialog, and why the inverse is
       * computed HERE rather than guessed by the client from what it drew.
       */
      before: SessionPatchFields;
      /** 058: a following session has no time of its own, so times were dropped. */
      timesIgnored: boolean;
    }
  | { ok: false; response: NextResponse };

export async function patchSession(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  sessionId: string,
  fields: SessionPatchFields
): Promise<SessionPatchResult> {
  const fail = (error: string, status: number): SessionPatchResult => ({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });

  // Dragging a session to a new time is schedule editing, which before
  // migration 055 any org member could do — including, once the ladder gained
  // `aux`, a lifeguard. Gated on the session's own department now.
  const department = await departmentOfSession(supabase, sessionId, membership.org_id);
  if (department === undefined) return fail("Session not found", 404);
  const denied = requirePermission(membership, "session:write", department);
  if (denied) return { ok: false, response: denied };

  const { data: existing } = await supabase
    .from("sessions")
    .select(
      "rrule, dtstart, dtend_time, valid_from, valid_until, is_active, occupancy_kind, follows_operating_hours"
    )
    .eq("id", sessionId)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!existing) return fail("Session not found", 404);

  // A session that follows operating hours (058) has no time of its own to
  // drag. Moving it to another DAY is still meaningful, so the rrule change
  // is honoured and only the time components are discarded — the alternative,
  // writing them, would store times the grid does not render and leave the
  // drag looking like it silently failed.
  const timesIgnored =
    existing.follows_operating_hours && (fields.dtstart !== undefined || fields.dtend_time !== undefined);

  const writable: SessionPatchFields = timesIgnored
    ? { ...fields, dtstart: undefined, dtend_time: undefined }
    : { ...fields };

  const { data: spaceRows } = await supabase
    .from("session_spaces")
    .select("space_id")
    .eq("session_id", sessionId);
  const currentSpaceIds = (spaceRows ?? []).map((r) => r.space_id);

  const nextSpaceIds = writable.space_ids ?? currentSpaceIds;
  const nextActive = writable.is_active ?? existing.is_active;

  // Every space must still belong to the schedule's own facility — the canvas
  // can only offer columns from one facility, but the request is a request.
  if (writable.space_ids && writable.space_ids.length > 0) {
    const { data: group } = await supabase
      .from("sessions")
      .select("schedule_groups ( facility_id )")
      .eq("id", sessionId)
      .maybeSingle();
    const facilityId = (group as unknown as { schedule_groups?: { facility_id: string } } | null)
      ?.schedule_groups?.facility_id;
    if (!facilityId) return fail("Session not found", 404);

    const { data: validSpaces } = await supabase
      .from("spaces")
      .select("id")
      .in("id", writable.space_ids)
      .eq("facility_id", facilityId);
    if ((validSpaces?.length ?? 0) !== writable.space_ids.length) {
      return fail("One or more spaces not found at this facility", 404);
    }
  }

  // A deactivated session claims nothing, so it can never conflict. Checking
  // it anyway would make "delete" fail on the overlap it is about to resolve.
  if (nextActive) {
    const conflict = await findSessionConflict(supabase, {
      sessionId,
      rrule: writable.rrule ?? existing.rrule,
      dtstart: writable.dtstart ?? existing.dtstart,
      dtend_time: writable.dtend_time ?? existing.dtend_time,
      valid_from: writable.valid_from ?? existing.valid_from,
      valid_until: existing.valid_until,
      spaceIds: nextSpaceIds,
      // A drag can't change what kind of claim this is, but the conflict engine
      // needs it: dragging a rental onto a lane a drop-in block already lists is
      // exactly the move that must now be allowed (migration 046).
      occupancyKind: existing.occupancy_kind,
      // Checked against the department's real hours, not the snapshot — and on
      // the NEW rrule, which is the point: moving an all-day block to Saturday
      // has to be tested against Saturday's opening hours.
      followsOperatingHours: existing.follows_operating_hours,
      departmentId: department ?? null,
    });
    if (conflict) return fail(conflict.error, 409);
  }

  const { space_ids, ...columns } = writable;
  const hasColumnChange = Object.values(columns).some((v) => v !== undefined);

  if (hasColumnChange) {
    const { error } = await supabase
      .from("sessions")
      .update(columns)
      .eq("id", sessionId)
      .eq("org_id", membership.org_id);
    if (error) return fail("Failed to update session.", 500);
  }

  if (space_ids) {
    const { error: clearError } = await supabase
      .from("session_spaces")
      .delete()
      .eq("session_id", sessionId);
    if (clearError) return fail("Failed to update session spaces.", 500);

    if (space_ids.length > 0) {
      const { error: insertError } = await supabase
        .from("session_spaces")
        .insert(space_ids.map((sid) => ({ session_id: sessionId, space_id: sid, org_id: membership.org_id })));
      if (insertError) return fail("Failed to attach spaces to session.", 500);
    }
  }

  // Only the fields the caller actually touched go into the inverse. A patch
  // that carried every column would undo edits the gesture never made — most
  // obviously another staff member's, saved in between.
  //
  // Normalised on the way out, because an inverse exists to be POSTed back and
  // Postgres does not hand these two back in the shape the route accepts: a
  // `timestamptz` reads as `…+00:00` where the schema demands a "Z", and a
  // `time` reads as `HH:MM:SS` where it demands `HH:MM`. Undo was rejected as
  // invalid input until `verify-aw` §2 posted one.
  const before: SessionPatchFields = {};
  if (fields.rrule !== undefined) before.rrule = existing.rrule;
  if (fields.dtstart !== undefined) before.dtstart = toZulu(existing.dtstart);
  if (fields.dtend_time !== undefined) before.dtend_time = existing.dtend_time.slice(0, 5);
  if (fields.valid_from !== undefined) before.valid_from = existing.valid_from;
  if (fields.space_ids !== undefined) before.space_ids = currentSpaceIds;
  if (fields.is_active !== undefined) before.is_active = existing.is_active;

  return { ok: true, before, timesIgnored };
}

/**
 * A stored `dtstart` in the literal-wall-clock form the write routes accept.
 *
 * The digits are copied, never converted — `dtstart` has no instant meaning
 * (docs/RESUME-timezone-removal.md), so running it through a Date here would
 * reintroduce exactly the shift that removal existed to end. All this does is
 * swap the `+00:00` Postgres prints for the `Z` zod requires.
 */
function toZulu(stored: string): string {
  return `${stored.slice(0, 19)}Z`;
}
