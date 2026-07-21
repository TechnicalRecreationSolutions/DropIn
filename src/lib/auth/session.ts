import { createClient } from "@/lib/supabase/server";
import type { OrgContext, OrgMembership } from "@/types/app.types";

/**
 * Returns the authenticated user from a Server Component or Route Handler.
 * Returns null if no session exists.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns the current user's org context (org + membership + subscription).
 * If the user belongs to multiple orgs, returns the first by joined_at.
 * Returns null if the user has no org membership.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membershipRow } = await supabase
    .from("org_memberships")
    .select("*")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle() as { data: OrgMembership | null };

  if (!membershipRow) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", membershipRow.org_id)
    .single();

  if (!org) return null;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("org_id", membershipRow.org_id)
    .maybeSingle();

  return {
    org,
    membership: membershipRow,
    subscription: subscription ?? null,
  };
}
