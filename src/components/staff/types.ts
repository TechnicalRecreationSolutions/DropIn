import type { OrgRole, InvitableRole } from "@/types/app.types";

/** A scope row as the staff page reads it — exactly one field is set. */
export interface ScopeRow {
  department_id: string | null;
  facility_id: string | null;
}

export interface MemberRow {
  id: string;
  user_id: string;
  role: OrgRole;
  /**
   * A SNAPSHOT of the address taken when they joined (migration 055 §2), not a
   * live join — `auth.users` is unreadable under RLS, so there is no other way
   * for this list to say who anyone is. Null for a membership created before
   * that column existed and never backfilled.
   */
  email: string | null;
  display_name: string | null;
  joined_at: string;
  membership_scopes: ScopeRow[] | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: InvitableRole;
  expires_at: string;
  created_at: string;
  invited_by: string;
  invitation_scopes: ScopeRow[] | null;
}

export interface FacilityOption {
  id: string;
  name: string;
}

export interface DepartmentOption {
  id: string;
  name: string;
  facility_id: string;
}
