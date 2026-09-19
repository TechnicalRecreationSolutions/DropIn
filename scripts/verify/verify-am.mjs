/**
 * Impersonation guards (migration 057).
 *
 * Two orgs, each with a signed-in owner: "real" (verified) and "impersonator"
 * (not). Both create a facility with the same name through the real route.
 *
 *  1. **Slug collision.** Before 057 the impersonator's facility took the same
 *     slug, /facility/[slug]'s maybeSingle() errored (PGRST116), and the REAL
 *     centre's page stopped rendering. After: the impersonator gets -2, both
 *     pages render their own facility, a re-save doesn't move a suffixed URL,
 *     and the database itself refuses a duplicate (the mechanism, not just the
 *     route's behaviour).
 *  2. **Platform columns.** Before 057 an owner could set approved_at, or
 *     lift their own suspension, with the publishable key. After: the trigger
 *     refuses both, while an ordinary profile edit (the positive control) and
 *     a service-role write still succeed.
 *  3. **Directory + indexing.** An unverified org's listed facility is absent
 *     from the directory API and its page is noindex; the verified org's is
 *     present and indexable. Verifying the impersonator (plus a save, which
 *     expires the caches) flips both — proving the gate is verification, not
 *     something else about the fixture.
 *
 * Before 057 is applied, sections 1–2 run as controls that must SEE the holes,
 * and section 3 skips.
 *
 *   npm run dev
 *   node scripts/verify/verify-am.mjs [--app=http://localhost:3000]
 *
 * Makes a few real Nominatim requests (every create geocodes).
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

function sessionCookie(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  return chunks.join("; ");
}

async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function page(path) {
  const res = await fetch(`${APP}${path}`);
  return { status: res.status, html: await res.text() };
}
const isNoindex = (html) => /<meta[^>]+name="robots"[^>]+noindex/.test(html);

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

/** An org with a signed-in owner: `db` is their own RLS-bound client. */
async function makeOwnedOrg(tag, { verified }) {
  const { data: org, error } = await admin.from("organizations").insert({
    name: `ZZ ${tag} ${stamp}`, slug: `zz-am-${tag}-${stamp}`, status: "active",
    ...(verified ? { approved_at: new Date().toISOString() } : {}),
  }).select("id").single();
  if (error) throw error;
  ids.orgs.push(org.id);

  const email = `zz-am-${tag}-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr) throw uErr;
  ids.users.push(u.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: u.user.id, role: "owner" });

  const db = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data: signIn, error: sErr } = await db.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { id: org.id, db, cookie: sessionCookie(signIn.session) };
}

async function main() {
  const { error: probeErr } = await admin.from("organizations_public").select("is_verified").limit(1);
  const applied = !probeErr;
  console.log(applied
    ? "  migration 057: applied\n"
    : "  migration 057: NOT applied — sections 1-2 run as hole-detection controls, section 3 skips\n");

  const real = await makeOwnedOrg("real", { verified: applied });
  const fake = await makeOwnedOrg("fake", { verified: false });

  // Distinct descriptions so a rendered page says whose facility it is.
  const name = `ZZ Crystal Pool ${stamp}`;
  const body = (description, extra = {}) => JSON.stringify({
    name, description, address_line1: "2275 Quadra St", city: "Victoria", province: "BC",
    postal_code: "V8T 4C3", is_published: true, listed_in_directory: true, photo_urls: [], ...extra,
  });
  const REAL_MARK = `real-centre-${stamp}`;
  const FAKE_MARK = `impersonator-${stamp}`;

  // ---------------------------------------------------------------------------
  console.log("1. Slug collision");
  const realCreate = await api("/api/facilities", real.cookie, { method: "POST", body: body(REAL_MARK) });
  check("real org creates its facility", realCreate.status === 200, JSON.stringify(realCreate.body));
  const fakeCreate = await api("/api/facilities", fake.cookie, { method: "POST", body: body(FAKE_MARK) });
  check("impersonator's same-named facility saves too", fakeCreate.status === 200, JSON.stringify(fakeCreate.body));

  const slugOf = async (id) => (await admin.from("facilities").select("slug").eq("id", id).single()).data.slug;
  const realSlug = await slugOf(realCreate.body.facilityId);
  const fakeSlug = await slugOf(fakeCreate.body.facilityId);
  const realPage = await page(`/facility/${realSlug}`);

  if (!applied) {
    check("control: pre-057 the impersonator lands on the SAME slug", realSlug === fakeSlug, `${realSlug} vs ${fakeSlug}`);
    check("control: …and the real centre's page stops rendering it", !realPage.html.includes(REAL_MARK));
  } else {
    check("impersonator is given a different slug (-2)", fakeSlug === `${realSlug}-2`, `${realSlug} vs ${fakeSlug}`);
    check("real centre's page still renders the real facility", realPage.status === 200 && realPage.html.includes(REAL_MARK) && !realPage.html.includes(FAKE_MARK));
    const fakePage = await page(`/facility/${fakeSlug}`);
    check("impersonator's page renders only its own facility", fakePage.html.includes(FAKE_MARK) && !fakePage.html.includes(REAL_MARK));

    const resave = await api("/api/facilities", fake.cookie, {
      method: "POST", body: body(FAKE_MARK, { facilityId: fakeCreate.body.facilityId }),
    });
    check("re-saving a suffixed facility keeps its URL", resave.status === 200 && (await slugOf(fakeCreate.body.facilityId)) === fakeSlug);

    const direct = await admin.from("facilities").insert({
      org_id: fake.id, name, slug: realSlug, address_line1: "1 Test St", city: "Victoria",
      province: "BC", postal_code: "V0V 0V0", is_published: true,
    });
    check("the database itself refuses a duplicate slug across orgs (23505)", direct.error?.code === "23505", direct.error?.message ?? "insert accepted");
  }

  // ---------------------------------------------------------------------------
  console.log("\n2. Platform-owned columns");
  const profile = await real.db.from("organizations").update({ description: `edited ${stamp}` }).eq("id", real.id).select("id");
  check("control: an owner can still edit their org profile", !profile.error && profile.data?.length === 1, profile.error?.message);

  const selfApprove = await fake.db.from("organizations").update({ approved_at: new Date().toISOString() }).eq("id", fake.id).select("id");
  const afterSelfApprove = (await admin.from("organizations").select("approved_at").eq("id", fake.id).single()).data;
  if (!applied) {
    check("control: pre-057 an owner CAN self-verify with the publishable key", afterSelfApprove.approved_at !== null);
    await admin.from("organizations").update({ approved_at: null }).eq("id", fake.id);
  } else {
    check("an owner cannot self-verify (42501)", selfApprove.error?.code === "42501", selfApprove.error?.message ?? "update accepted");
    check("…and approved_at is still null", afterSelfApprove.approved_at === null);
  }

  await admin.from("organizations").update({ status: "suspended" }).eq("id", fake.id);
  const unsuspend = await fake.db.from("organizations").update({ status: "active" }).eq("id", fake.id).select("id");
  const afterUnsuspend = (await admin.from("organizations").select("status").eq("id", fake.id).single()).data;
  if (!applied) {
    check("control: pre-057 a suspended owner CAN lift their own suspension", afterUnsuspend.status === "active");
  } else {
    check("a suspended owner cannot un-suspend themselves (42501)", unsuspend.error?.code === "42501", unsuspend.error?.message ?? "update accepted");
    check("…and status is still suspended", afterUnsuspend.status === "suspended");
  }
  const restore = await admin.from("organizations").update({ status: "active" }).eq("id", fake.id).select("status").single();
  check("the service role can still change status", restore.data?.status === "active", restore.error?.message);

  // ---------------------------------------------------------------------------
  console.log("\n3. Directory + indexing");
  if (!applied) {
    skipped("directory and noindex gates", "need 057's is_verified");
    return;
  }

  const listedIds = async () => {
    const r = await api("/api/public/v1/directory", null);
    if (r.status !== 200) throw new Error(`directory API ${r.status}: ${JSON.stringify(r.body)}`);
    return new Set(r.body.facilities.map((f) => f.id));
  };

  let listed = await listedIds();
  check("verified org's listed facility is in the directory", listed.has(realCreate.body.facilityId));
  check("unverified org's listed facility is NOT", !listed.has(fakeCreate.body.facilityId));

  const realMeta = await page(`/facility/${realSlug}`);
  let fakeMeta = await page(`/facility/${fakeSlug}`);
  check("verified org's page is indexable", !isNoindex(realMeta.html));
  check("unverified org's page is noindex", isNoindex(fakeMeta.html));

  // The flip: same fixture, only verification changes.
  const verify = await admin.from("organizations").update({ approved_at: new Date().toISOString() }).eq("id", fake.id).select("id");
  check("the service role can verify (the verify-org script's write)", !verify.error && verify.data?.length === 1, verify.error?.message);
  const bust = await api("/api/facilities", fake.cookie, { method: "POST", body: body(FAKE_MARK, { facilityId: fakeCreate.body.facilityId }) });
  check("a facility save (which expires the caches) succeeds", bust.status === 200, JSON.stringify(bust.body));

  // Poll briefly: `next dev` applies tag expiry with a short lag (see
  // feedback on dev cache lag). A flip that never comes still fails.
  let appeared = false, indexable = false, waited = 0;
  for (; waited <= 10000 && !(appeared && indexable); waited += 1000) {
    if (waited) await new Promise((r) => setTimeout(r, 1000));
    appeared ||= (await listedIds()).has(fakeCreate.body.facilityId);
    indexable ||= !isNoindex((await page(`/facility/${fakeSlug}`)).html);
  }
  check("once verified, the same facility appears in the directory", appeared, "not within 10 s");
  check("…and its page becomes indexable", indexable, "not within 10 s");
  if (appeared && indexable && waited > 0) console.log(`  (flip took ~${waited / 1000} s)`);
}

try {
  await main();
} catch (e) {
  fail++;
  console.error(e);
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id);
  console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}`);
  process.exit(fail ? 1 : 0);
}
