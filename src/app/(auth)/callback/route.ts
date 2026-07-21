import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase Auth callback handler.
 * Exchanges the auth code for a session after:
 *   - Email confirmation
 *   - OAuth sign-in (if added in future)
 *   - Magic link sign-in (if added in future)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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
