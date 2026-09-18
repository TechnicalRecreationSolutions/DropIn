import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";

const ReorderSchema = z.object({
  facility_id: z.string().uuid(),
  /** Every space in the facility, in the order the Spaces page shows them. */
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * PATCH /api/spaces/reorder — rewrite `display_order` for one facility.
 *
 * Takes the WHOLE facility's spaces rather than the pair that swapped. The
 * Spaces page groups by department and then by zone, so "the order" a user sees
 * is the flattened render order across all of those sections — sending only the
 * two moved rows would renumber them relative to a sequence the server cannot
 * see, and the session editors (which read one flat `display_order` list per
 * facility) would disagree with the page that set it.
 *
 * The ids must be exactly the facility's spaces — no more, no fewer. A partial
 * list is rejected rather than applied, because writing positions 1..N over a
 * subset silently reorders the rows that were left out.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Manager-level, NOT department-scoped like the rest of /api/spaces — and
  // deliberately so. This route rewrites `display_order` across the whole
  // facility, spanning every department in it (see the doc comment above for
  // why a partial list cannot be accepted). A coordinator reordering their own
  // department would be renumbering everyone else's spaces as a side effect,
  // so the operation belongs to whoever owns the building.
  const denied = requirePermission(membership, "facility:edit");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { facility_id, ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "Duplicate space in order" }, { status: 400 });
  }

  // Org scoping comes from this read, not from trusting the ids in the body.
  const { data: owned, error: readError } = await supabase
    .from("spaces")
    .select("id")
    .eq("org_id", membership.org_id)
    .eq("facility_id", facility_id);

  if (readError) {
    console.error("PATCH /api/spaces/reorder read failed:", readError);
    return NextResponse.json({ error: "Could not reorder spaces." }, { status: 500 });
  }

  const ownedIds = new Set((owned ?? []).map((s) => s.id));
  if (ownedIds.size !== ids.length || ids.some((id) => !ownedIds.has(id))) {
    return NextResponse.json(
      { error: "Order must list exactly the spaces in this facility." },
      { status: 400 }
    );
  }

  // One statement per row: Supabase has no bulk positional update, and upsert
  // would need every NOT NULL column echoed back. N is a facility's space
  // count — tens, not thousands.
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase
        .from("spaces")
        .update({ display_order: index + 1 })
        .eq("id", id)
        .eq("org_id", membership.org_id)
    )
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("PATCH /api/spaces/reorder write failed:", failed.error);
    return NextResponse.json({ error: "Could not reorder spaces." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
