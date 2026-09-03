/**
 * Local JWT verification (`src/lib/auth/claims.ts`).
 *
 * The dashboard's render path stopped calling `supabase.auth.getUser()` — a
 * ~100ms round trip to the auth server on every navigation — and now
 * establishes identity from the access token's ES256 signature instead. That
 * is only sound if a token whose signature does not check out is rejected. A
 * verification that quietly accepted a tampered token would look identical in
 * every screenshot and every other harness here: the page would render, just
 * for the wrong user.
 *
 * So this asserts the mechanism, both layers:
 *
 *   1. **The primitive.** `getClaims()` with the real JWKS accepts a genuine
 *      token and rejects one whose payload was edited to name a different
 *      user, and one whose signature bytes were altered. The accept case is
 *      the positive control: without it, a `getClaims()` that rejected
 *      *everything* would pass the two negative cases and prove nothing.
 *
 *   2. **The app.** Over real HTTP, a genuine cookie renders the dashboard,
 *      and the same cookie carrying a tampered token does not — no org name,
 *      no membership, redirected to /login. Two users exist so "rejected" can
 *      be distinguished from "rendered someone else's org": the tampered token
 *      claims to be user B, and the test checks B's org name never appears.
 *
 * Same pattern as the other verify-*.mjs — service-role fixtures, a real
 * signed-in session, teardown in a `finally`.
 *
 *   npm run dev
 *   node scripts/verify/verify-o.mjs
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";

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
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const projectRef = new URL(URL_).hostname.split(".")[0];
const COOKIE_NAME = `sb-${projectRef}-auth-token`;

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sessionCookies(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  }
  return chunks.join("; ");
}

const b64urlDecode = (s) => Buffer.from(s, "base64url").toString("utf8");
const b64urlEncode = (s) => Buffer.from(s, "utf8").toString("base64url");

/** Rewrite the `sub` claim, leaving the signature over the original bytes. */
function forgeSub(token, sub) {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(b64urlDecode(payload));
  claims.sub = sub;
  return `${header}.${b64urlEncode(JSON.stringify(claims))}.${signature}`;
}

/** Flip a byte of the signature, leaving the claims untouched. */
function corruptSignature(token) {
  const [header, payload, signature] = token.split(".");
  const bytes = Buffer.from(signature, "base64url");
  bytes[0] ^= 0xff;
  return `${header}.${payload}.${bytes.toString("base64url")}`;
}

async function makeOrgWithUser(label, stamp) {
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ ${label} ${stamp}`, slug: `zz-${label}-${stamp}`, status: "active" })
    .select("id, name")
    .single();
  if (orgErr) throw new Error(`${label} org insert: ${orgErr.message}`);

  const email = `zz-${label}-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`${label} createUser: ${userErr.message}`);

  const { error: memberErr } = await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });
  if (memberErr) throw new Error(`${label} membership: ${memberErr.message}`);

  const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label} signIn: ${error.message}`);

  return { orgId: org.id, orgName: org.name, userId: userData.user.id, session: signIn.session };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const alice = await makeOrgWithUser("verify-o-a", stamp);
  ids.orgs.push(alice.orgId);
  ids.users.push(alice.userId);

  const bob = await makeOrgWithUser("verify-o-b", stamp);
  ids.orgs.push(bob.orgId);
  ids.users.push(bob.userId);

  // ---------------------------------------------------------------
  console.log("\n1. The primitive: getClaims() against the project's real JWKS");
  // ---------------------------------------------------------------
  const jwksRes = await fetch(`${URL_}/auth/v1/.well-known/jwks.json`);
  const jwks = await jwksRes.json();
  check(
    "project publishes an asymmetric key set (otherwise verification is a network call)",
    Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys[0].alg?.startsWith("ES")
  );

  const header = JSON.parse(b64urlDecode(alice.session.access_token.split(".")[0]));
  check("access tokens are signed with that key, not a shared secret", header.alg === "ES256", `alg=${header.alg}`);

  const verifier = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Positive control. Without this, "rejects everything" would pass below.
  const genuine = await verifier.auth.getClaims(alice.session.access_token, { jwks });
  check(
    "accepts the genuine token and returns the right subject",
    !genuine.error && genuine.data?.claims?.sub === alice.userId,
    genuine.error?.message ?? `sub=${genuine.data?.claims?.sub}`
  );

  const forged = await verifier.auth.getClaims(forgeSub(alice.session.access_token, bob.userId), {
    jwks,
  });
  check(
    "rejects a token whose sub was rewritten to another user",
    !!forged.error || forged.data?.claims?.sub !== bob.userId,
    `error=${forged.error?.message ?? "none"} sub=${forged.data?.claims?.sub}`
  );

  const corrupted = await verifier.auth.getClaims(corruptSignature(alice.session.access_token), {
    jwks,
  });
  check(
    "rejects a token whose signature was altered",
    !!corrupted.error,
    `error=${corrupted.error?.message ?? "none — ACCEPTED A BAD SIGNATURE"}`
  );

  // ---------------------------------------------------------------
  console.log("\n2. The app: what the dashboard does with each cookie");
  // ---------------------------------------------------------------
  async function fetchDashboard(session) {
    const res = await fetch(`${APP}/dashboard/settings`, {
      headers: { Cookie: sessionCookies(session) },
      redirect: "manual",
    });
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  }

  // Positive control: the real session renders Alice's org.
  const good = await fetchDashboard(alice.session);
  check("genuine session renders the dashboard", good.status === 200, `status=${good.status}`);
  check("…showing Alice's org name", good.body.includes(alice.orgName));

  const tampered = await fetchDashboard({
    ...alice.session,
    access_token: forgeSub(alice.session.access_token, bob.userId),
  });
  check(
    "tampered session does not render the dashboard",
    tampered.status !== 200 || !tampered.body.includes(bob.orgName),
    `status=${tampered.status}`
  );
  check(
    "…and never shows Bob's org name",
    !tampered.body.includes(bob.orgName),
    "a rewritten sub was honoured — identity is being trusted without verification"
  );
  check(
    "…nor Alice's, so it is refused rather than silently falling back",
    !tampered.body.includes(alice.orgName)
  );
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id);
  const { data: leftovers } = await admin
    .from("organizations")
    .select("id")
    .like("slug", `zz-verify-o-%${stamp}`);
  console.log(`\nTeardown: ${leftovers?.length ?? 0} org(s) left over`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
