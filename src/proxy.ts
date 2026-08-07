import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { perf } from "@/lib/perf";

/**
 * Route protection rules:
 *
 * /dashboard/*  — requires an active session.
 *                 Redirects to /login if unauthenticated.
 *                 Org-membership is checked in (dashboard)/layout.tsx, which
 *                 redirects to /dashboard/org/onboarding when absent.
 *
 * /admin/*      — requires superadmin role (raw_app_meta_data->>'role' = 'superadmin').
 *                 Returns 403 if authenticated but not superadmin.
 *
 * /widget/*     — public, no auth. CORS headers set in next.config.ts.
 *
 * All other routes — public. Session is refreshed silently if present.
 *
 * Deliberately kept to a single auth call. Next.js documents Proxy as being for
 * optimistic checks rather than "a full session management or authorization
 * solution" — the authoritative checks are RLS in Postgres plus the server
 * components that read the session. Every query added here is paid on every
 * navigation, so it must earn its place.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const t = perf(`proxy ${pathname}`);

  // Refresh session and get current user.
  // Must stay getUser() — getSession() reads the cookie without verifying it
  // against the auth server, so it can be spoofed by a crafted cookie.
  const { supabaseResponse, user } = await t.step("updateSession", () =>
    updateSession(request)
  );

  t.end();

  // ── Dashboard routes ────────────────────────────────────────────────────────
  if (pathname.startsWith("/dashboard") && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Admin routes ────────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // app_metadata ONLY. user_metadata is writable by the user themselves via
    // auth.updateUser(), so trusting it here would let any account reach /admin
    // by setting one field from the browser. Mirrors public.is_superadmin()
    // in migration 022 — both layers must read the same service-role-only field.
    const isSuperAdmin = user.app_metadata?.role === "superadmin";

    if (!isSuperAdmin) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (route handlers create their own Supabase client and call
     *   getUser() themselves; unlike Server Components they can write cookies,
     *   so they refresh the session without help from Proxy)
     * - _next (all framework-internal paths: static assets, image
     *   optimisation, and the dev HMR endpoint. _next/webpack-hmr is polled
     *   continuously in dev and was paying a full getUser() round trip on
     *   every poll. RSC payloads are not served from here — they are requested
     *   from the route's own URL — so nothing auth-relevant is excluded.)
     * - favicon.ico
     * - /embed/* (widget embed script — public JS, no auth needed)
     * - /images/* (static public images)
     */
    "/((?!api|_next|favicon.ico|embed|images).*)",
  ],
};
