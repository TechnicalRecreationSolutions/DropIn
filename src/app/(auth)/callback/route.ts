import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase Auth callback handler.
 * Exchanges the auth code for a session after:
 *   - Email confirmation
 *   - OAuth sign-in (if added in future)
 *   - Magic link sign-in (if added in future)
 */
/**
 * Only same-origin relative paths may be redirected to.
 *
 * `next` is attacker-controllable — anyone can send someone a /callback link —
 * so it must not be able to bounce a freshly-authenticated user off-site. A
 * leading "//" or "/\" is rejected because browsers read those as
 * protocol-relative URLs pointing at another host.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth failed — redirect to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
