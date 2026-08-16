import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { getBrochureCandidates } from "@/lib/brochure/candidates";

const PullSchema = z.object({
  brochureId: z.string().uuid(),
  /** Where the new entries land. Null files them as unsectioned. */
  sectionId: z.string().uuid().nullable().optional(),
  /** Source ids to pull. Type is re-derived server-side, never trusted from here. */
  sourceIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * POST /api/brochures/pull — materialize candidates into entries.
 *
 * This is the transition from candidacy to membership, and the only place it
 * happens. Three properties make it correct:
 *
 * 1. THE SNAPSHOT IS TAKEN SERVER-SIDE. The client sends ids, never copy. If it
 *    sent the title and description, a brochure entry would be whatever the
 *    browser claimed the source said — and the whole point of the snapshot is
 *    that it is a faithful record of the source at pull time.
 *
 * 2. EXISTING ENTRIES ARE SKIPPED, INCLUDING TOMBSTONES. Pulling twice does not
 *    duplicate, and — the part that matters — it does not resurrect anything a
 *    human dismissed. `getBrochureCandidates` already reports `existing` for
 *    exactly this, and the partial UNIQUE indexes in migration 031 are the
 *    backstop if this check is ever wrong.
 *
 * 3. IT IS ADDITIVE ONLY. A pull never removes, reorders or rewrites an
 *    existing entry. Re-pulling a brochure someone has spent an hour arranging
 *    must not disturb the arrangement.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = PullSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { brochureId, sectionId, sourceIds } = parsed.data;

  // Assembling a brochure is content work, so any member may pull — matching
  // the member-writable policy on brochure_entries (migration 031, decision 6).
  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { data: brochure } = await supabase
    .from("brochures")
    .select("id, season_id, seasons ( starts_on, ends_on )")
    .eq("id", brochureId)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!brochure) return NextResponse.json({ error: "Brochure not found" }, { status: 404 });

  if (sectionId) {
    const { data: section } = await supabase
      .from("brochure_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("brochure_id", brochureId)
      .maybeSingle();
    // A section from another brochure would put entries somewhere the editor
    // never shows them.
    if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const season = firstOf(
    (brochure as unknown as { seasons: SeasonWindow | SeasonWindow[] | null }).seasons
  );

  const candidates = await getBrochureCandidates(supabase, {
    orgId: membership.org_id,
    seasonStart: season?.starts_on ?? null,
    seasonEnd: season?.ends_on ?? null,
    brochureId,
  });

  const requested = new Set(sourceIds);
  const byId = new Map(candidates.map((c) => [c.sourceId, c]));

  // Anything not currently a candidate is refused rather than pulled from
  // whatever the caller named: an id that is no longer flagged, or belongs to
  // another org, must not become an entry just because it was asked for.
  const pullable = [...requested].map((id) => byId.get(id)).filter((c) => c !== undefined);
  const unknown = requested.size - pullable.length;
  const alreadyPresent = pullable.filter((c) => c.existing !== null).length;
  const toInsert = pullable.filter((c) => c.existing === null);

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, added: 0, skipped: alreadyPresent, unknown });
  }

  // Appended after whatever is already in the target section, so a pull never
  // reshuffles an arrangement someone made by hand.
  const { data: last } = await supabase
    .from("brochure_entries")
    .select("display_order")
    .eq("brochure_id", brochureId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  let order = (last?.display_order ?? -1) + 1;
  const pulledAt = new Date().toISOString();

  const rows = toInsert.map((candidate) => ({
    brochure_id: brochureId,
    section_id: sectionId ?? null,
    org_id: membership.org_id,
    source_type: candidate.sourceType,
    // Every live candidate is a session now (see candidates.ts) — the column
    // stays for the schedule_group-sourced entries pulled before that change,
    // which are snapshots and untouched by it.
    session_id: candidate.sourceId,
    schedule_group_id: null,
    title: candidate.title,
    description: candidate.description,
    image_url: candidate.imageUrl,
    link_url: candidate.linkUrl,
    link_label: candidate.linkLabel,
    status: "included" as const,
    display_order: order++,
    source_pulled_at: pulledAt,
  }));

  const { error } = await supabase.from("brochure_entries").insert(rows);

  if (error) {
    // 23505 means a source was pulled concurrently by someone else. The
    // outcome the user wanted — it's in the brochure — already holds.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, added: 0, skipped: pullable.length, unknown });
    }
    console.error("brochure pull error:", error);
    return NextResponse.json({ error: "Failed to add these to the brochure." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    added: rows.length,
    skipped: alreadyPresent,
    unknown,
  });
}

interface SeasonWindow {
  starts_on: string;
  ends_on: string;
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
