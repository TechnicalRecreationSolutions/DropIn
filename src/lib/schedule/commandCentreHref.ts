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

export interface ScopeSelection {
  facilityId?: string | null;
  /** A real department id, or NO_DEPARTMENT. */
  departmentId?: string | null;
  scheduleGroupId?: string | null;
}

/**
 * The facility/department/schedule query string shared by every page that
 * reads its scope from these three params — kept in one place so the param
 * names (`facility`/`department`/`schedule`) can't drift between routes.
 */
export function scopeQueryString(scope: ScopeSelection): string {
  const params = new URLSearchParams();
  if (scope.facilityId) params.set("facility", scope.facilityId);
  if (scope.departmentId) params.set("department", scope.departmentId);
  if (scope.scheduleGroupId) params.set("schedule", scope.scheduleGroupId);
  return params.toString();
}

export function commandCentreHref(scope: ScopeSelection): string {
  const query = scopeQueryString(scope);
  return query ? `/dashboard/schedule?${query}` : "/dashboard/schedule";
}

/** Link to the dedicated Spaces page, optionally scoped to a facility. */
export function spacesHref(facilityId?: string | null): string {
  return facilityId ? `/dashboard/spaces?facility=${facilityId}` : "/dashboard/spaces";
}

/** Link to the dedicated Map (floorplan editor) page, optionally scoped to a facility. */
export function mapHref(facilityId?: string | null): string {
  return facilityId ? `/dashboard/map?facility=${facilityId}` : "/dashboard/map";
}

/** Link to the dedicated Session templates page, optionally scoped to a facility/department/schedule. */
export function sessionsHref(scope: ScopeSelection): string {
  const query = scopeQueryString(scope);
  return query ? `/dashboard/sessions?${query}` : "/dashboard/sessions";
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
