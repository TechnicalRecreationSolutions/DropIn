import type { Database } from "./database.types";

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrgMembership =
  Database["public"]["Tables"]["org_memberships"]["Row"];
export type Facility = Database["public"]["Tables"]["facilities"]["Row"];
export type Program = Database["public"]["Tables"]["programs"]["Row"];
export type WidgetConfig =
  Database["public"]["Tables"]["widget_configs"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];

export type PlanTier = "free" | "pro" | "enterprise";

export type OrgRole = "owner" | "admin" | "member";

/** The current user's org context, loaded once after login */
export type OrgContext = {
  org: Organization;
  membership: OrgMembership;
  subscription: Subscription | null;
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
