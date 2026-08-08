import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/types/app.types";

export type RouteMembership = { org_id: string; role: OrgRole };

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
 * and keeps the choice in one place for when a switcher does land.
 */
export async function getRouteMembership(
  supabase: ServerClient,
  userId: string
): Promise<RouteMembership | null> {
  const { data } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as RouteMembership | null) ?? null;
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
