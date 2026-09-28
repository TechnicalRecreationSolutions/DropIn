import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const SignupSchema = z.object({
  // 72 is bcrypt's input limit; Supabase silently ignores bytes past it.
  password: z.string().min(8).max(72),
});

const INVALID = "This invitation link is not valid. It may have expired or already been used.";

/**
 * POST /api/invitations/[token]/signup — `{ password }`
 *
 * The invitee's whole onboarding: create their account, sign them in, and
 * accept the invitation, in one request. They never type an email address or
 * an organization name — the address is the one the invitation was sent to,
 * read here server-side, and the organization is the one that invited them.
 *
 * ## The deliberate exception to finding M5
 *
 * The user is created **already confirmed** (`email_confirm: true`), with no
 * Supabase confirmation email. M5 closed exactly that on ordinary signup,
 * because there it let anyone register under someone else's address. It is
 * acceptable here, and only here, because:
 *
 *   - the address was chosen by a manager of the inviting org, not by the
 *     caller — the caller supplies nothing but a password;
 *   - the token is 32 random bytes, single-use, expires in 7 days, and is
 *     delivered to that address (once RESEND_* is configured — until then a
 *     manager copies it by hand, and is vouching for where they send it);
 *   - the account can do nothing but join the org that sent the invitation.
 *
 * Recorded in docs/SECURITY.md. It also takes staff onboarding out of
 * Supabase's built-in mailer (~2 sends/hour, launch blocker 1) entirely.
 *
 * ## What the caller can learn
 *
 * A 409 says an account already exists for the invited address. Only a token
 * holder can ask, only about the one address that token names, and the answer
 * is what they need ("sign in instead") — so this is not the enumeration M4
 * closed on /api/auth/signup, where anyone could ask about any address.
 *
 * ## Never leaves a stranded account
 *
 * If acceptance fails after the user was created — the invitation was revoked
 * or used in the gap between the lookup and the accept — the account made by
 * this request is deleted again. Otherwise the invitee would hold a login with
 * no membership, and the dashboard would send them to create an organization
 * of their own: the exact trap this route replaces.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = await getClientIp();
  if (!(await checkRateLimit("invitationSignup", ip))) {
    return rateLimitResponse("invitationSignup");
  }

  const { token } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a password of at least 8 characters." },
      { status: 400 }
    );
  }
  const { password } = parsed.data;

  // Service role, and a lookup by token — the thing migration 023 forbids is a
  // client-side `.eq('token', …)` under RLS, where the filter narrows the
  // response and not the grant. Here nothing reaches the browser but a yes/no.
  const admin = createAdminClient();
  const { data: invitation } = await admin
    .from("staff_invitations")
    .select("id, email, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (
    !invitation ||
    invitation.accepted_at !== null ||
    new Date(invitation.expires_at) <= new Date()
  ) {
    return NextResponse.json({ error: INVALID }, { status: 404 });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    if (
      createError?.code === "email_exists" ||
      /already (been )?registered|already exists/i.test(createError?.message ?? "")
    ) {
      return NextResponse.json(
        {
          error: "You already have a Dropin account with this address. Sign in to accept.",
          code: "account_exists",
        },
        { status: 409 }
      );
    }
    if (createError?.code === "weak_password") {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }
    console.error(`Invitation signup: createUser failed: ${createError?.message}`);
    return NextResponse.json(
      { error: "Could not create your account. Please try again." },
      { status: 500 }
    );
  }

  const userId = created.user.id;

  // The cookie-bound client, so the session it opens is the browser's.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password,
  });

  // accept_invitation() is the same function the signed-in "Accept and join"
  // button calls, so every rule it enforces — address match, expiry, single
  // use, scopes copied in the same transaction — applies here unchanged.
  const { error: acceptError } = signInError
    ? { error: signInError }
    : await supabase.rpc("accept_invitation", { p_token: token });

  if (acceptError) {
    await supabase.auth.signOut().catch(() => {});
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.error(`Invitation signup: rolled back new user: ${acceptError.message}`);
    return signInError
      ? NextResponse.json(
          { error: "Could not create your account. Please try again." },
          { status: 500 }
        )
      : NextResponse.json({ error: INVALID }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
