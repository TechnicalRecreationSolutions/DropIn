import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/invitations/[token]/accept
 *
 * All of the work is `public.accept_invitation()` (migration 056 §4), which
 * runs as one transaction: validate, create the membership with the caller's
 * email snapshot, copy the invitation's scopes across, stamp `accepted_at`.
 *
 * Doing it in several round trips from here would have two failure modes and
 * both are silent:
 *
 *   membership created, scopes not  → signed in with zero access (recoverable)
 *   token consumed, membership not  → locked out, and NOT recoverable without
 *                                     database access
 *
 * So this route validates nothing the function already validates — including
 * that the signed-in address matches the invited one, which is what stops a
 * forwarded link working for whoever received it. Re-checking here would just
 * be a second copy to drift.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in with the address this invitation was sent to." },
      { status: 401 }
    );
  }

  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });

  if (error) {
    // The function raises with the reason already written for a person —
    // "This invitation has expired", "…was sent to a different email address".
    // Postgres prefixes nothing useful, so the message passes through.
    const message = error.message || "Could not accept this invitation.";
    // 42501 is insufficient_privilege (wrong address, not signed in);
    // 22023 is invalid_parameter_value (unknown, used, or expired token).
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const joined = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    ok: true,
    orgId: joined?.joined_org_id ?? null,
    role: joined?.joined_role ?? null,
  });
}
