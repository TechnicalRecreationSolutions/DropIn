import type { NoticeCategory, NoticeSeverity } from "@/types/app.types";

/**
 * A status an organization can post, and the departments it is offered to.
 *
 * The library is `notice_templates` (migration 064). This module is the
 * client-safe half: the shape both the status page and the Settings library
 * share, and the rule for which templates a department sees. Imports nothing at
 * runtime, so the harness can load it under --experimental-strip-types.
 */
export interface StatusTemplate {
  id: string;
  label: string;
  category: NoticeCategory;
  severity: NoticeSeverity;
  headline: string;
  body: string | null;
  display_order: number;
  /** Empty means every department, and the whole-facility composer. */
  departmentIds: string[];
}

/**
 * The templates offered when posting about `departmentId` at a facility whose
 * departments are `facilityDepartmentIds`.
 *
 * - A department: templates for every department, plus the ones assigned to it.
 * - The whole facility (`null`): templates for every department, plus any
 *   assigned to a department in this building — a manager posting a building-
 *   wide pool closure at a pool is a real case, a tennis-only status at a
 *   building with no tennis is not.
 */
export function templatesFor(
  templates: StatusTemplate[],
  departmentId: string | null,
  facilityDepartmentIds: string[]
): StatusTemplate[] {
  return templates.filter((t) => {
    if (t.departmentIds.length === 0) return true;
    if (departmentId) return t.departmentIds.includes(departmentId);
    return t.departmentIds.some((id) => facilityDepartmentIds.includes(id));
  });
}

/** Rows from `notice_templates` + `notice_template_departments`, joined. */
export function joinTemplates(
  rows: {
    id: string;
    label: string;
    category: NoticeCategory;
    severity: NoticeSeverity;
    headline: string;
    body: string | null;
    display_order: number;
  }[],
  links: { template_id: string; department_id: string }[]
): StatusTemplate[] {
  const byTemplate = new Map<string, string[]>();
  for (const l of links) {
    byTemplate.set(l.template_id, [...(byTemplate.get(l.template_id) ?? []), l.department_id]);
  }
  return rows
    .map((r) => ({ ...r, departmentIds: byTemplate.get(r.id) ?? [] }))
    .sort((a, b) => a.display_order - b.display_order || a.label.localeCompare(b.label));
}
