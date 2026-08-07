import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils/slugify";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const OnboardSchema = z.object({
  orgName: z.string().min(2).max(100),
});

/**
 * POST /api/auth/onboard-org
 *
 * For an already-authenticated user with no organization membership yet
 * (e.g. an auth user created outside the normal /signup flow) — creates an
 * organization + owner membership for their existing session, without
 * creating a new auth user. Mirrors /api/auth/signup's org-creation steps,
 * minus the auth-user creation.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Org creation moved here from /api/auth/signup, and the limit has to move
  // with it — otherwise a confirmed account could mint organizations freely.
  // Keyed on user id: the caller is authenticated, and org slugs are a shared
  // namespace worth protecting per-identity rather than per-IP.
  if (!(await checkRateLimit("onboardOrg", user.id))) {
    return rateLimitResponse("onboardOrg");
  }

  const body = await request.json().catch(() => null);
  const parsed = OnboardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Already has a membership — nothing to do, just send them to the dashboard.
  const { data: existingMembership } = await supabase
    .from("org_memberships")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existingMembership) {
    return NextResponse.json({ ok: true, redirect: "/dashboard" });
  }

  const { orgName } = parsed.data;
  const slug = slugify(orgName);

  // Service role — a fresh user has no org yet, so no RLS policy would allow
  // this insert under their own session.
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: orgName, slug, status: "active", country: "CA" })
    .select("id")
    .single();

  if (orgError) {
    if (orgError.code === "23505") {
      return NextResponse.json(
        { error: "An organization with that name already exists. Please choose a different name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not create organization. Please try again." }, { status: 500 });
  }

  const { error: membershipError } = await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" });

  if (membershipError) {
    // Roll back the org so a retry doesn't collide on the slug.
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: "Could not complete setup. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, redirect: "/dashboard" });
}
