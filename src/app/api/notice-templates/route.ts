import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { TemplateSchema } from "@/lib/status/template-schema";

/**
 * The organization's status library (migration 064).
 *
 * POST /api/notice-templates — add a status, optionally limited to departments.
 *
 * Reads happen server-side in the pages that need them, so there is no GET.
 * Writes are owner/manager (`notice-template:manage`); RLS says the same with
 * `org_can_manage`, and a trigger refuses a department from another
 * organization.
 */

export async function POST(request: Request) {
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
  const parsed = TemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { department_ids, ...fields } = parsed.data;

  // New statuses go to the end of the list, where the person who just added
  // one will look for it.
  const { data: last } = await supabase
    .from("notice_templates")
    .select("display_order")
    .eq("org_id", membership.org_id)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: template, error } = await supabase
    .from("notice_templates")
    .insert({
      ...fields,
      body: fields.body?.trim() ? fields.body.trim() : null,
      org_id: membership.org_id,
      display_order: (last?.display_order ?? 0) + 1,
    })
    .select("*")
    .single();

  if (error || !template) {
    if (error?.code === "42P01" || error?.code === "PGRST205") {
      return NextResponse.json(
        { error: "The status library is not switched on yet (migration 064)." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not add the status" }, { status: 400 });
  }

  if (department_ids.length > 0) {
    const { error: linkError } = await supabase
      .from("notice_template_departments")
      .insert(department_ids.map((department_id) => ({ template_id: template.id, department_id })));
    if (linkError) {
      // Do not leave a status offered to everyone when it was meant for one
      // department — that is the exact problem this library exists to fix.
      await supabase.from("notice_templates").delete().eq("id", template.id);
      return NextResponse.json(
        { error: "One of those departments is not in your organization" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ template: { ...template, departmentIds: department_ids } }, { status: 201 });
}
