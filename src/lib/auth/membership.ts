import { createClient } from "@/lib/supabase/server";
import type { OrgRole, OrgScopes } from "@/types/app.types";
import type { Actor } from "@/lib/auth/roles";

export type RouteMembership = {
  org_id: string;
  role: OrgRole;
  /** The membership row's own id — what /api/staff/members/[id] addresses. */
  id: string;
  scopes: OrgScopes;
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Resolves the caller's org membership for a Route Handler.
 *
 * Every route used to inline this query with `.single()`, which is an error
 * for *any* user in more than one org: PostgREST returns PGRST116 rather than
 * a row, `membership` comes back null, and the route answers 403 to a user who
 * is legitimately a member. Nothing about the request is ambiguous — the route
 * just refused to pick.
 *
 * Picks the earliest membership by `joined_at`, the same "active org" rule
 * `getOrgContext()` uses for Server Components (`session.ts`). Both must agree:
 * if a page renders org A's data while its own mutation routes write to org B,
 * saves silently land in the wrong org. That shared ordering is the guarantee,
 * so change it in both places or neither.
 *
 * Not a real org switcher — that needs the active org to live in the session
 * rather than being derived. This makes multi-org users work instead of 403,
 * and keeps the choice in one place for when a switcher does land. Migration
 * 056 §6 has the consequence written out: someone who accepts an invitation to
 * a *second* org keeps landing in their first one.
 *
 * Since migration 055 this also carries the caller's **scopes**, because a role
 * alone no longer answers "may they?" — a coordinator passing the role check
 * still has to hold the department being written. Pass the result to
 * `toActor()` and ask `can()`; do not re-implement the comparison per route.
 */
export async function getRouteMembership(
  supabase: ServerClient,
  userId: string
): Promise<RouteMembership | null> {
  const { data } = (await supabase
    .from("org_memberships")
    .select(
      "id, org_id, role, membership_scopes(department_id, facility_id, departments(facility_id))"
    )
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle()) as unknown as {
    data:
      | {
          id: string;
          org_id: string;
          role: OrgRole;
          membership_scopes:
            | {
                department_id: string | null;
                facility_id: string | null;
                departments:
                  | { facility_id: string }
                  | { facility_id: string }[]
                  | null;
              }[]
            | null;
        }
      | null;
  };

  if (!data) return null;

  const departmentIds = new Set<string>();
  const facilityIds = new Set<string>();

  for (const row of data.membership_scopes ?? []) {
    if (row.department_id) departmentIds.add(row.department_id);
    if (row.facility_id) facilityIds.add(row.facility_id);

    // A coordinator's departments imply their buildings — the same derivation
    // `user_scope_facility_ids()` performs in SQL, so the two cannot drift.
    const dept = row.departments;
    if (Array.isArray(dept)) {
      for (const d of dept) if (d?.facility_id) facilityIds.add(d.facility_id);
    } else if (dept?.facility_id) {
      facilityIds.add(dept.facility_id);
    }
  }

  return {
    id: data.id,
    org_id: data.org_id,
    role: data.role,
    scopes: {
      departmentIds: [...departmentIds],
      facilityIds: [...facilityIds],
    },
  };
}

/**
 * `getRouteMembership` plus the auth lookup, for the many routes that do
 * exactly `getUser()` then membership. Returns null when either is missing —
 * callers that must distinguish 401 from 403 should call the two separately.
 */
export async function getAuthedMembership(
  supabase: ServerClient
): Promise<RouteMembership | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return getRouteMembership(supabase, user.id);
}

/** Narrows a membership to what `can()` needs. */
export function toActor(membership: RouteMembership): Actor {
  return { role: membership.role, scopes: membership.scopes };
}
