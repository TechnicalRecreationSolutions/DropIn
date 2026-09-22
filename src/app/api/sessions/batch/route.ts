import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership, type RouteMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { departmentOfSession } from "@/lib/auth/scope-lookup";
import { writeSession, patchSession, type SessionPatchFields } from "@/lib/sessions/write";
import type { SupabaseServerClient } from "@/lib/sessions/conflicts";
import { buildRRuleString } from "@/lib/rrule/validate";
import {
  DAY_CODES,
  moveDay,
  moveSpace,
  moveSpan,
  buildDtstart,
  shiftDateString,
} from "@/lib/schedule/gridEdits";
import { timeStringToMinutes } from "@/lib/schedule/weekGeometry";
import type { Database } from "@/types/database.types";

/**
 * POST /api/sessions/batch — apply a list of schedule edits as one action, and
 * hand back the list that undoes it.
 *
 * ## Why this exists at all
 *
 * The canvas writes immediately instead of confirming (see
 * `components/schedule/editing/README.md`). That trade only works if two
 * things are true, and neither is true of firing N ordinary requests:
 *
 * 1. **One gesture is one action.** Pasting a block across eight lanes must
 *    either land or not. Eight independent POSTs can leave five lanes changed
 *    and three not, with no name for what just happened and nothing to press
 *    Undo on.
 * 2. **The undo has to be exact.** The inverse is computed from the rows as
 *    they were *at the moment of the write*, server-side, and returned to the
 *    caller. A client that reconstructs "what it must have been" from what it
 *    drew will be wrong the first time two people edit the same week — and it
 *    will be wrong silently, by writing a stale value back over a colleague's.
 *
 * ## It is not a transaction, and does not pretend to be
 *
 * PostgREST gives no cross-statement transaction, so an op that fails part-way
 * through a batch is followed by replaying the inverses of the ops that already
 * landed, newest first. That is a compensating rollback, not an atomic one: it
 * can itself fail (a conflict opened up in between), and when it does the
 * response says so rather than claiming a clean abort. The alternative — a
 * Postgres function owning all of this — would move the permission and conflict
 * rules into SQL, away from `writeSession`/`patchSession`, which is the exact
 * duplication those two were extracted to prevent.
 */

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DayCode = z.enum(DAY_CODES as [string, ...string[]]);

/** A block dragged to another lane, day and/or time. */
const MoveOp = z.object({
  kind: z.literal("move"),
  sessionId: z.string().uuid(),
  /**
   * The day of the *block that was dragged* — the column it was rendered
   * under, not the series' first day. Required, because a Mon/Wed/Fri series
   * has three blocks and only this says which one moved. See gridEdits.ts.
   */
  fromDayCode: DayCode,
  toDayCode: DayCode.optional(),
  /** Null for a block in the free-text or "General" column, which owns no space. */
  fromSpaceId: z.string().uuid().nullable().optional(),
  toSpaceId: z.string().uuid().optional(),
  startTime: z.string().regex(HHMM).optional(),
});

/** One edge of a block dragged. Send both when a gesture changed both. */
const ResizeOp = z.object({
  kind: z.literal("resize"),
  sessionId: z.string().uuid(),
  startTime: z.string().regex(HHMM).optional(),
  endTime: z.string().regex(HHMM).optional(),
});

/** The raw primitive. Mostly what an undo posts back, but usable directly. */
const PatchOp = z.object({
  kind: z.literal("patch"),
  sessionId: z.string().uuid(),
  rrule: z.string().min(1).optional(),
  dtstart: z.string().datetime().optional(),
  dtendTime: z.string().regex(HHMM).optional(),
  validFrom: z.string().regex(YMD).optional(),
  spaceIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
});

const DeleteOp = z.object({
  kind: z.literal("delete"),
  sessionId: z.string().uuid(),
});

/**
 * Undo of a create. A real DELETE rather than `is_active = false`, because the
 * row was made moments ago inside this same batch and leaving a soft-deleted
 * shell behind would turn every undone paste into permanent litter that still
 * shows up in exports and counts.
 */
const PurgeOp = z.object({
  kind: z.literal("purge"),
  sessionId: z.string().uuid(),
});

const CreateOp = z.object({
  kind: z.literal("create"),
  scheduleGroupId: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),
  /** Empty with `once: true`; the date then comes from validFrom. */
  dayCodes: z.array(DayCode).default([]),
  once: z.boolean().optional(),
  startTime: z.string().regex(HHMM),
  endTime: z.string().regex(HHMM),
  spaceIds: z.array(z.string().uuid()).default([]),
  validFrom: z.string().regex(YMD),
  validUntil: z.string().regex(YMD).nullable().optional(),
  locationDetail: z.string().nullable().optional(),
  occupancyKind: z.enum(["drop_in", "program", "rental", "closure"]).optional(),
  disclosure: z.enum(["public", "reserved", "internal"]).optional(),
});

/**
 * One date of one series, overridden without touching the RRULE — what an
 * Alt-drag writes. Date-scoped, unlike `POST /api/sessions/[id]/exceptions`,
 * which covers every occurrence in a week: Alt-dragging the Wednesday block
 * must not also retime Monday's.
 */
const OccurrenceOp = z.object({
  kind: z.literal("occurrence"),
  sessionId: z.string().uuid(),
  date: z.string().regex(YMD),
  action: z.enum(["modify", "cancel", "clear"]),
  startTime: z.string().regex(HHMM).optional(),
  endTime: z.string().regex(HHMM).optional(),
  note: z.string().max(500).nullish(),
});

const Op = z.discriminatedUnion("kind", [
  MoveOp,
  ResizeOp,
  PatchOp,
  DeleteOp,
  PurgeOp,
  CreateOp,
  OccurrenceOp,
]);

type OpInput = z.infer<typeof Op>;

/**
 * A ceiling rather than a limit anyone should reach. The widest real gesture
 * is "paste across every lane in the building", and no facility in the data
 * has close to this many spaces — so a request over it is a bug or an abuse,
 * not a power user.
 */
const MAX_OPS = 100;

const BatchSchema = z.object({
  ops: z.array(Op).min(1).max(MAX_OPS),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const applied: OpInput[] = [];
  const results: { sessionId: string }[] = [];
  /** Built newest-first, so posting it back replays in the right order. */
  const inverse: OpInput[] = [];
  let timesIgnored = false;

  for (const op of parsed.data.ops) {
    const outcome = await applyOp(supabase, membership, op);

    if (!outcome.ok) {
      const rolledBack = await rollback(supabase, membership, inverse);
      const detail = await readError(outcome.response);
      return NextResponse.json(
        {
          error: detail.error,
          // Named so the client can say "nothing changed" with authority
          // instead of guessing, and so a half-applied batch is visible rather
          // than reported as a clean failure.
          rolledBack,
          appliedBeforeFailure: applied.length,
        },
        { status: detail.status }
      );
    }

    applied.push(op);
    if (outcome.sessionId) results.push({ sessionId: outcome.sessionId });
    if (outcome.timesIgnored) timesIgnored = true;
    inverse.unshift(...outcome.inverse);
  }

  return NextResponse.json({ ok: true, results, inverse, timesIgnored });
}

// ---------------------------------------------------------------------------

type OpOutcome =
  | { ok: true; inverse: OpInput[]; sessionId?: string; timesIgnored?: boolean }
  | { ok: false; response: NextResponse };

async function applyOp(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  op: OpInput
): Promise<OpOutcome> {
  switch (op.kind) {
    case "move":
      return applyMove(supabase, membership, op);
    case "resize":
      return applyResize(supabase, membership, op);
    case "patch":
      return applyPatch(supabase, membership, op.sessionId, toPatchFields(op));
    case "delete":
      return applyPatch(supabase, membership, op.sessionId, { is_active: false });
    case "purge":
      return applyPurge(supabase, membership, op);
    case "create":
      return applyCreate(supabase, membership, op);
    case "occurrence":
      return applyOccurrence(supabase, membership, op);
  }
}

function toPatchFields(op: z.infer<typeof PatchOp>): SessionPatchFields {
  return {
    rrule: op.rrule,
    dtstart: op.dtstart,
    dtend_time: op.dtendTime,
    valid_from: op.validFrom,
    space_ids: op.spaceIds,
    is_active: op.isActive,
  };
}

function fromPatchFields(sessionId: string, before: SessionPatchFields): OpInput {
  return {
    kind: "patch",
    sessionId,
    rrule: before.rrule,
    dtstart: before.dtstart,
    dtendTime: before.dtend_time,
    validFrom: before.valid_from,
    spaceIds: before.space_ids,
    isActive: before.is_active,
  };
}

async function applyPatch(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  sessionId: string,
  fields: SessionPatchFields
): Promise<OpOutcome> {
  const result = await patchSession(supabase, membership, sessionId, fields);
  if (!result.ok) return { ok: false, response: result.response };
  return {
    ok: true,
    sessionId,
    timesIgnored: result.timesIgnored,
    inverse: [fromPatchFields(sessionId, result.before)],
  };
}

async function applyMove(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  op: z.infer<typeof MoveOp>
): Promise<OpOutcome> {
  const fail = (error: string, status = 400): OpOutcome => ({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });

  const { data: existing } = await supabase
    .from("sessions")
    .select("rrule, dtstart, dtend_time, valid_from")
    .eq("id", op.sessionId)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!existing) return fail("Session not found", 404);

  const fields: SessionPatchFields = {};

  // --- day -----------------------------------------------------------------
  // Resolved before the time, because a one-off moves by shifting its date,
  // and the date is half of the dtstart the time change then rewrites.
  let dateForDtstart = existing.dtstart.slice(0, 10);

  if (op.toDayCode && op.toDayCode !== op.fromDayCode) {
    const moved = moveDay(existing.rrule, op.fromDayCode, op.toDayCode);
    if (moved.kind === "refused") return fail(moved.reason);
    if (moved.kind === "byday") {
      fields.rrule = moved.rrule;
    } else {
      dateForDtstart = shiftDateString(dateForDtstart, moved.dayOffset);
      fields.dtstart = buildDtstart(dateForDtstart, existing.dtstart.slice(11, 16));
      fields.valid_from = shiftDateString(existing.valid_from, moved.dayOffset);
    }
  }

  // --- time ----------------------------------------------------------------
  if (op.startTime) {
    const span = moveSpan(
      { startTime: existing.dtstart.slice(11, 16), endTime: existing.dtend_time.slice(0, 5) },
      timeStringToMinutes(op.startTime)
    );
    if (!span) return fail("That would push the session past midnight.");
    fields.dtstart = buildDtstart(dateForDtstart, span.startTime);
    fields.dtend_time = span.endTime;
  }

  // --- space ---------------------------------------------------------------
  if (op.toSpaceId) {
    const { data: spaceRows } = await supabase
      .from("session_spaces")
      .select("space_id")
      .eq("session_id", op.sessionId);
    const current = (spaceRows ?? []).map((r) => r.space_id);
    const next = moveSpace(current, op.fromSpaceId ?? null, op.toSpaceId);
    if (next) fields.space_ids = next;
  }

  if (Object.keys(fields).length === 0) return { ok: true, inverse: [], sessionId: op.sessionId };

  return applyPatch(supabase, membership, op.sessionId, fields);
}

async function applyResize(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  op: z.infer<typeof ResizeOp>
): Promise<OpOutcome> {
  const { data: existing } = await supabase
    .from("sessions")
    .select("dtstart")
    .eq("id", op.sessionId)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!existing) {
    return { ok: false, response: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  }

  const fields: SessionPatchFields = {};
  if (op.startTime) fields.dtstart = buildDtstart(existing.dtstart.slice(0, 10), op.startTime);
  if (op.endTime) fields.dtend_time = op.endTime;

  if (Object.keys(fields).length === 0) return { ok: true, inverse: [], sessionId: op.sessionId };

  return applyPatch(supabase, membership, op.sessionId, fields);
}

async function applyCreate(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  op: z.infer<typeof CreateOp>
): Promise<OpOutcome> {
  if (!op.once && op.dayCodes.length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: "A repeating session needs at least one day." }, { status: 400 }),
    };
  }

  const result = await writeSession(supabase, membership, {
    schedule_group_id: op.scheduleGroupId,
    rrule: op.once
      ? buildRRuleString({ frequency: "once" })
      : buildRRuleString({ frequency: "weekly", days: op.dayCodes }),
    dtstart: buildDtstart(op.validFrom, op.startTime),
    dtend_time: op.endTime,
    valid_from: op.validFrom,
    valid_until: op.validUntil ?? null,
    space_ids: op.spaceIds,
    location_detail: op.locationDetail ?? null,
    template_id: op.templateId ?? null,
    occupancy_kind: op.occupancyKind,
    disclosure: op.disclosure,
  });

  if (!result.ok) return { ok: false, response: result.response };

  return {
    ok: true,
    sessionId: result.sessionId,
    inverse: [{ kind: "purge", sessionId: result.sessionId }],
  };
}

async function applyPurge(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  op: z.infer<typeof PurgeOp>
): Promise<OpOutcome> {
  const department = await departmentOfSession(supabase, op.sessionId, membership.org_id);
  if (department === undefined) {
    return { ok: false, response: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  }
  const denied = requirePermission(membership, "session:write", department);
  if (denied) return { ok: false, response: denied };

  const { error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", op.sessionId)
    .eq("org_id", membership.org_id);
  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Failed to remove session." }, { status: 500 }) };
  }

  // A purge is only ever the undo of a create inside this same batch, so the
  // thing that would undo IT is the create the caller still has in hand. There
  // is nothing useful to synthesise here, and synthesising a create from a row
  // that no longer exists would be a guess.
  return { ok: true, inverse: [] };
}

async function applyOccurrence(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  op: z.infer<typeof OccurrenceOp>
): Promise<OpOutcome> {
  const fail = (error: string, status = 400): OpOutcome => ({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });

  if (op.action === "modify" && (!op.startTime || !op.endTime)) {
    return fail("Start and end time are required.");
  }

  // session_exceptions is member-writable at the RLS layer (migration 024),
  // which predates `aux` — a lifeguard must not be able to cancel an
  // occurrence, so this is gated on the session's department like every other
  // schedule-content write.
  const department = await departmentOfSession(supabase, op.sessionId, membership.org_id);
  if (department === undefined) return fail("Session not found", 404);
  const denied = requirePermission(membership, "session:write", department);
  if (denied) return { ok: false, response: denied };

  const { data: prior } = await supabase
    .from("session_exceptions")
    .select("exception_type, modified_start, modified_end, note")
    .eq("session_id", op.sessionId)
    .eq("exception_date", op.date)
    .maybeSingle();

  const undo: OpInput = prior
    ? {
        kind: "occurrence",
        sessionId: op.sessionId,
        date: op.date,
        action: prior.exception_type === "cancelled" ? "cancel" : "modify",
        startTime: prior.modified_start?.slice(11, 16),
        endTime: prior.modified_end?.slice(11, 16),
        note: prior.note,
      }
    : { kind: "occurrence", sessionId: op.sessionId, date: op.date, action: "clear" };

  if (op.action === "clear") {
    const { error } = await supabase
      .from("session_exceptions")
      .delete()
      .eq("session_id", op.sessionId)
      .eq("exception_date", op.date);
    if (error) return fail("Could not revert that date.", 500);
    return { ok: true, sessionId: op.sessionId, inverse: [undo] };
  }

  type ExceptionInsert = Database["public"]["Tables"]["session_exceptions"]["Insert"];
  const row: ExceptionInsert = {
    session_id: op.sessionId,
    org_id: membership.org_id,
    exception_date: op.date,
    exception_type: op.action === "cancel" ? "cancelled" : "modified",
    // Literal local wall-clock digits, same convention as sessions.dtstart
    // (see dropin/docs/RESUME-timezone-removal.md) — never converted.
    modified_start: op.action === "modify" ? `${op.date}T${op.startTime}:00Z` : null,
    modified_end: op.action === "modify" ? `${op.date}T${op.endTime}:00Z` : null,
    note: op.note || null,
  };

  const { error } = await supabase
    .from("session_exceptions")
    .upsert(row, { onConflict: "session_id,exception_date" });
  if (error) return fail("Could not save that date's override.", 500);

  return { ok: true, sessionId: op.sessionId, inverse: [undo] };
}

// ---------------------------------------------------------------------------

/** Replays the inverses collected so far. Already newest-first. */
async function rollback(
  supabase: SupabaseServerClient,
  membership: RouteMembership,
  inverse: OpInput[]
): Promise<boolean> {
  for (const op of inverse) {
    const outcome = await applyOp(supabase, membership, op);
    if (!outcome.ok) return false;
  }
  return true;
}

async function readError(response: NextResponse): Promise<{ error: string; status: number }> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return { error: body?.error ?? "Could not apply this change.", status: response.status };
}
