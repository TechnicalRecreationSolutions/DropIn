import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const SignupSchema = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Messages that reveal an account already exists. Never surfaced to the caller.
 *
 * With the project's `mailer_autoconfirm` disabled, Supabase already obfuscates
 * duplicate signups — it returns a user object with an empty `identities` array
 * and no error. This list is a backstop in case that setting is ever flipped, so
 * enumeration cannot come back silently through a config change.
 */
const EXISTENCE_LEAKING = [/already registered/i, /already exists/i, /user already/i];

/**
 * POST /api/auth/signup
 *
 * Creates an *unconfirmed* auth user and sends a confirmation email. The
 * organization is NOT created here — that happens at /dashboard/org/onboarding
 * once the user has proved they control the address (see
 * /api/auth/onboard-org).
 *
 * This route previously called `admin.auth.admin.createUser({ email_confirm:
 * true })`, which overrode the project's own mailer_autoconfirm=false setting
 * and marked every address confirmed without checking it — anyone could
 * register an organization under someone else's email (finding M5). It also
 * answered 409 "An account with that email already exists", making registered
 * addresses enumerable (finding M4).
 *
 * Both are fixed by using the ordinary `auth.signUp()` flow and returning an
 * identical response whatever happens.
 */
export async function POST(request: Request) {
  // Before any work: this route triggers an outbound email and creates an auth
  // user, so an unthrottled loop is both a cost and a mail-reputation attack.
  const ip = await getClientIp();
  if (!(await checkRateLimit("signup", ip))) {
    return rateLimitResponse("signup");
  }

  const body = await request.json().catch(() => null);

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { orgName, email, password } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Carried so onboarding can prefill the name the user already typed.
      // user_metadata is user-writable, so this is display-only — the actual
      // org creation re-validates it server-side in /api/auth/onboard-org.
      data: { org_name: orgName },
      emailRedirectTo: `${APP_URL}/callback?next=/dashboard/org/onboarding`,
    },
  });

  // Every outcome below returns the identical body and status.
  //
  // Surfacing *any* Supabase-side error here reopens enumeration, in an
  // inverted and more dangerous form. A signup for a NEW address sends a
  // confirmation email; a signup for an EXISTING one does not. So when the
  // mailer errors — "email rate limit exceeded" being the easy one, since an
  // attacker can induce it just by signing up a few times — the new address
  // fails while the existing address succeeds. Error means "this address is
  // free", success means "this address is taken". Verified: that is exactly
  // what an earlier version of this handler did.
  //
  // The cost is real and accepted: if the mailer is genuinely broken, users are
  // told to check an inbox that receives nothing. That is a monitoring problem,
  // not a response-body problem — hence the loud log. Configuring real SMTP
  // (see docs/SECURITY.md, owner actions) removes the default project quota
  // that makes this likely.
  //
  // Note the caller can still get a 429, from the rate limiter above. That one
  // is keyed on IP and fires identically whether or not the address exists, so
  // it is not an oracle.
  if (error) {
    const leaksExistence = EXISTENCE_LEAKING.some((re) => re.test(error.message));
    console.error(
      `Signup did not complete (caller told it succeeded): ${error.message}` +
        (leaksExistence ? " [existing address]" : "")
    );
  }

  return NextResponse.json({ ok: true, emailSent: true });
}
