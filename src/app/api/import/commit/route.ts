import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import { zonedTimeToUtc } from "@/lib/utils/timezone";
import type { ImportPreviewRow } from "../route";

export const runtime = "nodejs";

const CommitSchema = z.object({
  rows: z.array(z.any()),
  facilityId: z.string().uuid(),
  departmentId: z.string().uuid().nullish(),
});

/**
 * POST /api/import/commit
 * Inserts validated import rows into schedule_groups + sessions tables.
 * Skips rows with validation errors.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .single() as unknown as { data: { org_id: string } | null };

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = CommitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { rows, facilityId, departmentId } = parsed.data;
  const validRows = (rows as ImportPreviewRow[]).filter((r) => r._errors.length === 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let scheduleGroupsCreated = 0;
  let sessionsCreated = 0;
  const errors: string[] = [];

  for (const row of validRows) {
    try {
      const slug = slugify(row.program_name);
      const costCents = row.cost ? Math.round(parseFloat(row.cost) * 100) : 0;

      // Upsert schedule group by slug + facility
      const { data: scheduleGroup, error: sgErr } = await db
        .from("schedule_groups")
        .upsert({
          name: row.program_name,
          slug,
          facility_id: facilityId,
          department_id: departmentId ?? null,
          org_id: membership.org_id,
          sport_category: row.sport_category.toLowerCase().replace(/\s+/g, "_"),
          activity_type: row.activity_type ?? "drop_in",
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

      const { error: sErr } = await db.from("sessions").insert({
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
