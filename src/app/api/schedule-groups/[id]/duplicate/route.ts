import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DuplicateSchema = z.object({
  name: z.string().min(1),
  starts_on: DateString.nullish(),
  ends_on: DateString.nullish(),
});

/**
 * POST /api/schedule-groups/[id]/duplicate — copy a schedule group for reuse
 * as next season's starting point (the "Duplicate" row action on the
 * schedule list).
 *
 * Copies the schedule group's own fields (sport/cost/age/skill governance
 * fields — see migration 013's header for why those live here and not on
 * templates). Does NOT copy session_templates: since migration 042,
 * templates belong to a department (or the whole facility), not a single
 * schedule, so the duplicate — landing in the same department — already
 * sees the same "usual activities" palette with nothing to copy.
 * Deliberately does NOT copy sessions either: they're tied to the old date range,
 * and the whole reason to duplicate is to place fresh ones into the new
 * range via the existing template-click builder flow — carrying old
 * occurrences over would just be more to delete. The copy always starts as
 * 'draft' regardless of the source's status, and start/end dates are
 * whatever the caller supplies (typically blank, for staff to fill in).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage schedules" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DuplicateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const fields = parsed.data;

  if (fields.starts_on && fields.ends_on && fields.ends_on < fields.starts_on) {
    return NextResponse.json({ error: "End date must be on or after the start date." }, { status: 400 });
  }

  const { data: source } = await supabase
    .from("schedule_groups")
    .select("*")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const { data: created, error: createError } = await supabase
    .from("schedule_groups")
    .insert({
      org_id: membership.org_id,
      facility_id: source.facility_id,
      department_id: source.department_id,
      name: fields.name,
      slug: slugify(fields.name),
      sport_category: source.sport_category,
      activity_type: source.activity_type,
      age_group: source.age_group,
      skill_level: source.skill_level,
      cost_cents: source.cost_cents,
      cost_notes: source.cost_notes,
      description: source.description,
      max_participants: source.max_participants,
      schedule_type: source.schedule_type,
      photo_urls: source.photo_urls,
      status: "draft",
      starts_on: fields.starts_on ?? null,
      ends_on: fields.ends_on ?? null,
      source: "manual" as const,
    })
    .select("*")
    .single();

  if (createError || !created) {
    return NextResponse.json(
      {
        error:
          createError?.code === "23505"
            ? "A schedule with this name already exists at that facility."
            : "Could not duplicate this schedule.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ scheduleGroup: created }, { status: 201 });
}
