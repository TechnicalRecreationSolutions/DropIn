import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getClaims } from "@/lib/auth/claims";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import AcceptInvitation from "@/components/staff/AcceptInvitation";
import type { InvitableRole } from "@/types/app.types";

export const metadata = { title: "Join your team" };

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

/**
 * The accept screen. **Public** — the proxy guards only `/dashboard` and
 * `/admin`, which is what lets an invitee who has no account at all reach it.
 *
 * The lookup goes through `public.invitation_by_token()`, a SECURITY DEFINER
 * function, and never through a query against `staff_invitations`. That
 * distinction is migration 023's CRITICAL finding: an RLS `USING` clause is
 * evaluated per row against the session and never against the caller's
 * `WHERE`, so "readable while pending" plus a client-side `.eq('token', …)`
 * narrows the response and not the grant — handing every pending invitation on
 * the platform, tokens included, to anyone with the publishable key.
 *
 * The function returns no token, no scope rows, and a masked email.
 *
 * Both the token lookup and the session read happen inside the Suspense
 * boundary below, never in this component's body. `params` and `getClaims()`
 * are both request data, and touching either out here would stop the route
 * prerendering a static shell at all — the same constraint the dashboard
 * chrome works around in DashboardChromeSections.tsx.
 */
export default function InvitePage({ params }: InvitePageProps) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-5">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" aria-busy="true" />}>
          <InviteBody params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function InviteBody({ params }: InvitePageProps) {
  const { token } = await params;
  const supabase = await createClient();

  const [{ data }, claims] = await Promise.all([
    supabase.rpc("invitation_by_token", { p_token: token }),
    getClaims(),
  ]);

  const invitation = Array.isArray(data) ? data[0] : data;

  // One message for every failure — unknown token, already accepted, expired.
  // Telling a stranger which of those applies confirms that a guessed token
  // exists, which is more than the screen needs to do its job.
  if (!invitation) {
    return (
      <>
        <h1 className="text-2xl font-bold text-foreground">This invitation is not valid</h1>
        <p className="text-sm text-muted-foreground">
          The link may have expired, or it may already have been used. Ask whoever invited you
          to send a new one.
        </p>
      </>
    );
  }

  const role = invitation.role as InvitableRole;

  return (
    <>
      <h1 className="text-2xl font-bold text-foreground">Join {invitation.org_name}</h1>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-sm font-medium text-foreground">
          You&apos;ve been invited as {ROLE_LABELS[role]}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
        {invitation.scope_count > 0 && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {invitation.scope_count}{" "}
            {role === "coordinator"
              ? invitation.scope_count === 1
                ? "department"
                : "departments"
              : invitation.scope_count === 1
                ? "facility"
                : "facilities"}{" "}
            assigned to you.
          </p>
        )}
      </div>

      <AcceptInvitation
        token={token}
        maskedEmail={invitation.email}
        signedInAs={claims?.email ?? null}
      />
    </>
  );
}
