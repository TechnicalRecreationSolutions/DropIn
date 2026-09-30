import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { TemplatePatchSchema } from "@/lib/status/template-schema";

/**
 * PATCH  /api/notice-templates/[id] — change a status's words or departments.
 * DELETE /api/notice-templates/[id] — remove it from the library.
 *
 * Neither touches a notice already posted from it: posting copied the words,
 * and nothing links back (see migration 064). That is also why DELETE is hard —
 * there is no history hanging off a template to keep.
 *
 * `department_ids`, when sent, REPLACES the set. Omitted leaves it alone.
 */

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "notice-template:manage");
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = TemplatePatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { department_ids, ...fields } = parsed.data;

  const { data: template, error } = await supabase
    .from("notice_templates")
    .update({
      ...fields,
      ...(fields.body !== undefined ? { body: fields.body?.trim() ? fields.body.trim() : null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not save the status" }, { status: 400 });
  if (!template) return NextResponse.json({ error: "Status not found" }, { status: 404 });

  if (department_ids) {
    // Add the new set before removing the rest, so a failure part-way leaves
    // the status on the old and new departments together — never on none,
    // which would mean every department.
    if (department_ids.length > 0) {
      const { error: linkError } = await supabase
        .from("notice_template_departments")
        .upsert(
          department_ids.map((department_id) => ({ template_id: id, department_id })),
          { onConflict: "template_id,department_id", ignoreDuplicates: true }
        );
      if (linkError) {
        return NextResponse.json(
          { error: "One of those departments is not in your organization" },
          { status: 400 }
        );
      }
    }
    let remove = supabase.from("notice_template_departments").delete().eq("template_id", id);
    if (department_ids.length > 0) {
      remove = remove.not("department_id", "in", `(${department_ids.join(",")})`);
    }
    const { error: removeError } = await remove;
    if (removeError) {
      return NextResponse.json({ error: "Could not update the departments" }, { status: 500 });
    }
  }

  const { data: links } = await supabase
    .from("notice_template_departments")
    .select("department_id")
    .eq("template_id", id);

  return NextResponse.json({
    template: { ...template, departmentIds: (links ?? []).map((l) => l.department_id) },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const membership = await getAuthedMembership(supabase);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requirePermission(membership, "notice-template:manage");
  if (denied) return denied;

  const { data, error } = await supabase
    .from("notice_templates")
    .delete()
    .eq("id", id)
    .eq("org_id", membership.org_id)
    .select("id");

  if (error) return NextResponse.json({ error: "Could not delete the status" }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Status not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
