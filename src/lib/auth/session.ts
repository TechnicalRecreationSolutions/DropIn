import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getClaims } from "@/lib/auth/claims";
import { perf } from "@/lib/perf";
import type {
  OrgContext,
  OrgMembership,
  Organization,
  Subscription,
  OrgScopes,
} from "@/types/app.types";

/**
 * Returns the full authenticated user record from the auth server, or null.
 *
 * This is a network round trip (~100ms) every time it is called, so it is for
 * the cases that genuinely need fields that are not in the access token —
 * `app_metadata`, identities, confirmation timestamps.
 *
 * **For "who is this request", use `getClaims()` instead.** It verifies the
 * same token locally in ~1ms and carries `sub` and `email`, which is all the
 * rendering path here ever wanted. See `lib/auth/claims.ts`.
 *
 * Wrapped in React's cache() so callers within one request share the trip.
 */
export const getUser = cache(async () => {
  const t = perf("getUser(rsc)");
  const supabase = await createClient();
  const {
    data: { user },
  } = await t.step("auth.getUser", () => supabase.auth.getUser());
  t.end();
  return user;
});

/**
 * Returns the current user's org context (org + membership + subscription).
 * If the user belongs to multiple orgs, returns the first by joined_at.
 * Returns null if the user has no org membership.
 *
 * Wrapped in React's cache() — the dashboard layout and every dashboard page
 * call this independently, so without memoization each navigation reruns
 * this 3-query chain twice per request.
 */
/**
 * Shape of the single nested select below. The generated Database types don't
 * model PostgREST's embedded resources, so the row is described explicitly and
 * cast once — the same pattern used for relational selects elsewhere in the app.
 */
type OrgContextRow = OrgMembership & {
  organizations:
    | (Organization & { subscriptions: Subscription | Subscription[] | null })
    | null;
  membership_scopes:
    | {
        department_id: string | null;
        facility_id: string | null;
        departments: { facility_id: string } | { facility_id: string }[] | null;
      }[]
    | null;
};

export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const t = perf("getOrgContext");
  const supabase = await createClient();

  // Identity comes from the verified access token, not from a call to the auth
  // server: the only thing needed below is the user id, and fetching it over
  // the network cost ~100ms on every dashboard navigation.
  const claims = await t.step("claims", () => getClaims());

  if (!claims) {
    t.end();
    return null;
  }

  // One round trip for membership + org + subscription.
  //
  // Both org_memberships.org_id and subscriptions.org_id are FKs to
  // organizations(id), so PostgREST can embed the whole chain in a single
  // request. subscriptions.org_id is UNIQUE, so it embeds as a to-one object —
  // but PostgREST has historically returned an array for this shape, so the
  // unwrap below tolerates both.
  //
  // This replaces a 3-request sequential chain. Against hosted Supabase each
  // hop cost ~85ms of network latency regardless of how trivial the query was,
  // so the chain alone added ~255ms to every dashboard navigation.
  // `membership_scopes` rides along on the same request rather than costing a
  // fourth hop. The nested `departments(facility_id)` is what makes a
  // coordinator's facility scope DERIVED rather than a second list someone has
  // to keep in sync — same union `user_scope_facility_ids()` computes in SQL.
  const { data } = await t.step("membership+org+subscription+scopes", () =>
    supabase
      .from("org_memberships")
      .select(
        "*, organizations!inner(*, subscriptions(*)), membership_scopes(department_id, facility_id, departments(facility_id))"
      )
      .eq("user_id", claims.sub)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle()
  ) as unknown as { data: OrgContextRow | null };

  t.end();

  if (!data?.organizations) return null;

  const { organizations, membership_scopes, ...membership } = data;
  const { subscriptions, ...org } = organizations;

  return {
    org,
    membership: membership as OrgMembership,
    subscription: Array.isArray(subscriptions)
      ? subscriptions[0] ?? null
      : subscriptions ?? null,
    scopes: toScopes(membership_scopes),
  };
});

/**
 * Flattens the embedded scope rows into two id lists.
 *
 * Both lists come back **empty for an owner or manager**, who hold no scope
 * rows. That means "not scoped", never "sees nothing" — see `isScoped()` in
 * lib/auth/roles.ts, which is the guard every caller must go through.
 */
function toScopes(
  rows:
    | {
        department_id: string | null;
        facility_id: string | null;
        departments?: { facility_id: string } | { facility_id: string }[] | null;
      }[]
    | null
): OrgScopes {
  const departmentIds = new Set<string>();
  const facilityIds = new Set<string>();

  for (const row of rows ?? []) {
    if (row.department_id) departmentIds.add(row.department_id);
    if (row.facility_id) facilityIds.add(row.facility_id);

    // A coordinator's departments imply their buildings. PostgREST returns an
    // embedded to-one either as an object or as a one-element array depending
    // on how it resolved the relationship, so tolerate both — the same unwrap
    // the subscriptions embed above does, for the same reason.
    const dept = row.departments;
    if (Array.isArray(dept)) {
      for (const d of dept) if (d?.facility_id) facilityIds.add(d.facility_id);
    } else if (dept?.facility_id) {
      facilityIds.add(dept.facility_id);
    }
  }

  return {
    departmentIds: [...departmentIds],
    facilityIds: [...facilityIds],
  };
}
