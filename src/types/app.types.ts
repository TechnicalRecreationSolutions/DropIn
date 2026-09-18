import type { Database } from "./database.types";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrgMembership =
  Database["public"]["Tables"]["org_memberships"]["Row"];
export type MembershipScope =
  Database["public"]["Tables"]["membership_scopes"]["Row"];
export type StaffInvitation =
  Database["public"]["Tables"]["staff_invitations"]["Row"];
export type InvitationScope =
  Database["public"]["Tables"]["invitation_scopes"]["Row"];
export type Facility = Database["public"]["Tables"]["facilities"]["Row"];
export type Department = Database["public"]["Tables"]["departments"]["Row"];
export type ScheduleGroup =
  Database["public"]["Tables"]["schedule_groups"]["Row"];
export type WidgetConfig =
  Database["public"]["Tables"]["widget_configs"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];

export type PlanTier = "free" | "pro" | "enterprise";

/**
 * The staff role ladder. Defined in database.types.ts, where it mirrors the
 * CHECK constraint from 055_staff_roles_and_scopes.sql, and re-exported here
 * because this is where the rest of the app looks for it.
 */
export type { OrgRole, InvitableRole } from "./database.types";

/**
 * The department and facility ids the current user is scoped to.
 *
 * `departmentIds` is a coordinator's scope. `facilityIds` is an aux staffer's,
 * UNIONED with the facilities containing a coordinator's departments — derived
 * server-side by `user_scope_facility_ids()`, so nobody maintains two lists.
 *
 * **Both are empty for an owner or manager, and that means "not scoped",
 * not "sees nothing".** Never filter on these without checking the role first;
 * `isScoped()` in lib/auth/roles.ts is the guard that gets this right.
 */
export type OrgScopes = {
  departmentIds: string[];
  facilityIds: string[];
};

/** The current user's org context, loaded once after login */
export type OrgContext = {
  org: Organization;
  membership: OrgMembership;
  subscription: Subscription | null;
  scopes: OrgScopes;
};

/** API error shape returned by all route handlers */
export type ApiError = {
  error: string;
  details?: Record<string, string[]>;
};

/** Generic paginated response wrapper */
export type PaginatedResponse<T> = {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
};
