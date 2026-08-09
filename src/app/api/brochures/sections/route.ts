import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";

const SectionSchema = z.object({
  sectionId: z.string().uuid().optional(),
  brochureId: z.string().uuid(),
  title: z.string().min(1).max(120),
  blurb: z.string().max(1000).nullable().optional(),
  layout: z.enum(["list", "grid", "feature"]).optional(),
  display_order: z.number().int().min(0).optional(),
});

const ReorderSchema = z.object({
  brochureId: z.string().uuid(),
  /** Section ids in their new order. */
  order: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * POST /api/brochures/sections — create or update a section.
 *
 * Member-writable: arranging a brochure is content work, matching migration
 * 031's policy. Only creating and publishing the brochure itself is
 * owner/admin.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);

  // One route, two shapes: a reorder is a list of ids, an edit is a section.
  // Kept together because they write the same table and share the ownership
  // check; split by which fields are present rather than by a mode flag.
  if (body && Array.isArray(body.order)) return reorder(supabase, user.id, body);

  const parsed = SectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { sectionId, brochureId, ...fields } = parsed.data;

  const { data: brochure } = await supabase
    .from("brochures")
    .select("id")
    .eq("id", brochureId)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (!brochure) return NextResponse.json({ error: "Brochure not found" }, { status: 404 });

  if (sectionId) {
    const { error } = await supabase
      .from("brochure_sections")
      .update(fields)
      .eq("id", sectionId)
      .eq("brochure_id", brochureId)
      .eq("org_id", membership.org_id);
    if (error) return NextResponse.json({ error: "Failed to update section." }, { status: 500 });
    return NextResponse.json({ ok: true, sectionId });
  }

  // Appended, so a new section never displaces existing ones.
  const { data: last } = await supabase
    .from("brochure_sections")
    .select("display_order")
    .eq("brochure_id", brochureId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("brochure_sections")
    .insert({
      ...fields,
      brochure_id: brochureId,
      org_id: membership.org_id,
      display_order: fields.display_order ?? (last?.display_order ?? -1) + 1,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: "Failed to create section." }, { status: 500 });
  return NextResponse.json({ ok: true, sectionId: created.id });
}

async function reorder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  body: unknown
) {
  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reorder payload" }, { status: 400 });
  }

  const membership = await getRouteMembership(supabase, userId);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { brochureId, order } = parsed.data;

  // Every id is scoped to this brochure *and* org in its own WHERE clause, so a
  // foreign id in the list updates nothing rather than reordering someone
  // else's brochure.
  const results = await Promise.all(
    order.map((id, index) =>
      supabase
        .from("brochure_sections")
        .update({ display_order: index })
        .eq("id", id)
        .eq("brochure_id", brochureId)
        .eq("org_id", membership.org_id)
    )
  );

  if (results.some((r) => r.error)) {
    return NextResponse.json({ error: "Failed to reorder sections." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/brochures/sections?sectionId=uuid
 *
 * Entries in the section are NOT deleted — `section_id` is ON DELETE SET NULL,
 * so they become unfiled and the editor shows them in a tray. That is what
 * keeps a deleted section from taking its tombstones with it and silently
 * resurrecting dismissed candidates on the next pull (migration 031,
 * decision 3).
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sectionId = new URL(request.url).searchParams.get("sectionId");
  if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

  const membership = await getRouteMembership(supabase, user.id);
  if (!membership) return NextResponse.json({ error: "No organization found" }, { status: 403 });

  const { error } = await supabase
    .from("brochure_sections")
    .delete()
    .eq("id", sectionId)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Failed to delete section." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
