/**
 * The one place the command centre's URL is built.
 *
 * Every route that used to lead to a schedule — the tree nav, the overview's
 * recent-activity list, the facility and department pages, the old
 * schedule-group detail pages — now points here instead, so a schedule opens
 * in exactly one place regardless of how it was reached.
 */

/** Sentinel department for schedules in a facility that has departments but that belong to none. */
export const NO_DEPARTMENT = "none";

/**
 * Which workspace tab to land on. Omitted means Schedule, the default.
 *
 * Defined here rather than beside the tab strip because `page.tsx` is a
 * server component: a plain array exported from a `"use client"` module
 * arrives there as a client-reference stub, not a real array, and calling
 * `.includes` on it throws at request time.
 */
export type WorkspaceTab = "schedule" | "spaces" | "map" | "widget";

export const WORKSPACE_TABS: WorkspaceTab[] = ["schedule", "spaces", "map", "widget"];

export function isWorkspaceTab(value: string | undefined): value is WorkspaceTab {
  return !!value && (WORKSPACE_TABS as string[]).includes(value);
}

export function commandCentreHref(scope: {
  facilityId?: string | null;
  /** A real department id, or NO_DEPARTMENT. */
  departmentId?: string | null;
  scheduleGroupId?: string | null;
  tab?: WorkspaceTab;
}): string {
  const params = new URLSearchParams();
  if (scope.facilityId) params.set("facility", scope.facilityId);
  if (scope.departmentId) params.set("department", scope.departmentId);
  if (scope.scheduleGroupId) params.set("schedule", scope.scheduleGroupId);
  if (scope.tab && scope.tab !== "schedule") params.set("tab", scope.tab);
  const query = params.toString();
  return query ? `/dashboard/schedule?${query}` : "/dashboard/schedule";
}

/**
 * The scope a schedule group opens at — its department comes along so the
 * department filter reflects where the schedule actually lives rather than
 * resetting to "all".
 */
export function scheduleGroupScope(sg: {
  facility_id: string;
  department_id: string | null;
  id: string;
}) {
  return {
    facilityId: sg.facility_id,
    departmentId: sg.department_id ?? NO_DEPARTMENT,
    scheduleGroupId: sg.id,
  };
}
