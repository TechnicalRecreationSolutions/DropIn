import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { expandOccurrenceTimes } from "@/lib/rrule/expand";
import type { Database } from "@/types/database.types";

const WeekOverrideSchema = z.object({
  /** Any date inside the target week — this route treats it as day 1 of a
   *  7-day window, so callers should pass the Monday the UI is already
   *  normalized to (useScheduleAnchor), not require the caller be strict. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(["cancel", "modify", "clear"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().max(500).nullish(),
});

/**
 * POST /api/sessions/[sessionId]/exceptions — override one week of a
 * recurring session without touching its RRULE. Batch-upserts (or, for
 * 'clear', deletes) one session_exceptions row per date the session's own
 * pattern actually produces within the given 7-day window — reusing
 * expandOccurrenceTimes() (src/lib/rrule/expand.ts) to find those dates
 * rather than re-deriving RRULE math a third time.
 *
 * This is the write path session_exceptions never had: before this route,
 * every table read from it (expand.ts, conflicts.ts, the widget) but nothing
 * created a row. Sessions being editable series (not per-occurrence rows) is
 * why "override a week" has to mean this — batched exceptions — rather than
 * a persisted week entity; see migration 033's header for the fuller
 * rationale.
 *
 * Known gap: unlike POST /api/sessions, this does not run
 * findSessionConflict() for the 'modify' action. A modified week's hours
 * could in principle newly overlap another session in the same space —
 * accepted for now as a smaller, disclosed limitation rather than building
 * a second conflict-check entry point for what's expected to be a rare
 * holiday-hours edit.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = WeekOverrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { weekStart, action, startTime, endTime, note } = parsed.data;

  if (action === "modify" && (!startTime || !endTime)) {
    return NextResponse.json({ error: "Start and end time are required." }, { status: 400 });
  }

  // session_exceptions is member-writable at the RLS layer (migration 024
  // deliberately left sessions/session_exceptions/session_spaces that way,
  // same as PATCH /api/sessions/[sessionId] — see that route's header), so
  // no owner|admin check here either.
  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { data: session } = await supabase
    .from("sessions")
    .select("id, rrule, dtstart, dtend_time, valid_from, valid_until")
    .eq("id", sessionId)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const rangeStart = new Date(weekStart + "T00:00:00Z");
  const rangeEnd = new Date(weekStart + "T00:00:00Z");
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 6);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  // Pass no exceptions here — this needs the base RRULE's occurrence dates
  // for the week, not the already-resolved (possibly already-cancelled) set.
  const occurrences = expandOccurrenceTimes(session, [], { rangeStart, rangeEnd });
  if (occurrences.length === 0) {
    return NextResponse.json({ error: "This session has no occurrences in that week." }, { status: 400 });
  }
  const dates = occurrences.map((o) => o.occurrenceDate);

  if (action === "clear") {
    const { error } = await supabase
      .from("session_exceptions")
      .delete()
      .eq("session_id", sessionId)
      .in("exception_date", dates);
    if (error) return NextResponse.json({ error: "Could not revert this week." }, { status: 500 });
    return NextResponse.json({ ok: true, datesAffected: dates });
  }

  type ExceptionInsert = Database["public"]["Tables"]["session_exceptions"]["Insert"];
  const rows: ExceptionInsert[] =
    action === "cancel"
      ? dates.map((exception_date) => ({
          session_id: sessionId,
          org_id: membership.org_id,
          exception_date,
          exception_type: "cancelled" as const,
          modified_start: null,
          modified_end: null,
          note: note || null,
        }))
      : // action === "modify" — same wall-clock start/end time applied to every
        // date in the week; sessions never span midnight (migration 001), so
        // no rollover handling is needed the way buildEndTime does for drift.
        dates.map((exception_date) => ({
          session_id: sessionId,
          org_id: membership.org_id,
          exception_date,
          exception_type: "modified" as const,
          // Literal local wall-clock digits, same convention as sessions.dtstart
          // (see dropin/docs/RESUME-timezone-removal.md) — never converted.
          modified_start: `${exception_date}T${startTime}:00Z`,
          modified_end: `${exception_date}T${endTime}:00Z`,
          note: note || null,
        }));

  const { error } = await supabase
    .from("session_exceptions")
    .upsert(rows, { onConflict: "session_id,exception_date" });
  if (error) return NextResponse.json({ error: "Could not save this week's override." }, { status: 500 });

  return NextResponse.json({ ok: true, datesAffected: dates });
}
