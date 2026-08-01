import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils/slugify";

const SignupSchema = z.object({
  orgName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

/**
 * POST /api/auth/signup
 *
 * Creates an auth user + organization + owner membership in one atomic
 * server-side operation. Uses the service role client for org/membership
 * writes because newly signed-up users have no RLS permissions yet.
 *
 * Steps:
 *   1. Validate input
 *   2. Create Supabase auth user
 *   3. Insert organization row (service role — bypasses RLS)
 *   4. Insert owner membership row (service role)
 *   5. Sign the user in so they have a live session
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { orgName, email, password } = parsed.data;
  const slug = slugify(orgName);

  const admin = createAdminClient();

  // 1. Create auth user via admin client so we get the user id immediately
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip email confirmation for now
    user_metadata: { org_name: orgName },
  });

  if (authError || !authData.user) {
    const msg = authError?.message ?? "";
    if (msg.includes("already registered") || msg.includes("already exists")) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create account. Please try again." }, { status: 500 });
  }

  const userId = authData.user.id;

  // 2. Create organization
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: orgName, slug, status: "active", country: "CA" })
    .select("id")
    .single();

  if (orgError) {
    // Roll back: delete the auth user we just created
    await admin.auth.admin.deleteUser(userId);
    if (orgError.code === "23505") {
      return NextResponse.json(
        { error: "An organization with that name already exists. Please choose a different name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not create organization. Please try again." }, { status: 500 });
  }

  // 3. Create owner membership
  const { error: membershipError } = await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userId, role: "owner" });

  if (membershipError) {
    // Roll back both
    await admin.from("organizations").delete().eq("id", org.id);
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: "Could not complete setup. Please try again." }, { status: 500 });
  }

  // 4. Sign the user in to establish a session cookie
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    // Account exists but session failed — they can just log in manually
    return NextResponse.json({ ok: true, redirect: "/login" });
  }

  return NextResponse.json({ ok: true, redirect: "/dashboard" });
}
