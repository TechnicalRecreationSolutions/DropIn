import type { OrgRole } from "@/types/app.types";

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** Returns true if the given role meets the minimum required role */
export function hasRole(userRole: OrgRole, requiredRole: OrgRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export function isOwner(role: OrgRole): boolean {
  return role === "owner";
}

export function isAdmin(role: OrgRole): boolean {
  return hasRole(role, "admin");
}
