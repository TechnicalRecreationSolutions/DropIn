/**
 * Password-only invitation signup (/api/invitations/[token]/signup).
 *
 *   npm run dev
 *   node scripts/verify/verify-bd.mjs
 *
 * ## What this proves
 *
 * Until 2026-09-27 a signed-out invitee was sent to /signup, which dropped the
 * token, made them type an organization name and an email, and after
 * confirmation parked them on "Set up your organization". Now the invite page
 * asks for a password and nothing else, and one request creates the account,
 * signs them in and accepts.
 *
 * The assertions check the MECHANISM, not the response code:
 *   - the auth user exists, with the invited address, already confirmed;
 *   - the membership exists with the invited role AND the invited scope;
 *   - the cookies the route set open /dashboard as that user, without being
 *     sent to /dashboard/org/onboarding;
 *   - the password works for an ordinary sign-in afterwards.
 *
 * And every refusal leaves the database as it found it: an expired or reused
 * token creates no user, and an existing account neither consumes the
 * invitation nor gains a membership.
 *
 * Service role builds fixtures only. The invitee acts as an anonymous browser.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP ?? "http://localhost:3000";
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0,
  fail = 0;
const check = (l, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${l}`);
  } else {
    fail++;
    console.log(`  FAIL  ${l}${d ? ` — ${d}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };
const PASSWORD = `Zk!${stamp}aA9`;

async function canSignIn(email, password) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  return !error;
}

const postSignup = (token, body) =>
  fetch(`${APP}/api/invitations/${token}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function makeInvitation(orgId, invitedBy, email, extra = {}) {
  const { data, error } = await admin
    .from("staff_invitations")
    .insert({ org_id: orgId, email, role: "coordinator", invited_by: invitedBy, ...extra })
    .select("id, token")
    .single();
  if (error) throw new Error(`invitation: ${error.message}`);
  return data;
}

async function main() {
  // A harness run makes several POSTs from one IP, and the route allows 10 per
  // 10 minutes. Clearing only this route's buckets keeps re-runs honest
  // without touching any other limiter.
  await admin.from("rate_limits").delete().like("bucket", "invitationSignup:%");

  // ── Fixtures ─────────────────────────────────────────────────────────────
  const orgName = `ZZ Invite ${stamp}`;
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: orgName, slug: `zz-invite-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const ownerEmail = `zz-owner-${stamp}@example.invalid`;
  const { data: ownerU } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  ids.users.push(ownerU.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: ownerU.user.id, role: "owner", email: ownerEmail });

  const { data: facility } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ Pool ${stamp}`,
      slug: `zz-invpool-${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();
  const { data: dept } = await admin
    .from("departments")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: "Aquatics",
      slug: `zz-invaq-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  const inviteeEmail = `zz-invitee-${stamp}@example.invalid`;
  const inv = await makeInvitation(org.id, ownerU.user.id, inviteeEmail);
  await admin
    .from("invitation_scopes")
    .insert({ invitation_id: inv.id, org_id: org.id, department_id: dept.id });

  // ══ 1. The page asks for a password, not an org or an email ══════════════
  section("1. Invite page, signed out");
  const page = await (await fetch(`${APP}/invite/${inv.token}`)).text();
  check("renders the password form", page.includes("Create password and join"));
  check("no link to /signup (the old detour)", !/href="\/signup/.test(page));
  check("no organization-name field", !/id="orgName"/.test(page));
  check("shows the masked address, not the full one", !page.includes(inviteeEmail));

  // ══ 2. Refusals that must create nothing ═════════════════════════════════
  section("2. Refusals");
  const short = await postSignup(inv.token, { password: "short" });
  check("password under 8 chars → 400", short.status === 400, `got ${short.status}`);

  const bogus = await postSignup("0".repeat(64), { password: PASSWORD });
  check("unknown token → 404", bogus.status === 404, `got ${bogus.status}`);

  const expiredEmail = `zz-expired-${stamp}@example.invalid`;
  const expired = await makeInvitation(org.id, ownerU.user.id, expiredEmail, {
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const expRes = await postSignup(expired.token, { password: PASSWORD });
  check("expired token → 404", expRes.status === 404, `got ${expRes.status}`);
  check("expired token created no account", !(await canSignIn(expiredEmail, PASSWORD)));

  // ══ 3. The happy path ════════════════════════════════════════════════════
  section("3. Create password and join");
  const ok = await postSignup(inv.token, { password: PASSWORD });
  const okBody = await ok.json().catch(() => ({}));
  check("valid token + password → 200", ok.status === 200, `got ${ok.status} ${JSON.stringify(okBody)}`);

  const { data: membership } = await admin
    .from("org_memberships")
    .select("id, user_id, role, email, membership_scopes(department_id)")
    .eq("org_id", org.id)
    .eq("email", inviteeEmail)
    .maybeSingle();
  if (membership) ids.users.push(membership.user_id);

  check("membership created in the inviting org", !!membership);
  check("with the invited role", membership?.role === "coordinator", membership?.role);
  check(
    "with the invited scope copied across",
    membership?.membership_scopes?.length === 1 &&
      membership.membership_scopes[0].department_id === dept.id,
    JSON.stringify(membership?.membership_scopes)
  );

  if (membership) {
    const { data: u } = await admin.auth.admin.getUserById(membership.user_id);
    check("auth user has the invited address", u?.user?.email === inviteeEmail, u?.user?.email);
    check("auth user is already confirmed", !!u?.user?.email_confirmed_at);
  }

  const { data: invAfter } = await admin
    .from("staff_invitations")
    .select("accepted_at")
    .eq("id", inv.id)
    .single();
  check("invitation stamped accepted", !!invAfter.accepted_at);

  // The route's own cookies must BE a session: open the dashboard with them.
  const cookies = ok.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("sb-"));
  check("route set a Supabase session cookie", cookies.length > 0);
  const dash = await fetch(`${APP}/dashboard`, {
    headers: { Cookie: cookies.join("; ") },
    redirect: "manual",
  });
  const dashLocation = dash.headers.get("location") ?? "";
  check(
    "those cookies open /dashboard (no redirect to login or onboarding)",
    dash.status === 200,
    `got ${dash.status} → ${dashLocation}`
  );
  const dashHtml = dash.status === 200 ? await dash.text() : "";
  check("dashboard is the inviting org's", dashHtml.includes(orgName));

  check("the chosen password signs in afterwards", await canSignIn(inviteeEmail, PASSWORD));

  // ══ 4. Single use ════════════════════════════════════════════════════════
  section("4. Replay");
  const replay = await postSignup(inv.token, { password: PASSWORD });
  check("same token again → 404", replay.status === 404, `got ${replay.status}`);
  const replayPage = await (await fetch(`${APP}/invite/${inv.token}`)).text();
  check("invite page now says not valid", replayPage.includes("This invitation is not valid"));

  // ══ 5. Existing account: told to sign in, nothing consumed ═══════════════
  section("5. Invited address already has an account");
  const { data: org2 } = await admin
    .from("organizations")
    .insert({ name: `ZZ Invite2 ${stamp}`, slug: `zz-invite2-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org2.id);
  // The owner of org 1 already has an account; org 2 invites them.
  const inv2 = await makeInvitation(org2.id, ownerU.user.id, ownerEmail);
  const exists = await postSignup(inv2.token, { password: "Different!Pass9" });
  const existsBody = await exists.json().catch(() => ({}));
  check("existing account → 409", exists.status === 409, `got ${exists.status}`);
  check("with code account_exists", existsBody.code === "account_exists", JSON.stringify(existsBody));

  const { data: inv2After } = await admin
    .from("staff_invitations")
    .select("accepted_at")
    .eq("id", inv2.id)
    .single();
  check("invitation NOT consumed", inv2After.accepted_at === null);
  const { count: m2 } = await admin
    .from("org_memberships")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org2.id);
  check("no membership granted in org 2", m2 === 0, `count ${m2}`);
  check("existing password unchanged", await canSignIn(ownerEmail, PASSWORD));
  check("attacker's password rejected", !(await canSignIn(ownerEmail, "Different!Pass9")));
}

main()
  .catch((e) => {
    fail++;
    console.error(e);
  })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
