import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Route protection rules:
 *
 * /dashboard/*  — requires an active session + org membership.
 *                 Redirects to /login if unauthenticated.
 *                 Redirects to /dashboard/org/onboarding if no org found.
 *
 * /admin/*      — requires superadmin role (raw_user_meta_data->>'role' = 'superadmin').
 *                 Returns 403 if authenticated but not superadmin.
 *
 * /widget/*     — public, no auth. CORS headers set in next.config.ts.
 *
 * All other routes — public. Session is refreshed silently if present.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Refresh session and get current user (safe — uses getUser() not getSession())
  const { supabaseResponse, user, supabase } = await updateSession(request);

  // ── Dashboard routes ────────────────────────────────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Check org membership (skip for the onboarding page itself)
    if (!pathname.startsWith("/dashboard/org/onboarding")) {
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (!membership) {
        return NextResponse.redirect(
          new URL("/dashboard/org/onboarding", request.url)
        );
      }
    }
  }

  // ── Admin routes ────────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const isSuperAdmin =
      user.user_metadata?.role === "superadmin" ||
      user.app_metadata?.role === "superadmin";

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
     * - _next/static (Next.js static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - /embed/* (widget embed script — public JS, no middleware needed)
     * - /images/* (static public images)
     */
    "/((?!_next/static|_next/image|favicon.ico|embed|images).*)",
  ],
};
