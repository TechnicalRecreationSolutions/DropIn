import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";

const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());

const EntrySchema = z.object({
  entryId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: blankToNull(z.string().max(4000)).optional(),
  image_url: blankToNull(z.string().url()).optional(),
  link_url: blankToNull(z.string().url()).optional(),
  link_label: blankToNull(z.string().max(60)).optional(),
  status: z.enum(["included", "dismissed"]).optional(),
  section_id: z.string().uuid().nullable().optional(),
});

const MoveSchema = z.object({
  brochureId: z.string().uuid(),
  /** Entry ids in their new order, and the section they now belong to. */
  sectionId: z.string().uuid().nullable(),
  order: z.array(z.string().uuid()).max(300),
});

/**
 * POST /api/brochures/entries — edit one entry, or reorder a section's entries.
 *
 * Editing an entry deliberately never touches its source. The copy here was
 * snapshotted at pull time and is now owned by the brochure: rewording an entry
 * must not rewrite the session it came from, and re-pulling is the only way
 * copy flows the other direction (migration 031, publication freezing).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (body && Array.isArray(body.order)) return move(supabase, user.id, body);

  const parsed = EntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { entryId, ...fields } = parsed.data;

  // Spelled out rather than filtered dynamically: `Object.fromEntries` widens
  // every value to `string | null`, which the generated Update type rejects —
  // and losing the per-column types here is exactly how a typo'd column name
  // would reach the database as a silent no-op.
  const updates = {
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.image_url !== undefined ? { image_url: fields.image_url } : {}),
    ...(fields.link_url !== undefined ? { link_url: fields.link_url } : {}),
    ...(fields.link_label !== undefined ? { link_label: fields.link_label } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.section_id !== undefined ? { section_id: fields.section_id } : {}),
  };

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("brochure_entries")
    .update(updates)
    .eq("id", entryId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to update entry." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

async function move(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  body: unknown
) {
  const parsed = MoveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reorder payload" }, { status: 400 });
  }

  const membership = await getRouteMembership(supabase, userId);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { brochureId, sectionId, order } = parsed.data;

  // Scoped by brochure_id as well as org_id: dragging cannot move an entry into
  // a different brochure, which the section id alone would not prevent.
  const results = await Promise.all(
    order.map((id, index) =>
      supabase
        .from("brochure_entries")
        .update({ section_id: sectionId, display_order: index })
        .eq("id", id)
        .eq("brochure_id", brochureId)
        .eq("org_id", membership.org_id)
    )
  );

  if (results.some((r) => r.error)) {
    return NextResponse.json({ error: "Failed to reorder entries." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/brochures/entries?entryId=uuid
 *
 * Only for `custom` entries, which have no source to remember. A derived entry
 * is dismissed (`status = 'dismissed'`), never deleted — deleting it would let
 * the next pull resurrect a candidate a human removed, which is the whole point
 * of tombstones. The route enforces that rather than trusting the caller to
 * pick the right verb.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entryId = new URL(request.url).searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { data: entry } = await supabase
    .from("brochure_entries")
    .select("id, source_type")
    .eq("id", entryId)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  if (entry.source_type !== "custom") {
    return NextResponse.json(
      {
        error:
          "Entries pulled from a session or program are dismissed, not deleted, so they don't come back on the next pull.",
      },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("brochure_entries")
    .delete()
    .eq("id", entryId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete entry." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
