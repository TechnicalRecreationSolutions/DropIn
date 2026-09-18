import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { slugify } from "@/lib/utils/slugify";

const UpdateDepartmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  is_published: z.boolean().optional(),
});

/**
 * PATCH /api/departments/[id] — update a department's name/description/publish state.
 * DELETE /api/departments/[id] — remove a department.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "department:edit", id);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateDepartmentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const payload = {
    ...parsed.data,
    ...(parsed.data.name ? { slug: slugify(parsed.data.name) } : {}),
  };

  const { data, error } = await supabase
    .from("departments")
    .update(payload)
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A department with this name already exists at that facility." : "Could not update department." },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Department not found" }, { status: 404 });

  return NextResponse.json({ department: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "department:delete", id);
  if (denied) return denied;

  // THE CASCADE TRAP (migration 055 §5.3).
  //
  // membership_scopes.department_id is ON DELETE CASCADE, so deleting a
  // department silently strips it from every coordinator scoped to it — and a
  // coordinator whose LAST department goes drops to zero scopes, which under
  // §4 means zero access. They keep their login and their role badge and can
  // reach nothing, with no event anywhere saying why.
  //
  // Failing closed is right. Doing it silently is not, so the names come back
  // with the response and the UI says them out loud. This is reported, never
  // enforced: the delete still happens, because "you cannot remove a
  // department until you have reassigned its coordinators" would be a worse
  // trap than the one it replaces.
  const { data: affected } = await supabase
    .from("membership_scopes")
    .select("membership_id, org_memberships(email, role)")
    .eq("department_id", id);

  const strandedNames: string[] = [];
  for (const row of (affected ?? []) as unknown as {
    membership_id: string;
    org_memberships: { email: string | null; role: string } | null;
  }[]) {
    // Only this department left? Then they are about to lose everything.
    const { count } = await supabase
      .from("membership_scopes")
      .select("id", { count: "exact", head: true })
      .eq("membership_id", row.membership_id);

    if ((count ?? 0) <= 1 && row.org_memberships?.email) {
      strandedNames.push(row.org_memberships.email);
    }
  }

  const { error } = await supabase
    .from("departments")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id);

  if (error) return NextResponse.json({ error: "Could not delete department" }, { status: 500 });
  return NextResponse.json({ ok: true, stranded: strandedNames });
}
