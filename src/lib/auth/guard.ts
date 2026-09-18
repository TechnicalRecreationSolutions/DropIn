import { NextResponse } from "next/server";
import { can, isReadOnly, ROLE_LABELS, requiresScope } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";
import type { RouteMembership } from "@/lib/auth/membership";

/**
 * The 403 half of every Route Handler's authorization, in one place.
 *
 * Before migration 055 each route inlined
 * `if (!["owner","admin"].includes(membership.role))`. That was correct with
 * two tiers and is actively wrong with four: `"manager"` is not in that array,
 * so every one of those ~30 checks would have started refusing managers —
 * silently, and **without a single type error**, because `["owner","admin"]`
 * infers as `string[]` and `.includes()` happily takes any string. TypeScript
 * cannot catch this class of mistake, which is the argument for routing it all
 * through one function that owns the comparison.
 *
 * Returns a `NextResponse` to return, or `null` to continue:
 *
 *   const denied = requirePermission(membership, "department:create");
 *   if (denied) return denied;
 *
 * **This is the second layer, not the only one.** RLS in Postgres is
 * authoritative — the publishable key is in the browser bundle, so a caller can
 * always skip these routes and talk to PostgREST directly. What this adds is an
 * explanation instead of an opaque policy failure.
 */
export function requirePermission(
  membership: RouteMembership,
  permission: Permission,
  /**
   * The department the target row belongs to. Required whenever
   * `requiresScope(permission)` — pass `null` explicitly for a row that has no
   * department (a schedule group or space with `department_id IS NULL`), which
   * is a real answer meaning "owner/manager territory", not a missing one.
   */
  departmentId?: string | null
): NextResponse | null {
  const actor = { role: membership.role, scopes: membership.scopes };

  if (can(actor, permission, departmentId)) return null;

  return NextResponse.json({ error: explain(membership, permission, departmentId) }, { status: 403 });
}

/**
 * Why the answer was no, in words a person can act on.
 *
 * A bare "Forbidden" is what the coordinator who cannot find their schedule
 * will report as a bug, so each branch says which of the three distinct
 * reasons applies: wrong role, right role but outside your departments, or the
 * row has no department at all.
 */
function explain(
  membership: RouteMembership,
  permission: Permission,
  departmentId?: string | null
): string {
  const label = ROLE_LABELS[membership.role];

  if (isReadOnly(membership.role)) {
    return `${label} accounts can view schedules but cannot change them.`;
  }

  if (membership.role === "coordinator" && requiresScope(permission)) {
    if (departmentId === null) {
      // The NULL-department case from docs/PLAN-staff-roles.md §7 — and the one
      // most likely to look like a bug, since the row is plainly there.
      return "This belongs to the whole organization rather than to a department, so only a Manager can change it.";
    }
    if (membership.scopes.departmentIds.length === 0) {
      return "Your account has no departments assigned yet. Ask a Manager to assign one.";
    }
    return "That department is not one of yours.";
  }

  return `${label} accounts cannot do this.`;
}
