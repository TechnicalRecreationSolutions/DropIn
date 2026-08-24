import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/schedule-groups/[id]/week-reviews?rangeStart=&rangeEnd=
 *
 * Every stored review row for this schedule whose week_start falls in
 * [rangeStart, rangeEnd]. Sparse (migration 037) — a week with no row here
 * is 'pending'; callers default missing weeks themselves rather than this
 * route inventing rows for every week in the range.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = z
    .object({ rangeStart: DateString, rangeEnd: DateString })
    .safeParse({
      rangeStart: searchParams.get("rangeStart"),
      rangeEnd: searchParams.get("rangeEnd"),
    });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const { rangeStart, rangeEnd } = parsed.data;

  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!scheduleGroup) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("schedule_week_reviews")
    .select("week_start, status, note, reviewed_by, reviewed_at")
    .eq("schedule_group_id", id)
    .gte("week_start", rangeStart)
    .lte("week_start", rangeEnd);

  if (error) return NextResponse.json({ error: "Could not load week reviews." }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

const ReviewSchema = z.object({
  weekStart: DateString,
  status: z.enum(["pending", "approved", "needs_changes"]),
  note: z.string().max(500).nullish(),
});

/**
 * PUT /api/schedule-groups/[id]/week-reviews
 *
 * Sets one week's review status. Same permission tier as publishing the
 * schedule itself (PATCH /api/schedule-groups/[id]) — owner|admin — since
 * approving a week is what makes it visible to the public per migration 037.
 * Upserts on (schedule_group_id, week_start): setting a week back to
 * 'pending' is a real, storable outcome here (an admin explicitly un-marking
 * a week), not the same as the row never having existed.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can review schedule weeks" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { weekStart, status, note } = parsed.data;

  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id")
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!scheduleGroup) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("schedule_week_reviews")
    .upsert(
      {
        org_id: membership.org_id,
        schedule_group_id: id,
        week_start: weekStart,
        status,
        note: note ?? null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "schedule_group_id,week_start" }
    )
    .select("week_start, status, note, reviewed_by, reviewed_at")
    .single();

  if (error) return NextResponse.json({ error: "Could not save this week's review." }, { status: 500 });

  return NextResponse.json({ data });
}
