import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";

const UpdateTagSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  display_order: z.number().int().optional(),
});

/**
 * PATCH  /api/tags/[id] — rename or recolour one word in the vocabulary.
 * DELETE /api/tags/[id] — remove it from the vocabulary entirely.
 *
 * Both edit the *vocabulary*, so both reach every template already carrying the
 * tag — that is the point of it being a table. Renaming "Womens Only" to
 * "Women's Only" fixes every schedule and the printed legend at once, which is
 * the whole reason this is not free text on a template.
 *
 * DELETE is hard, not a soft archive like session_templates. A tag is a label,
 * not a record with history hanging off it: `session_template_tags` cascades,
 * the affected templates lose a chip, and nothing that describes a real booking
 * is lost. An archived-but-present tag would instead need every picker and
 * every public view to filter it, which is more machinery than the thing is
 * worth.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "tag:manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateTagSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { data, error } = await supabase
    .from("tags")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This facility already has a tag with that name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not update tag." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Tag not found" }, { status: 404 });

  return NextResponse.json({ tag: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "tag:manage");
  if (denied) return denied;

  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete tag" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
