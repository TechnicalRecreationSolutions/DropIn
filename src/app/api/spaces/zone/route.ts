import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";

const ZoneSchema = z.object({
  facility_id: z.string().uuid(),
  /** The department section the zone lives in — null for "Whole building". */
  department_id: z.string().uuid().nullable(),
  /** The label after this write. Same limits as the per-space routes. */
  zone_name: z.string().trim().min(1).max(60),
  /** The spaces that should carry the label afterwards. Empty dissolves the zone. */
  member_ids: z.array(z.string().uuid()).max(500),
  /**
   * The label the zone had before, when editing one that already exists.
   * Spaces still carrying it that are not in `member_ids` are un-labelled —
   * that is what makes a rename, a removed member and a dissolved zone all
   * the same write. Omitted when creating.
   */
  previous_zone_name: z.string().trim().min(1).max(60).optional(),
});

/**
 * PATCH /api/spaces/zone — set which spaces in one department carry a zone label.
 *
 * A zone is `spaces.zone_name`, a free-text label, not a row (migration 054;
 * see SpacesPanel). So "create a zone" cannot be an insert — it is stamping
 * the same label onto N spaces at once. Before this route the only way to do
 * that was N trips through the space edit form, typing the label each time.
 *
 * Scoped to ONE department on purpose. The Spaces page groups by department
 * first and zone second, so "Main Pool" under Aquatics and "Main Pool" under
 * Fitness are two different zones that happen to share a string; a rename of
 * one must not touch the other. It also makes the permission check a single
 * `space:write` on that department, the same one the per-space route makes.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ZoneSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { facility_id, department_id, zone_name, member_ids, previous_zone_name } = parsed.data;

  // A coordinator may manage only the spaces in their own departments; a
  // department-less section is owner/manager territory (null is a real answer).
  const denied = requirePermission(membership, "space:write", department_id);
  if (denied) return denied;

  if (new Set(member_ids).size !== member_ids.length) {
    return NextResponse.json({ error: "Duplicate space in zone" }, { status: 400 });
  }

  // Org and department scoping come from this read, not from trusting the ids
  // in the body: every member has to be a space of this facility AND this
  // department, or the label would leak into a section the caller was not
  // checked against.
  let sectionQuery = supabase
    .from("spaces")
    .select("id, zone_name")
    .eq("org_id", membership.org_id)
    .eq("facility_id", facility_id);
  sectionQuery = department_id
    ? sectionQuery.eq("department_id", department_id)
    : sectionQuery.is("department_id", null);

  const { data: section, error: readError } = await sectionQuery;
  if (readError) {
    console.error("PATCH /api/spaces/zone read failed:", readError);
    return NextResponse.json({ error: "Could not save the zone." }, { status: 500 });
  }

  const sectionIds = new Set((section ?? []).map((s) => s.id));
  if (member_ids.some((id) => !sectionIds.has(id))) {
    return NextResponse.json(
      { error: "Every space in a zone must belong to the same department." },
      { status: 400 }
    );
  }

  // Spaces leaving the zone: still labelled with the old name, not kept.
  const members = new Set(member_ids);
  const leaving = previous_zone_name
    ? (section ?? [])
        .filter((s) => s.zone_name === previous_zone_name && !members.has(s.id))
        .map((s) => s.id)
    : [];

  const writes = [];
  if (member_ids.length > 0) {
    writes.push(
      supabase
        .from("spaces")
        .update({ zone_name })
        .eq("org_id", membership.org_id)
        .in("id", member_ids)
    );
  }
  if (leaving.length > 0) {
    writes.push(
      supabase
        .from("spaces")
        .update({ zone_name: null })
        .eq("org_id", membership.org_id)
        .in("id", leaving)
    );
  }

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("PATCH /api/spaces/zone write failed:", failed.error);
    return NextResponse.json({ error: "Could not save the zone." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, labelled: member_ids.length, cleared: leaving.length });
}
