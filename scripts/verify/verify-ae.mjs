/**
 * Directory listing + geocoding (migration 052, POST /api/facilities).
 *
 * What has to be proven, in order of how quietly it would fail:
 *
 *  1. **Nobody is listed without asking.** `listed_in_directory` defaults to
 *     false, and a save that omits it leaves the facility unlisted. The
 *     directory reads `is_published AND listed_in_directory`, so the public
 *     read below checks both halves: listed-but-unpublished stays hidden, and
 *     the positive control (published + listed) is visible to the same
 *     never-signed-in client.
 *
 *  2. **`location` cannot disagree with lat/lng.** v1 never reads `location`,
 *     so a drift would stay invisible until a radius search was built on it.
 *     A direct write of a conflicting point must be overwritten, and clearing
 *     lat must clear location.
 *
 *  3. **The route looks an address up only when it could have moved.**
 *     Asserted on the mechanism — `geocoded_at` — not only the coordinates: an
 *     unchanged save must leave the timestamp alone (no request to Nominatim),
 *     and a changed one must move it. Coordinates alone could not tell "not
 *     looked up" from "looked up and got the same answer".
 *
 *  4. **A bad address clears the pin rather than keeping a stale one**, and is
 *     recorded as looked-up (so it is not retried on every save).
 *
 *  5. **A save cannot reach another org's facility**, and the edit page tells
 *     staff whether the address was found.
 *
 * Not covered: the "Nominatim unreachable" branch (clears geocoded_at so the
 * next save retries). It needs the network cut mid-request; the branch is
 * three lines in the route and is read, not run.
 *
 * Makes real Nominatim requests (about five, spaced by the app's throttle), so
 * it needs network access and takes ~15 s. Needs migration 052.
 *
 *   node scripts/verify/verify-ae.mjs [--app=http://localhost:3000]
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
/** Never signed in — stands in for a resident. See verify-ab for why it is separate. */
const publicRead = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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

async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function row(id) {
  const { data } = await admin
    .from("facilities")
    .select("id, name, lat, lng, location, geocoded_at, listed_in_directory, is_published, address_line1")
    .eq("id", id)
    .single();
  return data;
}

// A real building Nominatim resolves by street address (checked 2026-09-16).
const REAL_ADDRESS = {
  address_line1: "4636 Elk Lake Dr",
  city: "Saanich",
  province: "BC",
  postal_code: "V8Z 5M1",
};
const BOGUS_ADDRESS = {
  address_line1: "999 Zzyzx Nowhere Rd",
  city: "Qqqqvillezz",
  province: "BC",
  postal_code: "X0X 0X9",
};

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const { error: preflight } = await admin.from("facilities").select("listed_in_directory, geocoded_at").limit(1);
  if (preflight) throw new Error(`migration 052 is not applied: ${preflight.message}`);

  const [org, otherOrg] = await Promise.all(
    ["a", "b"].map(async (s) => {
      const { data } = await admin
        .from("organizations")
        .insert({ name: `ZZ verify-ae ${s} ${stamp}`, slug: `zz-verify-ae-${s}-${stamp}`, status: "active" })
        .select("id")
        .single();
      ids.orgs.push(data.id);
      return data;
    })
  );

  const email = `zz-verify-ae-admin-${stamp}@example.invalid`;
  const password = `Zae!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "manager" });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  async function insertFacility(orgId, suffix, extra = {}) {
    const { data, error } = await admin
      .from("facilities")
      .insert({
        org_id: orgId,
        name: `ZZ Verify-AE ${suffix} ${stamp}`,
        slug: `zz-verify-ae-${suffix}-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert ${suffix}: ${error.message}`);
    return data;
  }

  console.log("\n1. Nobody is listed without asking");

  const plain = await insertFacility(org.id, "plain", { is_published: true });
  check("a new facility is unlisted by default", (await row(plain.id)).listed_in_directory === false);

  const listedPub = await insertFacility(org.id, "listed-pub", { is_published: true, listed_in_directory: true });
  const listedDraft = await insertFacility(org.id, "listed-draft", { is_published: false, listed_in_directory: true });

  const { data: directory } = await publicRead
    .from("facilities")
    .select("id")
    .eq("is_published", true)
    .eq("listed_in_directory", true)
    .in("id", [plain.id, listedPub.id, listedDraft.id]);
  const visible = new Set((directory ?? []).map((f) => f.id));
  check("control: a resident sees a published, listed facility", visible.has(listedPub.id), JSON.stringify(directory));
  check("…but not a published, unlisted one", !visible.has(plain.id));
  check("…nor a listed one that is not published", !visible.has(listedDraft.id));

  console.log("\n2. location follows lat/lng");

  const pinned = await insertFacility(org.id, "pinned", { lat: 48.5, lng: -123.4 });
  const twin = await insertFacility(org.id, "twin", { lat: 48.5, lng: -123.4 });
  const pinnedRow = await row(pinned.id);
  check("inserting lat/lng sets location", pinnedRow.location !== null, String(pinnedRow.location));
  check("control: two rows with the same lat/lng get the same location", pinnedRow.location === (await row(twin.id)).location);

  await admin.from("facilities").update({ location: "SRID=4326;POINT(0 0)" }).eq("id", pinned.id);
  check(
    "a direct write of a conflicting location is overwritten from lat/lng",
    (await row(pinned.id)).location === pinnedRow.location,
    String((await row(pinned.id)).location)
  );

  await admin.from("facilities").update({ lat: null }).eq("id", pinned.id);
  check("clearing lat clears location", (await row(pinned.id)).location === null);

  console.log("\n3. The route geocodes on create, and again only when the address moves");

  const baseBody = {
    name: `ZZ Verify-AE Route ${stamp}`,
    ...REAL_ADDRESS,
    is_published: true,
    photo_urls: [],
  };
  const created = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, listed_in_directory: true }),
  });
  check("POST creates the facility", created.status === 200 && created.body.facilityId, JSON.stringify(created.body));
  const routeId = created.body.facilityId;
  const afterCreate = await row(routeId);
  check("…listed, as sent", afterCreate.listed_in_directory === true);
  check("…with geocoded_at set", afterCreate.geocoded_at !== null);
  check(
    "…at the real building (within ~1 km of 48.501, -123.389)",
    Math.abs(afterCreate.lat - 48.5014) < 0.01 && Math.abs(afterCreate.lng - -123.3893) < 0.015,
    `${afterCreate.lat}, ${afterCreate.lng}`
  );
  check("…and location set by the trigger", afterCreate.location !== null);

  const renamed = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, name: `${baseBody.name} renamed`, facilityId: routeId }),
  });
  const afterRename = await row(routeId);
  check("an edit that omits the listing flag succeeds", renamed.status === 200, JSON.stringify(renamed.body));
  check("…and leaves the facility unlisted (opt-in is explicit)", afterRename.listed_in_directory === false);
  check(
    "an edit that keeps the address does NOT look it up again (geocoded_at unchanged)",
    afterRename.geocoded_at === afterCreate.geocoded_at,
    `${afterCreate.geocoded_at} → ${afterRename.geocoded_at}`
  );
  check("…and keeps the coordinates", afterRename.lat === afterCreate.lat && afterRename.lng === afterCreate.lng);

  const respaced = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, address_line1: "  4636 ELK LAKE   DR ", facilityId: routeId }),
  });
  check(
    "whitespace and case changes do not count as a move",
    respaced.status === 200 && (await row(routeId)).geocoded_at === afterCreate.geocoded_at
  );

  console.log("\n4. A bad address clears the pin");

  const moved = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, ...BOGUS_ADDRESS, facilityId: routeId }),
  });
  const afterMove = await row(routeId);
  check("the save still succeeds", moved.status === 200, JSON.stringify(moved.body));
  check("the address was looked up again (geocoded_at moved)", afterMove.geocoded_at !== afterCreate.geocoded_at);
  check("…found nothing, so lat/lng/location are cleared", afterMove.lat === null && afterMove.lng === null && afterMove.location === null);

  const pageRes = await fetch(`${APP}/dashboard/facilities/${routeId}/edit`, { headers: { Cookie: cookie } });
  const page = await pageRes.text();
  check(
    "control: the edit page renders this facility",
    // Step 4 re-sent baseBody, so the name is back to the original.
    pageRes.status === 200 && page.includes(baseBody.name),
    `status=${pageRes.status}`
  );
  // The note only shows while the toggle is on; this row is unlisted after
  // step 3, so list it directly and reload.
  await admin.from("facilities").update({ listed_in_directory: true }).eq("id", routeId);
  const listedPage = await (await fetch(`${APP}/dashboard/facilities/${routeId}/edit`, { headers: { Cookie: cookie } })).text();
  check("the edit page tells staff the address was not found", listedPage.includes("find this address on the map"));
  check("…and not that it was found", !listedPage.includes("Address found on the map"));

  console.log("\n5. Another org's facility is out of reach");

  const foreign = await insertFacility(otherOrg.id, "foreign", { is_published: true });
  const foreignBefore = await row(foreign.id);
  const hijack = await api("/api/facilities", cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseBody, name: `ZZ hijacked ${stamp}`, listed_in_directory: true, facilityId: foreign.id }),
  });
  const foreignAfter = await row(foreign.id);
  check("saving over another org's facility is refused (404)", hijack.status === 404, `${hijack.status}`);
  check(
    "…and the row is untouched",
    foreignAfter.name === foreignBefore.name && foreignAfter.listed_in_directory === false && foreignAfter.geocoded_at === null
  );

  const stranger = await api("/api/facilities", null, { method: "POST", body: JSON.stringify(baseBody) });
  check("a signed-out save is refused (401)", stranger.status === 401, `${stranger.status}`);
} catch (e) {
  fail++;
  console.log(`  FAIL  harness error — ${e.message}`);
} finally {
  for (const id of ids.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of ids.users) {
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
