import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { perf } from "@/lib/perf";
import type {
  OrgContext,
  OrgMembership,
  Organization,
  Subscription,
} from "@/types/app.types";

/**
 * Returns the authenticated user from a Server Component or Route Handler.
 * Returns null if no session exists.
 *
 * Wrapped in React's cache() so the layout and every page can call this
 * without re-hitting Supabase on each call within the same request.
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
};

export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const t = perf("getOrgContext");
  const supabase = await createClient();

  const user = await t.step("getUser", () => getUser());

  if (!user) {
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
  const { data } = await t.step("membership+org+subscription", () =>
    supabase
      .from("org_memberships")
      .select("*, organizations!inner(*, subscriptions(*))")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle()
  ) as unknown as { data: OrgContextRow | null };

  t.end();

  if (!data?.organizations) return null;

  const { organizations, ...membership } = data;
  const { subscriptions, ...org } = organizations;

  return {
    org,
    membership: membership as OrgMembership,
    subscription: Array.isArray(subscriptions)
      ? subscriptions[0] ?? null
      : subscriptions ?? null,
  };
});
