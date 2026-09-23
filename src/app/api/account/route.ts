import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The signed-in person's own account: their password, their email address, and
 * signing every other device out.
 *
 * ## Why this is a route and not three calls from the browser
 *
 * `supabase.auth.updateUser()` works from the browser, and the first draft of
 * this did exactly that. Two things made it a server route instead:
 *
 *   1. **Changing a password without proving you know the old one** is a
 *      session-hijack upgrade: anyone who gets a borrowed laptop with a live
 *      session changes the password and owns the account. Supabase's "secure
 *      password change" setting enforces reauthentication when it is on, and it
 *      is a project setting nothing in this repo controls — so the check has to
 *      exist here whether or not the dashboard has it enabled.
 *   2. **`org_memberships.email` is a SNAPSHOT**, not a live join (migration
 *      055 §2). Change the auth email and the Staff page keeps showing the old
 *      one until somebody notices. The snapshot has to be reconciled, and 055
 *      §7 forbids a member from updating their own membership row at all — so
 *      the reconciliation needs the service-role client, which cannot exist in
 *      the browser.
 *
 * ## The reauthentication is a second sign-in, on a throwaway client
 *
 * Verifying the current password means calling `signInWithPassword`. Doing that
 * on the request-scoped server client would write a fresh session into the
 * response cookies as a side effect of a CHECK — and if the password update
 * then failed, the caller would be left holding a rotated session for no
 * reason. A separate client with `persistSession: false` verifies and is thrown
 * away.
 */

const PasswordSchema = z.object({
  action: z.literal("password"),
  currentPassword: z.string().min(1),
  // Supabase's own floor is 6; 10 is this app's, and the form states it before
  // the request rather than after.
  newPassword: z.string().min(10).max(200),
});

const EmailSchema = z.object({
  action: z.literal("email"),
  currentPassword: z.string().min(1),
  email: z.string().email(),
});

const SignOutOthersSchema = z.object({
  action: z.literal("sign-out-others"),
});

const SyncSchema = z.object({
  action: z.literal("sync-email"),
});

const BodySchema = z.discriminatedUnion("action", [
  PasswordSchema,
  EmailSchema,
  SignOutOthersSchema,
  SyncSchema,
]);

export async function POST(request: Request) {
  const supabase = await createClient();

  // getUser(), not getClaims(): this needs the account's real current email to
  // reauthenticate against, and a token minted before an email change carries
  // the old one.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the fields and try again. New passwords must be at least 10 characters." },
      { status: 400 }
    );
  }

  const body = parsed.data;

  if (body.action === "sync-email") {
    const changed = await syncMembershipEmail(user.id, user.email ?? null);
    return NextResponse.json({ ok: true, changed });
  }

  if (body.action === "sign-out-others") {
    // 'others' revokes every refresh token EXCEPT this request's, so the person
    // who just clicked it is not signed out of the page they clicked it on.
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      return NextResponse.json({ error: "Could not sign out your other devices." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!user.email) {
    return NextResponse.json(
      { error: "This account has no email address, so it cannot be reauthenticated here." },
      { status: 400 }
    );
  }

  const reauthenticated = await verifyPassword(user.email, body.currentPassword);
  if (!reauthenticated) {
    return NextResponse.json({ error: "That is not your current password." }, { status: 403 });
  }

  if (body.action === "password") {
    if (body.newPassword === body.currentPassword) {
      return NextResponse.json(
        { error: "The new password is the same as the current one." },
        { status: 400 }
      );
    }

    const { error } = await supabase.auth.updateUser({ password: body.newPassword });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // action === "email"
  if (body.email.toLowerCase() === user.email.toLowerCase()) {
    return NextResponse.json({ error: "That is already your email address." }, { status: 400 });
  }

  // Nothing changes yet. Supabase sends a confirmation link to the NEW address
  // (and, when "Secure email change" is on, to the old one as well); the
  // address only moves once it is clicked. Saying "check your email" rather
  // than "saved" is therefore the only honest confirmation, and the snapshot is
  // reconciled later by `sync-email` on the next visit to this page.
  const { error } = await supabase.auth.updateUser({ email: body.email });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, pending: true });
}

/**
 * True when this password is currently correct for this address.
 *
 * A throwaway client with `persistSession: false` — see the note above for why
 * this must not touch the request's own session.
 */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const { createClient: createRawClient } = await import("@supabase/supabase-js");
  const probe = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { error } = await probe.auth.signInWithPassword({ email, password });
  return !error;
}

/**
 * Brings `org_memberships.email` back in line with the account's real address.
 *
 * Service-role, and this is the sixth file in the app that holds one — the
 * reason is narrow and worth stating: migration 055 §7 makes a membership row
 * un-writable by its own holder (`user_id <> auth.uid()` in both the USING and
 * WITH CHECK clauses), because that is what stops self-promotion. A person
 * updating their own email snapshot is the one legitimate case that rule
 * forbids, so it goes through a key that ignores RLS — filtered to that user's
 * own rows, touching one column, and only when it already disagrees.
 *
 * Returns how many rows moved, which is 0 on almost every call. That is the
 * expected answer: this runs on every visit to the Account page precisely so
 * that the one visit after a confirmed email change finds the drift.
 */
async function syncMembershipEmail(userId: string, email: string | null): Promise<number> {
  if (!email) return 0;

  const admin = createAdminClient();

  // Read, filter here, then write by id. A `.neq("email", email)` filter would
  // silently skip rows where the snapshot is NULL — SQL's `<>` is unknown
  // against NULL, never true — and a NULL snapshot is exactly the row that
  // needs filling. Doing the comparison in JavaScript makes that case ordinary
  // instead of a special one.
  const { data: rows, error: readError } = await admin
    .from("org_memberships")
    .select("id, email")
    .eq("user_id", userId);

  if (readError || !rows) return 0;

  const stale = rows.filter((row) => row.email !== email).map((row) => row.id);
  if (stale.length === 0) return 0;

  const { data, error } = await admin
    .from("org_memberships")
    .update({ email })
    .in("id", stale)
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}
