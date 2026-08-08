import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";
import { zonedTimeToUtc } from "@/lib/utils/timezone";
import { MAX_ROWS, validateRow, type ImportRow } from "@/lib/import/rows";

const CommitSchema = z.object({
  // Capped here as well as in /api/import. The cap there bounds what the
  // *parser* produces; this endpoint takes JSON straight from the client and
  // never sees the file, so without its own limit the cap is trivially skipped
  // by posting rows directly.
  rows: z.array(z.any()).max(MAX_ROWS),
  facilityId: z.string().uuid(),
  departmentId: z.string().uuid().nullish(),
});

/**
 * POST /api/import/commit
 * Inserts validated import rows into schedule_groups + sessions tables.
 * Skips rows with validation errors.
 *
 * Rows arrive from the browser carrying the `_errors` and `_rrule` that
 * /api/import computed, but those round-tripped through the client, so they are
 * recomputed here rather than believed — otherwise posting `_errors: []` writes
 * an unvalidated row.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = CommitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { rows, facilityId, departmentId } = parsed.data;
  const validRows = (rows as ImportRow[])
    .map((row, i) => validateRow(row, i))
    .filter((r) => r._errors.length === 0);

  let scheduleGroupsCreated = 0;
  let sessionsCreated = 0;
  const errors: string[] = [];

  for (const row of validRows) {
    try {
      const slug = slugify(row.program_name);
      const costCents = row.cost ? Math.round(parseFloat(row.cost) * 100) : 0;

      // Upsert schedule group by slug + facility
      const { data: scheduleGroup, error: sgErr } = await supabase
        .from("schedule_groups")
        .upsert({
          name: row.program_name,
          slug,
          facility_id: facilityId,
          department_id: departmentId ?? null,
          org_id: membership.org_id,
          sport_category: row.sport_category.toLowerCase().replace(/\s+/g, "_"),
          // Cast: an arbitrary spreadsheet value, not narrowed to the DB's
          // CHECK-constrained union. An invalid value is already rejected at
          // the DB level (sgErr below), same as before this cast existed.
          activity_type: (row.activity_type ?? "drop_in") as "drop_in" | "registered" | "open_gym",
          cost_cents: isNaN(costCents) ? 0 : costCents,
          is_published: false,
          source: "imported",
        }, { onConflict: "facility_id,slug" })
        .select("id")
        .single();

      if (sgErr || !scheduleGroup) {
        errors.push(`Row ${row._index + 1}: Could not create schedule "${row.program_name}"`);
        continue;
      }

      scheduleGroupsCreated++;

      // Build dtstart from season_start + start_time, wall-clock in the facility's timezone
      const dtstart = zonedTimeToUtc(row.season_start, row.start_time, "America/Edmonton").toISOString();

      const { error: sErr } = await supabase.from("sessions").insert({
        schedule_group_id: scheduleGroup.id,
        org_id: membership.org_id,
        rrule: row._rrule,
        dtstart,
        dtend_time: row.end_time,
        timezone: "America/Edmonton",
        valid_from: row.season_start,
        valid_until: row.season_end || null,
        location_detail: row.location_detail || null,
        source: "imported",
        is_active: true,
      });

      if (sErr) {
        errors.push(`Row ${row._index + 1}: Could not create session for "${row.program_name}"`);
        continue;
      }

      sessionsCreated++;
    } catch {
      errors.push(`Row ${row._index + 1}: Unexpected error`);
    }
  }

  return NextResponse.json({ ok: true, scheduleGroupsCreated, sessionsCreated, errors });
}
