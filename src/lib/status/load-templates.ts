import type { createClient } from "@/lib/supabase/server";
import { NOTICE_PRESETS } from "./notice-presets";
import { joinTemplates, type StatusTemplate } from "./templates";

/**
 * An organization's status library, joined to its department assignments.
 *
 * `fromLibrary` is false when migration 064 has not been applied: the page
 * then offers the old built-in catalogue to everyone, and the Settings page
 * says the library is not switched on, rather than either one 500ing.
 */
export async function loadStatusTemplates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<{ templates: StatusTemplate[]; fromLibrary: boolean }> {
  const { data: rows, error } = await supabase
    .from("notice_templates")
    .select("id, label, category, severity, headline, body, display_order")
    .eq("org_id", orgId);

  if (error) return { templates: fallbackTemplates(), fromLibrary: false };
  if (!rows || rows.length === 0) return { templates: [], fromLibrary: true };

  const { data: links } = await supabase
    .from("notice_template_departments")
    .select("template_id, department_id")
    .in(
      "template_id",
      rows.map((r) => r.id)
    );

  return { templates: joinTemplates(rows, links ?? []), fromLibrary: true };
}

/**
 * The built-in catalogue shaped as templates, for a database without 064.
 * Ids are prefixed so nothing mistakes one for a row that can be edited.
 */
function fallbackTemplates(): StatusTemplate[] {
  return NOTICE_PRESETS.filter((p) => p.id !== "blank").map((p, i) => ({
    id: `preset:${p.id}`,
    label: p.label,
    category: p.category,
    severity: p.severity,
    headline: p.headline,
    body: p.body || null,
    display_order: i,
    departmentIds: [],
  }));
}

