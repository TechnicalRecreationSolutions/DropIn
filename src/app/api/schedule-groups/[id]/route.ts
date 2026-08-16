import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";
import { SPORT_CATEGORY_IDS } from "@/lib/utils/sport-categories";
import { findPublishOverlap } from "@/lib/schedule/publishOverlap";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const UpdateScheduleGroupSchema = z.object({
  facility_id: z.string().uuid().optional(),
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
 *
 * A facility_id change is rejected outright (409, before any other check)
 * if the schedule already has active sessions with assigned spaces — those
 * spaces belong to the *current* facility, and moving the schedule out from
 * under them would leave session_spaces pointing at a building it no longer
 * occupies.
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
  const nextFacilityId = fields.facility_id ?? existing.facility_id;
  const nextStartsOn = fields.starts_on !== undefined ? fields.starts_on : existing.starts_on;
  const nextEndsOn = fields.ends_on !== undefined ? fields.ends_on : existing.ends_on;
  if (nextStartsOn && nextEndsOn && nextEndsOn < nextStartsOn) {
    return NextResponse.json({ error: "End date must be on or after the start date." }, { status: 400 });
  }

  if (fields.facility_id && fields.facility_id !== existing.facility_id) {
    const { data: facility } = await supabase
      .from("facilities")
      .select("id")
      .eq("id", fields.facility_id)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

    // A session's spaces belong to its facility (session_spaces -> spaces ->
    // facility_id). Moving the schedule out from under active sessions that
    // already claim spaces would leave those rows pointing at a space in a
    // building the schedule no longer belongs to.
    const { data: sessionRows } = await supabase
      .from("sessions")
      .select("id")
      .eq("schedule_group_id", id)
      .eq("is_active", true);
    const sessionIds = (sessionRows ?? []).map((r) => r.id);
    if (sessionIds.length > 0) {
      const { data: spaceRows } = await supabase
        .from("session_spaces")
        .select("session_id")
        .in("session_id", sessionIds)
        .limit(1);
      if (spaceRows && spaceRows.length > 0) {
        return NextResponse.json(
          {
            error:
              "This schedule has sessions with assigned spaces at its current facility. Remove those space assignments before moving it.",
          },
          { status: 409 }
        );
      }
    }
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
      facilityId: nextFacilityId,
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
      .eq("facility_id", nextFacilityId)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  // Set explicitly on every write — schedule_groups has no updated_at
  // trigger, so the schedule list's MODIFIED status (updated_at >
  // published_at) depends on this being here (migration 035).
  const payload = {
    ...fields,
    ...(fields.name ? { slug: slugify(fields.name) } : {}),
    updated_at: new Date().toISOString(),
    // published_at only moves on the transition INTO 'published' — an
    // ordinary edit to an already-published schedule must NOT reset it,
    // that's what lets MODIFIED show up at all.
    ...(nextStatus === "published" && existing.status !== "published"
      ? { published_at: new Date().toISOString() }
      : {}),
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

/**
 * DELETE /api/schedule-groups/[id] — remove a schedule and everything under
 * it. No soft-delete/archive column exists on this table, so this mirrors
 * `/api/facilities/[facilityId]`'s hard delete rather than introducing a new
 * one: the cascade is entirely in the schema (`sessions`, `session_templates`
 * declare `ON DELETE CASCADE` on `schedule_group_id`), not hand-rolled here.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage schedules" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("schedule_groups")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not delete this schedule." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
