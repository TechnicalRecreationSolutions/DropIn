/**
 * The public directory API — GET /api/public/v1/directory (phase 2 of the
 * directory plan in docs/PLAN.md).
 *
 * What has to be proven, in order of how quietly it would fail:
 *
 *  1. **Only what a centre chose to list.** Published + listed + an active
 *     organization. Each exclusion (unlisted, unpublished, a pending org) sits
 *     beside a positive control from the same run, because `[]` from a
 *     working filter and `[]` from a broken read look identical.
 *
 *  2. **Being signed in changes nothing.** The data comes from a cookie-free
 *     shared cache and the response is marked `public`, so a member's own
 *     unpublished-but-listed facility must not show up for them either — if
 *     it did, a CDN could hand that response to a stranger.
 *
 *  3. **Sports are the ones a resident can actually go to**: published and not
 *     ended. A draft schedule and an ended one each carry a sport the fixture
 *     facility would otherwise advertise.
 *
 *  4. **The cache is real, and a save expires it.** Asserted on the mechanism:
 *     a listing inserted behind the app's back stays invisible until an app
 *     save, then appears at once. Opting out and deleting must also disappear
 *     at once — a centre that unlists itself and still shows up is the failure
 *     that costs trust.
 *
 *  5. **The contract**: the exact key set (no org_id, no email, nothing
 *     internal), accent-insensitive multi-word search, sport filtering, 400s
 *     for bad input, the attribution string, a public Cache-Control, and the
 *     rate limit with Retry-After (last, because it throttles this IP for a
 *     minute).
 *
 * No Nominatim requests: fixtures carry geocoded_at, and saves keep the
 * address, so the route never looks anything up.
 *
 *   node scripts/verify/verify-af.mjs [--app=http://localhost:3000]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";

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
/** Used ONLY to sign the fixture admin in. */
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

async function directory(query = "", cookie = null) {
  const res = await fetch(`${APP}/api/public/v1/directory${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, body };
}

/**
 * Every write here expires the directory cache. `next dev` applies that
 * about 100 ms after the route responds (see verify-ah), so the next read
 * could still be stale; a production build is immediate. This harness
 * passed without the pause until 2026-09-16 on timing alone.
 */
async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  });
  const result = { status: res.status, body: await res.json().catch(() => ({})) };
  await new Promise((r) => setTimeout(r, 400));
  return result;
}

const ids = (body) => new Set((body.facilities ?? []).map((f) => f.id));
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

const stamp = Date.now();
const cleanup = { users: [], orgs: [] };

try {
  const { error: preflight } = await admin.from("facilities").select("listed_in_directory").limit(1);
  if (preflight) throw new Error(`migration 052 is not applied: ${preflight.message}`);

  const makeOrg = async (suffix, status) => {
    const { data, error } = await admin
      .from("organizations")
      .insert({ name: `ZZ Verify-AF ${suffix} Rec ${stamp}`, slug: `zz-verify-af-${suffix}-${stamp}`, status })
      .select("id")
      .single();
    if (error) throw new Error(`org ${suffix}: ${error.message}`);
    cleanup.orgs.push(data.id);
    return data;
  };
  const org = await makeOrg("active", "active");
  const pendingOrg = await makeOrg("pending", "pending");

  const email = `zz-verify-af-admin-${stamp}@example.invalid`;
  const password = `Zaf!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  cleanup.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  const ADDRESS = { address_line1: "1 Test St", city: "Vancouver", province: "BC", postal_code: "V0V 0V0" };
  const makeFacility = async (orgId, suffix, extra) => {
    const { data, error } = await admin
      .from("facilities")
      .insert({
        org_id: orgId,
        name: `ZZ Verify-AF ${suffix} ${stamp}`,
        slug: `zz-verify-af-${suffix}-${stamp}`,
        ...ADDRESS,
        // Marked as already looked up, so a save through the route never
        // calls Nominatim.
        geocoded_at: new Date().toISOString(),
        ...extra,
      })
      .select("id, name, slug")
      .single();
    if (error) throw new Error(`facility ${suffix}: ${error.message}`);
    return data;
  };
  const makeGroup = async (facilityId, sport, extra) => {
    const { error } = await admin.from("schedule_groups").insert({
      org_id: org.id,
      facility_id: facilityId,
      name: `ZZ ${sport} ${stamp}`,
      slug: `zz-${sport}-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
      sport_category: sport,
      activity_type: "drop_in",
      source: "manual",
      ...extra,
    });
    if (error) throw new Error(`group ${sport}: ${error.message}`);
  };

  // Warm the cache BEFORE any fixture exists, so section 4 can show a direct
  // insert staying invisible until an app save.
  const warm = await directory();
  check("control: the endpoint answers before any fixture exists", warm.status === 200, `${warm.status}`);

  const listed = await makeFacility(org.id, "listed", { is_published: true, listed_in_directory: true, lat: 49.28, lng: -123.12 });
  const unlisted = await makeFacility(org.id, "unlisted", { is_published: true });
  const draft = await makeFacility(org.id, "draft", { is_published: false, listed_in_directory: true });
  const accented = await makeFacility(org.id, "accent", {
    name: `ZZ Centre Aquatique Verify-AF ${stamp}`,
    city: "Montréal",
    province: "QC",
    is_published: true,
    listed_in_directory: true,
  });
  const pendingOrgFacility = await makeFacility(pendingOrg.id, "pending-org", { is_published: true, listed_in_directory: true });

  await makeGroup(listed.id, "swimming", { status: "published", starts_on: daysAgo(30) });
  await makeGroup(listed.id, "hockey", { status: "published", starts_on: daysAgo(60), ends_on: daysAgo(10) });
  await makeGroup(listed.id, "yoga", { status: "draft", starts_on: daysAgo(30) });
  await makeGroup(accented.id, "skating", { status: "published", starts_on: daysAgo(30) });

  console.log("\n4a. The cache is real");
  const stale = await directory();
  check(
    "a listing inserted behind the app's back is not served yet (cached)",
    !ids(stale.body).has(listed.id),
    "if this fails, either the cache is not in use or it revalidated mid-run; rerun once"
  );

  const touch = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({
      name: unlisted.name,
      ...ADDRESS,
      is_published: true,
      listed_in_directory: false,
      photo_urls: [],
      facilityId: unlisted.id,
    }),
  });
  check("control: an app save succeeds", touch.status === 200, JSON.stringify(touch.body));

  const fresh = await directory();
  const seen = ids(fresh.body);

  console.log("\n1. Only what a centre chose to list");
  check("…and after that save it appears at once", seen.has(listed.id));
  check("a published, listed facility is in the directory (control)", seen.has(listed.id));
  check("a listed facility without coordinates is still listed", seen.has(accented.id));
  check("a published but unlisted facility is not", !seen.has(unlisted.id));
  check("a listed but unpublished facility is not", !seen.has(draft.id));
  check("a listed facility of a pending organization is not", !seen.has(pendingOrgFacility.id));

  console.log("\n2. Being signed in changes nothing");
  const asMember = await directory("", cookie);
  check("control: a member's request succeeds", asMember.status === 200 && ids(asMember.body).has(listed.id));
  check("…and still omits their own unpublished listed facility", !ids(asMember.body).has(draft.id));
  check(
    "…and returns exactly what a resident gets",
    JSON.stringify([...ids(asMember.body)].sort()) === JSON.stringify([...seen].sort())
  );

  console.log("\n3. Sports a resident can actually go to");
  const listedEntry = fresh.body.facilities.find((f) => f.id === listed.id);
  const accentEntry = fresh.body.facilities.find((f) => f.id === accented.id);
  const sportIds = (listedEntry?.sports ?? []).map((s) => s.id);
  check("a published, open schedule's sport is listed (control)", sportIds.includes("swimming"), JSON.stringify(sportIds));
  check("an ended schedule's sport is not", !sportIds.includes("hockey"));
  check("a draft schedule's sport is not", !sportIds.includes("yoga"));
  check("sports carry their label", listedEntry?.sports?.[0]?.label === "Swimming");

  console.log("\n5. The contract");
  const EXPECTED_KEYS = [
    "address", "description", "id", "location", "name", "organization",
    "path", "phone", "photoUrl", "slug", "sports", "websiteUrl",
  ];
  check(
    "a facility has exactly the published keys",
    JSON.stringify(Object.keys(listedEntry ?? {}).sort()) === JSON.stringify(EXPECTED_KEYS),
    JSON.stringify(Object.keys(listedEntry ?? {}).sort())
  );
  check(
    "address and organization carry only their published keys",
    JSON.stringify(Object.keys(listedEntry?.address ?? {}).sort()) === JSON.stringify(["city", "line1", "postalCode", "province"]) &&
      JSON.stringify(Object.keys(listedEntry?.organization ?? {}).sort()) === JSON.stringify(["logoUrl", "name"])
  );
  check("location is the stored point", listedEntry?.location?.lat === 49.28 && listedEntry?.location?.lng === -123.12);
  check("…and null when the address was never placed", accentEntry?.location === null);
  check("path points at the public facility page", listedEntry?.path === `/facility/${listed.slug}`);
  check("organization name comes through", listedEntry?.organization?.name === `ZZ Verify-AF active Rec ${stamp}`);
  check("apiVersion is 1 and the OSM attribution is present", fresh.body.apiVersion === 1 && /OpenStreetMap/.test(fresh.body.attribution));
  check(
    "Cache-Control is public and short",
    /public/.test(fresh.headers.get("cache-control") ?? "") && /s-maxage=60/.test(fresh.headers.get("cache-control") ?? ""),
    fresh.headers.get("cache-control")
  );

  const byCity = await directory(`?q=${encodeURIComponent(`montreal verify-af ${stamp}`)}`);
  check("search ignores accents and matches name + city words together", ids(byCity.body).has(accented.id) && !ids(byCity.body).has(listed.id), JSON.stringify([...ids(byCity.body)]));
  const byOrg = await directory(`?q=${encodeURIComponent(`active rec ${stamp}`)}`);
  check("search matches the organization name", ids(byOrg.body).has(listed.id) && ids(byOrg.body).has(accented.id));
  const mismatch = await directory(`?q=${encodeURIComponent(`${stamp} zzznomatch`)}`);
  check("every word must match", mismatch.status === 200 && !ids(mismatch.body).has(listed.id) && !ids(mismatch.body).has(accented.id));
  const skating = await directory("?sport=skating");
  check("sport filter keeps a facility with that sport", ids(skating.body).has(accented.id));
  check("…and drops one without it", !ids(skating.body).has(listed.id));
  const hockey = await directory("?sport=hockey");
  check("filtering on an ended schedule's sport does not find the facility", !ids(hockey.body).has(listed.id));

  const badSport = await directory("?sport=quidditch");
  check("an unknown sport is a 400", badSport.status === 400, `${badSport.status}`);
  const longQ = await directory(`?q=${"x".repeat(81)}`);
  check("an over-long query is a 400", longQ.status === 400, `${longQ.status}`);

  console.log("\n4b. Leaving the directory is immediate");
  const optOut = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({
      name: listed.name,
      ...ADDRESS,
      is_published: true,
      listed_in_directory: false,
      photo_urls: [],
      facilityId: listed.id,
    }),
  });
  const afterOptOut = await directory();
  check("control: the opt-out save succeeds", optOut.status === 200, JSON.stringify(optOut.body));
  check("an opted-out facility is gone on the next request", !ids(afterOptOut.body).has(listed.id));
  check("…while the one still listed remains (control)", ids(afterOptOut.body).has(accented.id));

  const del = await api(`/api/facilities/${accented.id}`, cookie, { method: "DELETE" });
  const afterDelete = await directory();
  check("control: the delete succeeds", del.status === 200, JSON.stringify(del.body));
  check("a deleted facility is gone on the next request", !ids(afterDelete.body).has(accented.id));

  console.log("\n5b. Rate limit (throttles this IP for a minute)");
  let limited = null;
  for (let i = 0; i < 130 && !limited; i++) {
    const res = await fetch(`${APP}/api/public/v1/directory?q=rl${i}`);
    if (res.status === 429) limited = res;
    else await res.arrayBuffer();
  }
  check("a flood is eventually refused with 429", limited !== null);
  check("…with Retry-After", Number(limited?.headers.get("retry-after")) > 0, limited?.headers.get("retry-after") ?? "");

  // The flood above just wrote this IP's bucket. The privacy policy says IP
  // addresses are not stored, so the key must be a digest, not the address.
  const { data: buckets } = await admin
    .from("rate_limits")
    .select("bucket, count")
    .like("bucket", "directory:%")
    .gte("count", 100);
  check("control: the flood's bucket was recorded", (buckets ?? []).length > 0, JSON.stringify(buckets));
  check(
    "…under a hashed key, not the caller's IP",
    (buckets ?? []).every((b) => /^directory:[0-9a-f]{32}$/.test(b.bucket)),
    JSON.stringify((buckets ?? []).map((b) => b.bucket.replace(/\d+(?=$)/, "…")))
  );
} catch (e) {
  fail++;
  console.log(`  FAIL  harness error — ${e.message}`);
} finally {
  for (const id of cleanup.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of cleanup.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  const { data: leftover } = await admin.from("organizations").select("id, name").like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftover?.length ?? 0} org(s) left over${
      leftover?.length ? ` — ${leftover.map((o) => o.name).join(", ")}` : ""
    }`
  );
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
