import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils/slugify";
import { coerceFieldValue } from "@/lib/scraping/coerce";
import { ConflictResolveSchema } from "@/lib/scraping/schemas";
import type { ScrapedProgram, ScrapedSession } from "@/lib/scraping/schemas";

/**
 * POST /api/scraping/conflicts/resolve
 *
 * Bulk-resolves scraping_conflicts rows (mirrors import/commit's row-array
 * pattern). On "accepted": new entities are inserted, field changes are
 * applied to the existing row. On "rejected"/"ignored": only the resolution
 * is stamped, the target entity is left untouched.
 *
 * Program conflicts are always applied before session conflicts in the same
 * request, so a session referencing a brand-new program (via
 * program_external_id) can resolve to the program's freshly-created id.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ConflictResolveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { conflict_ids, resolution } = parsed.data;
  const db = supabase as any;

  const { data: conflicts } = await db
    .from("scraping_conflicts")
    .select("*")
    .in("id", conflict_ids)
    .eq("org_id", membership.org_id)
    .is("resolution", null);

  if (!conflicts || conflicts.length === 0) {
    return NextResponse.json({ ok: true, resolved: 0, errors: [] });
  }

  const errors: string[] = [];
  let resolved = 0;
  const nowIso = new Date().toISOString();

  // Need the config's facility_id for brand-new programs (not carried in the conflict row).
  const jobIds = [...new Set(conflicts.map((c: any) => c.job_id))];
  const { data: jobs } = await db.from("scraping_jobs").select("id, config_id").in("id", jobIds);
  const { data: configs } = await db
    .from("scraping_configs")
    .select("id, facility_id")
    .in("id", (jobs ?? []).map((j: any) => j.config_id));

  const facilityIdByJobId = new Map<string, string | null>();
  for (const job of jobs ?? []) {
    const config = (configs ?? []).find((c: any) => c.id === job.config_id);
    facilityIdByJobId.set(job.id, config?.facility_id ?? null);
  }

  const programConflicts = conflicts.filter((c: any) => c.entity_type === "program");
  const sessionConflicts = conflicts.filter((c: any) => c.entity_type === "session");

  // Tracks external_id -> real program id for newly-accepted programs this request.
  const newProgramIdByExternalId = new Map<string, string>();

  for (const conflict of programConflicts) {
    if (resolution !== "accepted") {
      await db.from("scraping_conflicts").update({ resolution, resolved_by: user.id, resolved_at: nowIso }).eq("id", conflict.id);
      resolved++;
      continue;
    }

    try {
      if (conflict.field_name === "_new") {
        const scraped = JSON.parse(conflict.scraped_value) as ScrapedProgram;
        const facilityId = facilityIdByJobId.get(conflict.job_id);
        if (!facilityId) throw new Error("No facility configured for this scraping config");

        const slug = slugify(scraped.name);
        const { data: program, error } = await db
          .from("programs")
          .upsert(
            {
              org_id: membership.org_id,
              facility_id: facilityId,
              name: scraped.name,
              slug,
              description: scraped.description ?? null,
              sport_category: scraped.sport_category,
              activity_type: scraped.activity_type,
              age_group: scraped.age_group ?? null,
              skill_level: scraped.skill_level ?? null,
              max_participants: scraped.max_participants ?? null,
              cost_cents: scraped.cost_cents ?? 0,
              cost_notes: scraped.cost_notes ?? null,
              tags: scraped.tags ?? [],
              is_published: false,
              source: "scraped",
              source_url: scraped.source_url,
              external_id: scraped.external_id,
              last_synced_at: nowIso,
            },
            { onConflict: "facility_id,slug" }
          )
          .select("id")
          .single();

        if (error || !program) throw new Error(error?.message ?? "Insert failed");
        newProgramIdByExternalId.set(scraped.external_id, program.id);
      } else {
        const value = coerceFieldValue(conflict.field_name, conflict.scraped_value);
        const { error } = await db
          .from("programs")
          .update({ [conflict.field_name]: value, last_synced_at: nowIso })
          .eq("id", conflict.entity_id)
          .eq("org_id", membership.org_id);

        if (error) throw new Error(error.message);
      }

      await db.from("scraping_conflicts").update({ resolution, resolved_by: user.id, resolved_at: nowIso }).eq("id", conflict.id);
      resolved++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push(`Program conflict ${conflict.id}: ${message}`);
    }
  }

  for (const conflict of sessionConflicts) {
    if (resolution !== "accepted") {
      await db.from("scraping_conflicts").update({ resolution, resolved_by: user.id, resolved_at: nowIso }).eq("id", conflict.id);
      resolved++;
      continue;
    }

    try {
      if (conflict.field_name === "_new") {
        const scraped = JSON.parse(conflict.scraped_value) as ScrapedSession;

        let programId = newProgramIdByExternalId.get(scraped.program_external_id);
        if (!programId) {
          const { data: existingProgram } = await db
            .from("programs")
            .select("id")
            .eq("org_id", membership.org_id)
            .eq("external_id", scraped.program_external_id)
            .eq("source", "scraped")
            .maybeSingle();
          programId = existingProgram?.id;
        }

        if (!programId) {
          throw new Error(
            `Referenced program (${scraped.program_external_id}) was not found — accept its conflict first`
          );
        }

        const { error } = await db.from("sessions").insert({
          program_id: programId,
          org_id: membership.org_id,
          rrule: scraped.rrule,
          dtstart: scraped.dtstart,
          dtend_time: scraped.dtend_time,
          timezone: scraped.timezone,
          valid_from: scraped.valid_from,
          valid_until: scraped.valid_until ?? null,
          location_detail: scraped.location_detail ?? null,
          source: "scraped",
          source_url: scraped.source_url,
          external_id: scraped.external_id,
          last_synced_at: nowIso,
          is_active: true,
        });

        if (error) throw new Error(error.message);
      } else {
        const value = coerceFieldValue(conflict.field_name, conflict.scraped_value);
        const { error } = await db
          .from("sessions")
          .update({ [conflict.field_name]: value, last_synced_at: nowIso })
          .eq("id", conflict.entity_id)
          .eq("org_id", membership.org_id);

        if (error) throw new Error(error.message);
      }

      await db.from("scraping_conflicts").update({ resolution, resolved_by: user.id, resolved_at: nowIso }).eq("id", conflict.id);
      resolved++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push(`Session conflict ${conflict.id}: ${message}`);
    }
  }

  return NextResponse.json({ ok: true, resolved, errors });
}
