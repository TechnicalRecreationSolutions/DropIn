import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

/**
 * GET /api/invitations/[token] — what the accept screen renders.
 *
 * Public by design: an invitee is not signed in yet, and usually has no
 * account at all. What makes that safe is that it goes through
 * `public.invitation_by_token()`, a SECURITY DEFINER function, rather than a
 * SELECT on the table.
 *
 * That distinction is the whole of migration 023's CRITICAL finding. An RLS
 * `USING` clause is evaluated per row against the session, never against the
 * caller's `WHERE` — so a policy of "readable while pending" plus a client-side
 * `.eq('token', t)` narrows the *response* and not the *grant*, and hands every
 * pending invitation on the platform, tokens included, to anyone holding the
 * publishable key. Inside a function the token is an argument that must be
 * known up front.
 *
 * **Do not replace this with a query against `staff_invitations`.**
 *
 * The function returns no token, no scope rows, and only a masked email.
 *
 * POST /api/invitations/[token]/accept is the other half.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // This route answers "is this token real?" to an unauthenticated caller,
  // which makes it a guessing oracle. The tokens are 32 random bytes, so
  // guessing is not a practical attack and this is belt-and-braces — migration
  // 023 asked for it by name, and it costs nothing.
  const ip = await getClientIp();
  if (!(await checkRateLimit("invitationLookup", ip))) {
    return rateLimitResponse("invitationLookup");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_by_token", { p_token: token });

  if (error) {
    return NextResponse.json({ error: "Could not load this invitation." }, { status: 500 });
  }

  const invitation = Array.isArray(data) ? data[0] : data;

  // One response for every failure: no such token, already accepted, expired.
  // Distinguishing them would tell a guesser that a token exists but is spent,
  // which is more than a stranger needs to know.
  if (!invitation) {
    return NextResponse.json(
      { error: "This invitation link is not valid. It may have expired or already been used." },
      { status: 404 }
    );
  }

  return NextResponse.json({ invitation });
}
