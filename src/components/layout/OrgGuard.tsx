import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { getClaims } from "@/lib/auth/claims";

/**
 * Enforces "signed in, and belongs to an org" for the dashboard.
 *
 * Renders nothing. It exists as a separate component so the layout does not
 * have to await the org context before rendering its shell — the guard runs
 * inside its own Suspense boundary while the static chrome is already on
 * screen. Unauthenticated users are redirected by the proxy long before this,
 * so in practice this only catches the signed-in-but-no-org case.
 */
export default async function OrgGuard() {
  const orgContext = await getOrgContext();
  if (orgContext) return null;

  // getOrgContext() returns null both for "no session" and "no org membership".
  // getClaims() is cache()d and already resolved, so this costs no round trip.
  const claims = await getClaims();
  redirect(claims ? "/dashboard/org/onboarding" : "/login");
}
