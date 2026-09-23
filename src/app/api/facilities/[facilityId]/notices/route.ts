import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requireNoticeWrite } from "@/lib/auth/guard";
import { facilityNoticesCacheTag } from "@/lib/cache/tags";
import { NOTICE_CATEGORIES, NOTICE_SEVERITIES } from "@/lib/status/notices";

/**
 * A facility's status notices (migration 060).
 *
 * GET  — every notice on the facility, newest first. Staff only, and
 *        deliberately unfiltered: drafts, scheduled notices and finished ones
 *        are all here, because the history is the point of the staff view.
 * POST — create one.
 *
 * **Authorization is `requireNoticeWrite`, not `requirePermission`.** A notice
 * is the only object in the app whose write authority depends on an
 * organization setting (`aux_can_post_notices`) as well as a role, so `can()`
 * cannot answer it. See `src/lib/auth/guard.ts`.
 */

const NoticeSchema = z.object({
  category: z.enum(NOTICE_CATEGORIES),
  severity: z.enum(NOTICE_SEVERITIES),
  headline: z.string().trim().min(1).max(120),
  body: z.string().max(1000).nullish(),
  space_id: z.string().uuid().nullish(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullish(),
  is_published: z.boolean().optional(),
});

/**
 * The facility, plus the one organization column authorization needs.
 *
 * Returns null when the facility is not in the caller's org — which is a 404
 * rather than a 403 on purpose, matching `/api/departments`: confirming that
 * an id exists somewhere else is itself a small leak.
 */
async function loadFacility(
  supabase: Awaited<ReturnType<typeof createClient>>,
  facilityId: string,
  orgId: string
) {
  const { data } = await supabase
    .from("facilities")
    .select("id, org_id, organizations!inner(aux_can_post_notices)")
    .eq("id", facilityId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!data) return null;

  // The relational select comes back untyped — see the note at the top of
  // src/types/database.types.ts about the empty Relationships arrays.
  const org = (data as unknown as { organizations: { aux_can_post_notices: boolean } })
    .organizations;

  return { id: data.id, auxCanPostNotices: org.aux_can_post_notices === true };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // No permission gate on the read. Every role, aux included, must be able to
  // see the notice saying the pool they are standing next to is closed — and
  // RLS confines the rows to the caller's own organization regardless.
  const { data, error } = await supabase
    .from("facility_notices")
    .select("*")
    .eq("facility_id", facilityId)
    .eq("org_id", membership.org_id)
    .order("starts_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load notices" }, { status: 500 });
  }

  return NextResponse.json({ notices: data ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const facility = await loadFacility(supabase, facilityId, membership.org_id);
  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  const denied = requireNoticeWrite(membership, facility, facilityId);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = NoticeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // A space must belong to THIS facility. The database has no cross-table
  // check for it (space_id references spaces, not "spaces at facility_id"), so
  // without this a notice could name a lane in another building and render
  // "Lane 3 is closed" on a page where no Lane 3 exists.
  if (input.space_id) {
    const { data: space } = await supabase
      .from("spaces")
      .select("id")
      .eq("id", input.space_id)
      .eq("facility_id", facilityId)
      .maybeSingle();
    if (!space) {
      return NextResponse.json({ error: "That space is not at this facility" }, { status: 400 });
    }
  }

  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("facility_notices")
    .insert({
      facility_id: facilityId,
      org_id: membership.org_id,
      space_id: input.space_id ?? null,
      category: input.category,
      severity: input.severity,
      headline: input.headline,
      body: input.body?.trim() ? input.body : null,
      starts_at: input.starts_at ?? new Date().toISOString(),
      ends_at: input.ends_at ?? null,
      is_published: input.is_published ?? false,
      created_by: user?.id ?? null,
    })
    .select("*")
    .single();

  if (error) {
    // The window CHECK and the headline length CHECK both land here. The
    // client validates the same rules, so this is the API-direct path.
    return NextResponse.json({ error: "Could not create the notice" }, { status: 400 });
  }

  // Only a PUBLISHED notice changes what patrons see, but expiring on every
  // write costs one tag invalidation and removes a whole class of "I published
  // it and nothing happened" — a draft that is published by a later PATCH goes
  // through the same expiry there.
  revalidateTag(facilityNoticesCacheTag(facilityId), { expire: 0 });

  return NextResponse.json({ notice: data }, { status: 201 });
}
