import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";
import { SPORT_CATEGORY_IDS } from "@/lib/utils/sport-categories";
import { findPublishOverlap } from "@/lib/schedule/publishOverlap";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const UpdateScheduleGroupSchema = z.object({
  department_id: z.string().uuid().nullish(),
  name: z.string().min(1).optional(),
  sport_category: z.enum(SPORT_CATEGORY_IDS).optional(),
  activity_type: z.enum(["drop_in", "registered", "open_gym"]).optional(),
  age_group: z.string().nullish(),
  skill_level: z.string().nullish(),
  cost_cents: z.number().int().nonnegative().optional(),
  cost_notes: z.string().nullish(),
  description: z.string().nullish(),
  max_participants: z.number().int().positive().nullish(),
  status: z.enum(["draft", "published"]).optional(),
  starts_on: DateString.nullish(),
  ends_on: DateString.nullish(),
  in_brochure: z.boolean().optional(),
  photo_urls: z.array(z.string()).optional(),
});

/**
 * PATCH /api/schedule-groups/[id] — update a schedule group.
 *
 * Whenever the resulting status is 'published', this both requires starts_on
 * to be set (ends_on stays optional — an indefinite weekly drop-in with no
 * planned end is the common case, not a half-filled-out exception) and runs
 * findPublishOverlap() against every other published schedule group at the
 * same facility — not just when status is *newly* becoming 'published'. An
 * edit to an already-published schedule's dates (or a legacy row from before
 * this check existed) gets the same guarantee, and the query is cheap at the
 * scale one facility's schedule groups run at.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = UpdateScheduleGroupSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const fields = parsed.data;

  const { data: existing } = await supabase
    .from("schedule_groups")
    .select("facility_id, status, starts_on, ends_on")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // A PATCH can touch just one field of a few — validate the combined result
  // (incoming value where provided, existing row's value otherwise), not just
  // what's in this request body.
  const nextStatus = fields.status ?? existing.status;
  const nextStartsOn = fields.starts_on !== undefined ? fields.starts_on : existing.starts_on;
  const nextEndsOn = fields.ends_on !== undefined ? fields.ends_on : existing.ends_on;
  if (nextStartsOn && nextEndsOn && nextEndsOn < nextStartsOn) {
    return NextResponse.json({ error: "End date must be on or after the start date." }, { status: 400 });
  }

  if (nextStatus === "published") {
    // An end date is not required — an indefinite weekly drop-in with no
    // planned end is the common case for this kind of schedule, not a
    // half-filled-out exception. findPublishOverlap treats a null endsOn as
    // running forever, the same way it already treats a null ends_on on the
    // *other* side of the comparison.
    if (!nextStartsOn) {
      return NextResponse.json(
        { error: "This schedule needs a start date before it can be published." },
        { status: 400 }
      );
    }

    const overlap = await findPublishOverlap(supabase, {
      scheduleGroupId: id,
      facilityId: existing.facility_id,
      startsOn: nextStartsOn,
      endsOn: nextEndsOn,
    });
    if (overlap) return NextResponse.json({ error: overlap.error }, { status: 409 });
  }

  if (fields.department_id) {
    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", fields.department_id)
      .eq("facility_id", existing.facility_id)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  const payload = {
    ...fields,
    ...(fields.name ? { slug: slugify(fields.name) } : {}),
  };

  const { data, error } = await supabase
    .from("schedule_groups")
    .update(payload)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A schedule with this name already exists at that facility." : "Could not update schedule." },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  return NextResponse.json({ scheduleGroup: data });
}
