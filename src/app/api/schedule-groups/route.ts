import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";
import { SPORT_CATEGORY_IDS } from "@/lib/utils/sport-categories";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateScheduleGroupSchema = z.object({
  facility_id: z.string().uuid(),
  department_id: z.string().uuid().nullish(),
  name: z.string().min(1),
  sport_category: z.enum(SPORT_CATEGORY_IDS),
  activity_type: z.enum(["drop_in", "registered", "open_gym"]).default("drop_in"),
  age_group: z.string().nullish(),
  skill_level: z.string().nullish(),
  cost_cents: z.number().int().nonnegative().default(0),
  cost_notes: z.string().nullish(),
  description: z.string().nullish(),
  max_participants: z.number().int().positive().nullish(),
  status: z.enum(["draft", "published"]).default("draft"),
  starts_on: DateString.nullish(),
  ends_on: DateString.nullish(),
  in_brochure: z.boolean().default(false),
  photo_urls: z.array(z.string()).default([]),
});

/**
 * GET /api/schedule-groups?departmentId=... — list schedule groups
 * (optionally scoped to a department). Used by department/facility pickers
 * (ScheduleGroupForm, WidgetConfigurator).
 * POST /api/schedule-groups — create a schedule group under a facility owned
 * by the caller's org. ScheduleGroupForm used to write directly via the
 * Supabase client (unlike departments/spaces); this route brings it in line
 * with that pattern so status transitions have a server-side place to run
 * validation (the overlap check on draft->published is a later addition,
 * not this one — see migration 033's header).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const departmentId = new URL(request.url).searchParams.get("departmentId");

  let query = supabase
    .from("schedule_groups")
    .select("*")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: true });

  if (departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load schedule groups" }, { status: 500 });
  return NextResponse.json({ scheduleGroups: data ?? [] });
}

export async function POST(request: Request) {
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

  const parsed = CreateScheduleGroupSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const fields = parsed.data;

  if (fields.starts_on && fields.ends_on && fields.ends_on < fields.starts_on) {
    return NextResponse.json({ error: "End date must be on or after the start date." }, { status: 400 });
  }

  // No overlap check here (unlike PATCH) — a schedule group being created has
  // no sessions yet, so it can't structurally claim a space to conflict over.
  // The start-date-before-publish rule still applies though — see the PATCH
  // route for why an end date is not required.
  if (fields.status === "published" && !fields.starts_on) {
    return NextResponse.json(
      { error: "This schedule needs a start date before it can be published." },
      { status: 400 }
    );
  }

  // Verify the facility belongs to the caller's own org — facility_id has no
  // DB-level org boundary check, so this must be enforced here.
  const { data: facility } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", fields.facility_id)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  if (fields.department_id) {
    const { data: department } = await supabase
      .from("departments")
      .select("id")
      .eq("id", fields.department_id)
      .eq("facility_id", fields.facility_id)
      .maybeSingle();

    if (!department) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("schedule_groups")
    .insert({
      org_id: membership.org_id,
      facility_id: fields.facility_id,
      department_id: fields.department_id ?? null,
      name: fields.name,
      slug: slugify(fields.name),
      sport_category: fields.sport_category,
      activity_type: fields.activity_type,
      age_group: fields.age_group ?? null,
      skill_level: fields.skill_level ?? null,
      cost_cents: fields.cost_cents,
      cost_notes: fields.cost_notes ?? null,
      description: fields.description ?? null,
      max_participants: fields.max_participants ?? null,
      status: fields.status,
      starts_on: fields.starts_on ?? null,
      ends_on: fields.ends_on ?? null,
      in_brochure: fields.in_brochure,
      photo_urls: fields.photo_urls,
      source: "manual" as const,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A schedule with this name already exists at that facility." : "Could not create schedule." },
      { status: 500 }
    );
  }
  return NextResponse.json({ scheduleGroup: data }, { status: 201 });
}
