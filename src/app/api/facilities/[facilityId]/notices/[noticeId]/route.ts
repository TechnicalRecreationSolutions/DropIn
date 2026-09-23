import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requireNoticeWrite } from "@/lib/auth/guard";
import { facilityNoticesCacheTag } from "@/lib/cache/tags";
import { NOTICE_CATEGORIES, NOTICE_SEVERITIES } from "@/lib/status/notices";

/**
 * One facility status notice (migration 060).
 *
 * PATCH  — edit it, publish or unpublish it, or CLEAR it.
 * DELETE — remove it from the record entirely.
 *
 * ## Clearing is a PATCH, not a DELETE
 *
 * "The pool is open again" sets `ends_at` to now(). It does not delete the row,
 * and the difference matters twice over: the history of why a facility keeps
 * closing is the thing an operator will eventually want to read, and a patron
 * who saw the closure an hour ago is owed the record that it was real. DELETE
 * exists for the other case — a notice posted by mistake, about the wrong
 * space, which should never have existed.
 *
 * ## Absent means "leave it alone"
 *
 * Every field is optional and only the keys present in the body are written,
 * the same contract `/api/sessions` carries. `ends_at: null` is therefore a
 * real instruction ("reopen this indefinitely") and is distinct from omitting
 * it, which is why the schema uses `.nullable().optional()` rather than
 * `.nullish()` — the latter collapses the two.
 */

const PatchSchema = z.object({
  category: z.enum(NOTICE_CATEGORIES).optional(),
  severity: z.enum(NOTICE_SEVERITIES).optional(),
  headline: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(1000).nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_published: z.boolean().optional(),
});

async function loadContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  facilityId: string,
  noticeId: string,
  orgId: string
) {
  const [{ data: facility }, { data: notice }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, organizations!inner(aux_can_post_notices)")
      .eq("id", facilityId)
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase
      .from("facility_notices")
      .select("id")
      .eq("id", noticeId)
      .eq("facility_id", facilityId)
      .eq("org_id", orgId)
      .maybeSingle(),
  ]);

  if (!facility || !notice) return null;

  const org = (facility as unknown as { organizations: { aux_can_post_notices: boolean } })
    .organizations;
  return { auxCanPostNotices: org.aux_can_post_notices === true };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ facilityId: string; noticeId: string }> }
) {
  const { facilityId, noticeId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadContext(supabase, facilityId, noticeId, membership.org_id);
  if (!context) return NextResponse.json({ error: "Notice not found" }, { status: 404 });

  const denied = requireNoticeWrite(membership, context, facilityId);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  // Same cross-facility check as POST: `space_id` references `spaces`, not
  // "spaces at this facility", so the database will happily accept a lane from
  // another building. `=== null` passes through — that is "un-scope it".
  if (parsed.data.space_id) {
    const { data: space } = await supabase
      .from("spaces")
      .select("id")
      .eq("id", parsed.data.space_id)
      .eq("facility_id", facilityId)
      .maybeSingle();
    if (!space) {
      return NextResponse.json({ error: "That space is not at this facility" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("facility_notices")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", noticeId)
    .eq("facility_id", facilityId)
    .select("*")
    .single();

  if (error) {
    // The window CHECK (ends_at > starts_at) is the one that lands here when a
    // clear is attempted on a notice whose starts_at is in the future.
    return NextResponse.json({ error: "Could not update the notice" }, { status: 400 });
  }

  revalidateTag(facilityNoticesCacheTag(facilityId), { expire: 0 });

  return NextResponse.json({ notice: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ facilityId: string; noticeId: string }> }
) {
  const { facilityId, noticeId } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const context = await loadContext(supabase, facilityId, noticeId, membership.org_id);
  if (!context) return NextResponse.json({ error: "Notice not found" }, { status: 404 });

  const denied = requireNoticeWrite(membership, context, facilityId);
  if (denied) return denied;

  const { error } = await supabase
    .from("facility_notices")
    .delete()
    .eq("id", noticeId)
    .eq("facility_id", facilityId);

  if (error) {
    return NextResponse.json({ error: "Could not delete the notice" }, { status: 500 });
  }

  revalidateTag(facilityNoticesCacheTag(facilityId), { expire: 0 });

  return new NextResponse(null, { status: 204 });
}
