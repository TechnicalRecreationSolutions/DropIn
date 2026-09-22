import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { mergeWindows, timeToMinutes, minutesToTime } from "@/lib/schedule/operating-hours";

/**
 * A whole week, sent as one payload (migration 058).
 *
 * PUT-shaped rather than per-window POST/DELETE deliberately. Hours are edited
 * as a grid — staff add an evening window on Tuesday and delete Sunday in the
 * same sitting — and a per-row API would turn one save into a burst of
 * requests that can half-fail, leaving a department open on a day the editor
 * on screen says is closed. Replacing the set makes the saved state always
 * exactly what was shown.
 *
 * `days` is indexed 0=Sunday..6=Saturday, matching getUTCDay() and the
 * day_of_week column. A day with an empty array is closed; omitting a day is
 * the same as sending it empty, because a partial update of a grid nobody can
 * partially see would be a trap.
 */
const HoursSchema = z.object({
  days: z
    .array(
      z.array(
        z.object({
          opens: z.string().regex(/^\d{2}:\d{2}$/),
          closes: z.string().regex(/^\d{2}:\d{2}$/),
        })
      )
    )
    .length(7),
});

/** GET /api/departments/[id]/hours — the department's weekly operating hours. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // No membership check: RLS already answers this correctly for every caller
  // (migration 058 mirrors the parent department's read policy), and the
  // public widget needs the same endpoint to explain a following session's
  // times. An outsider asking about a draft department gets an empty week,
  // which is indistinguishable from a department that has not set any — as
  // intended.
  const { data, error } = await supabase
    .from("department_hours")
    .select("day_of_week, opens_at, closes_at")
    .eq("department_id", id)
    .order("day_of_week")
    .order("opens_at");

  if (error) return NextResponse.json({ error: "Could not load operating hours." }, { status: 500 });

  const days: { opens: string; closes: string }[][] = [[], [], [], [], [], [], []];
  for (const row of data ?? []) {
    if (row.day_of_week < 0 || row.day_of_week > 6) continue;
    days[row.day_of_week].push({
      opens: row.opens_at.slice(0, 5),
      closes: row.closes_at.slice(0, 5),
    });
  }

  return NextResponse.json({ days });
}

/** PUT /api/departments/[id]/hours — replace the department's whole week. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same authority as renaming the department — hours are configuration, not
  // scheduling. Matches the RLS policy in 058 rather than restating a
  // different rule in the application layer.
  const denied = requirePermission(membership, "department:edit", id);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = HoursSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Confirm the department is this org's before touching anything. RLS would
  // refuse the write anyway, but a 404 here is a clearer answer than a silent
  // zero-row delete followed by a zero-row insert.
  const { data: department } = await supabase
    .from("departments")
    .select("id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });

  const rows: {
    department_id: string;
    org_id: string;
    day_of_week: number;
    opens_at: string;
    closes_at: string;
  }[] = [];

  for (let day = 0; day < 7; day++) {
    const windows = [];
    for (const w of parsed.data.days[day]) {
      const opens = timeToMinutes(w.opens);
      const closes = timeToMinutes(w.closes);
      if (opens === null || closes === null) {
        return NextResponse.json({ error: "Invalid time in operating hours." }, { status: 400 });
      }
      // Rejected rather than merged: a window that closes before it opens is
      // a typo, not an intent to express, and silently dropping it would let
      // staff leave the page believing a day was set.
      if (closes <= opens) {
        return NextResponse.json(
          { error: "An operating-hours window must end after it starts." },
          { status: 400 }
        );
      }
      windows.push({ opens, closes });
    }

    // Overlapping and touching windows collapse here, before the insert, so
    // the stored set matches what expansion will produce and the unique index
    // (058) can never be tripped by two spellings of the same window.
    for (const w of mergeWindows(windows)) {
      rows.push({
        department_id: id,
        org_id: membership.org_id,
        day_of_week: day,
        opens_at: minutesToTime(w.opens),
        closes_at: minutesToTime(w.closes),
      });
    }
  }

  // Replace, not reconcile. The delete and the insert are two statements and
  // Supabase gives no transaction over PostgREST, so a failure between them
  // leaves the department with no hours — every following session falls back
  // to its stored snapshot times (see expandOccurrenceTimes) rather than
  // disappearing, and re-saving the page fixes it. That is the reason the
  // fallback direction was chosen.
  const { error: deleteError } = await supabase
    .from("department_hours")
    .delete()
    .eq("department_id", id);
  if (deleteError) {
    return NextResponse.json({ error: "Could not update operating hours." }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("department_hours").insert(rows);
    if (insertError) {
      return NextResponse.json({ error: "Could not save operating hours." }, { status: 500 });
    }
  }

  // How many sessions this just moved. Not a warning and not a gate — the
  // editor says it out loud after saving, because "operating hours updated"
  // understates what happened when 14 sessions changed their published times
  // as a result.
  const { count } = await supabase
    .from("sessions")
    .select("id, schedule_groups!inner(department_id)", { count: "exact", head: true })
    .eq("follows_operating_hours", true)
    .eq("is_active", true)
    .eq("schedule_groups.department_id", id);

  return NextResponse.json({ ok: true, sessionsFollowing: count ?? 0 });
}
