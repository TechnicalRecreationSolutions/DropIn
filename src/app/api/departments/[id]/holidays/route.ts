import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { mergeWindows, timeToMinutes, minutesToTime } from "@/lib/schedule/operating-hours";

/**
 * A department's holiday decisions (migration 059).
 *
 * PUT replaces the whole set for ONE YEAR at a time, not the whole table. The
 * editor shows a year, so a year is the unit staff can actually see — and
 * replacing everything would mean opening the 2026 tab and silently deleting
 * the 2027 closures someone else entered. The year is derived from the dates
 * in the payload rather than passed separately, so the two can never disagree.
 *
 * Replacing rather than reconciling, for the same reason the hours route does:
 * the grid is edited as a whole, and a per-row API turns one save into a burst
 * that can half-fail, leaving a department closed on a day the screen says it
 * is open.
 */
const HolidaySchema = z.object({
  holidays: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).max(120),
        observance: z.enum(["closed", "custom_hours", "normal_hours"]),
        windows: z
          .array(
            z.object({
              opens: z.string().regex(/^\d{2}:\d{2}$/),
              closes: z.string().regex(/^\d{2}:\d{2}$/),
            })
          )
          .optional()
          .default([]),
      })
    )
    .max(80),
  /** The year being replaced. Required so that saving an EMPTY list — staff
   *  unticking everything — still clears that year, which it could not do if
   *  the year were inferred from the (now absent) dates. */
  year: z.number().int().min(2000).max(2100),
});

/** GET /api/departments/[id]/holidays?year=2026 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "A valid ?year is required." }, { status: 400 });
  }

  const supabase = await createClient();

  // No membership check, same as the hours route: RLS already answers this
  // correctly for everyone, and a patron-facing surface explaining "closed
  // Christmas Day" needs the same endpoint.
  const { data, error } = await supabase
    .from("department_holidays")
    .select("holiday_date, name, observance, department_holiday_windows (opens_at, closes_at)")
    .eq("department_id", id)
    .gte("holiday_date", `${year}-01-01`)
    .lte("holiday_date", `${year}-12-31`)
    .order("holiday_date");

  if (error) return NextResponse.json({ error: "Could not load holidays." }, { status: 500 });

  type Row = {
    holiday_date: string;
    name: string;
    observance: "closed" | "custom_hours" | "normal_hours";
    department_holiday_windows: { opens_at: string; closes_at: string }[] | null;
  };

  const holidays = ((data ?? []) as unknown as Row[]).map((h) => ({
    date: h.holiday_date,
    name: h.name,
    observance: h.observance,
    windows: (h.department_holiday_windows ?? [])
      .map((w) => ({ opens: w.opens_at.slice(0, 5), closes: w.closes_at.slice(0, 5) }))
      .sort((a, b) => a.opens.localeCompare(b.opens)),
  }));

  return NextResponse.json({ year, holidays });
}

/** PUT /api/departments/[id]/holidays — replace one year's decisions. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same authority as setting the hours — this is department configuration.
  const denied = requirePermission(membership, "department:edit", id);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = HolidaySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { year, holidays } = parsed.data;

  // Every date must fall inside the year being replaced, or the delete below
  // would not cover what the insert is about to write — the row would survive
  // the next save of its real year and become impossible to remove from this
  // screen.
  const outside = holidays.find((h) => !h.date.startsWith(`${year}-`));
  if (outside) {
    return NextResponse.json(
      { error: `${outside.date} is not in ${year}.` },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  for (const h of holidays) {
    if (seen.has(h.date)) {
      return NextResponse.json({ error: `${h.date} is listed twice.` }, { status: 400 });
    }
    seen.add(h.date);
  }

  const { data: department } = await supabase
    .from("departments")
    .select("id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });

  // Windows are validated and merged before anything is written, so a bad time
  // in the twelfth holiday does not leave the first eleven deleted.
  const prepared: {
    row: {
      department_id: string;
      org_id: string;
      holiday_date: string;
      name: string;
      observance: "closed" | "custom_hours" | "normal_hours";
    };
    windows: { opens: number; closes: number }[];
  }[] = [];

  for (const h of holidays) {
    const windows = [];
    if (h.observance === "custom_hours") {
      for (const w of h.windows) {
        const opens = timeToMinutes(w.opens);
        const closes = timeToMinutes(w.closes);
        if (opens === null || closes === null) {
          return NextResponse.json({ error: `${h.name}: invalid time.` }, { status: 400 });
        }
        if (closes <= opens) {
          return NextResponse.json(
            { error: `${h.name}: a window has to end after it starts.` },
            { status: 400 }
          );
        }
        windows.push({ opens, closes });
      }
      if (windows.length === 0) {
        return NextResponse.json(
          { error: `${h.name}: choose Closed, or give at least one set of hours.` },
          { status: 400 }
        );
      }
    }

    prepared.push({
      row: {
        department_id: id,
        org_id: membership.org_id,
        holiday_date: h.date,
        name: h.name.trim(),
        observance: h.observance,
      },
      windows: mergeWindows(windows),
    });
  }

  // Delete then insert, scoped to the year. The two are separate statements
  // with no transaction available over PostgREST, so a failure between them
  // leaves that year cleared — every following session reverts to its ordinary
  // weekly hours, which is the pre-059 behaviour and is visibly wrong rather
  // than silently wrong. Re-saving fixes it.
  const { error: deleteError } = await supabase
    .from("department_holidays")
    .delete()
    .eq("department_id", id)
    .gte("holiday_date", `${year}-01-01`)
    .lte("holiday_date", `${year}-12-31`);
  if (deleteError) {
    return NextResponse.json({ error: "Could not update holidays." }, { status: 500 });
  }

  if (prepared.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("department_holidays")
      .insert(prepared.map((p) => p.row))
      .select("id, holiday_date");
    if (insertError || !inserted) {
      return NextResponse.json({ error: "Could not save holidays." }, { status: 500 });
    }

    const idByDate = new Map(inserted.map((r) => [r.holiday_date, r.id]));
    const windowRows = prepared.flatMap((p) => {
      const holidayId = idByDate.get(p.row.holiday_date);
      if (!holidayId) return [];
      return p.windows.map((w) => ({
        holiday_id: holidayId,
        org_id: membership.org_id,
        opens_at: minutesToTime(w.opens),
        closes_at: minutesToTime(w.closes),
      }));
    });

    if (windowRows.length > 0) {
      const { error: windowError } = await supabase
        .from("department_holiday_windows")
        .insert(windowRows);
      if (windowError) {
        return NextResponse.json({ error: "Could not save holiday hours." }, { status: 500 });
      }
    }
  }

  // How many sessions this affects, for the same reason the hours route
  // reports it: "holidays updated" understates closing the pool on eleven days
  // for fourteen sessions.
  const { count } = await supabase
    .from("sessions")
    .select("id, schedule_groups!inner(department_id)", { count: "exact", head: true })
    .eq("follows_operating_hours", true)
    .eq("is_active", true)
    .eq("schedule_groups.department_id", id);

  return NextResponse.json({
    ok: true,
    year,
    saved: prepared.length,
    closures: prepared.filter((p) => p.row.observance !== "normal_hours").length,
    sessionsFollowing: count ?? 0,
  });
}
