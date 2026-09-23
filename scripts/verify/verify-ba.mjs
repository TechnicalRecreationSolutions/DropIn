/**
 * Head counts, temperatures, and what the public gets — migration 061.
 *
 * The claims under test:
 *
 *   1. **An aux staffer can record, and cannot rewrite.** INSERT succeeds for
 *      the role that has never had a write; UPDATE is refused outright, because
 *      the table has no UPDATE policy at all. Both matter: the first is the
 *      feature, the second is the append-only guarantee the whole log rests on.
 *
 *   2. **The readings themselves are not public, and the projection is.** A
 *      never-signed-in client selecting `facility_readings` gets zero rows
 *      WHILE `facility_public_conditions()` returns a value for the same
 *      facility. Either assertion alone is worthless — zero rows from a locked
 *      table and zero rows from an empty one look identical.
 *
 *   3. **`level` mode never emits the count.** At every capacity, and at each
 *      band boundary. And with no capacity anywhere the row is DROPPED rather
 *      than falling back to the number, which is the failure that would
 *      quietly publish what the mode exists to withhold.
 *
 *   4. **`typical_value` is computed, not constant.** It matches a hand-built
 *      fixture, is absent below three samples, and differs at a second
 *      facility built with different numbers.
 *
 *   5. **Scope binds.** A staffer at another building cannot record here.
 *
 *   6. **The tool works on a phone, as an aux staffer.** 390px, real browser,
 *      no horizontal overflow, and the count that gets typed lands in the
 *      database.
 *
 * Sections marked FALSIFY say what to break to watch them go red.
 *
 * Section 0 imports the app's real TypeScript modules, so this needs
 * `--experimental-strip-types` either way.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-ba.mjs [--headed]
 *   node --experimental-strip-types scripts/verify/verify-ba.mjs --logic-only
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";
const LOGIC_ONLY = process.argv.includes("--logic-only");
const HEADED = process.argv.includes("--headed");

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

// ── Section 0: freshness and formatting, with nothing running ───────────────
//
// These decide what a number is ALLOWED TO CLAIM, which is the whole design of
// the public block: a fresh count says "about 40 here", a stale one says
// "usually about 35 at this time", and a stale one with no history says
// nothing. Getting the boundary wrong publishes the first sentence about
// four-hour-old data.
async function logicSection() {
  console.log("\n0. Freshness and formatting (no database, no server)");

  const { METRICS, formatReading, formatRecordedAt, isFresh, localUtcOffsetMinutes } =
    await import("../../src/lib/conditions/readings.ts");

  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  const now = new Date();

  check("a head count from 10 minutes ago is fresh", isFresh("headcount", ago(10), now));
  check("one from 89 minutes ago is still fresh", isFresh("headcount", ago(89), now));
  // FALSIFY: raise headcount.freshMinutes and this goes green when it should not.
  check("one from 91 minutes ago is NOT", !isFresh("headcount", ago(91), now));
  check(
    "a water temperature from 4 hours ago is fresh (a different rule, on purpose)",
    isFresh("water_temp_c", ago(240), now)
  );
  check("...and one from 13 hours ago is not", !isFresh("water_temp_c", ago(13 * 60), now));
  check("a reading stamped in the future is not fresh", !isFresh("headcount", ago(-10), now));

  check("a count renders as a whole number", formatReading("headcount", 42) === "42");
  check("a count rounds rather than truncating", formatReading("headcount", 41.6) === "42");
  check(
    "a temperature keeps one decimal and its unit",
    formatReading("water_temp_c", 27.46) === "27.5 °C",
    formatReading("water_temp_c", 27.46)
  );

  check(
    "an age from today is a time of day",
    /^\d{1,2}:\d{2}/.test(formatRecordedAt(ago(30), now)),
    formatRecordedAt(ago(30), now)
  );
  check(
    "an age from yesterday says so",
    formatRecordedAt(ago(26 * 60), now).startsWith("Yesterday"),
    formatRecordedAt(ago(26 * 60), now)
  );

  // The sign convention the RPC depends on. getTimezoneOffset() counts minutes
  // BEHIND UTC, and getting this backwards moves "usually at this time" by
  // twice the offset — sixteen hours in Pacific, which is not a subtle bug but
  // is an invisible one without an assertion.
  check(
    "the UTC offset is minutes to ADD to UTC",
    localUtcOffsetMinutes(now) === -now.getTimezoneOffset(),
    `${localUtcOffsetMinutes(now)} vs ${-now.getTimezoneOffset()}`
  );

  check(
    "every metric declares a freshness window",
    Object.values(METRICS).every((m) => m.freshMinutes > 0)
  );
  check(
    "a head count goes stale faster than a temperature",
    METRICS.headcount.freshMinutes < METRICS.water_temp_c.freshMinutes
  );
}

if (LOGIC_ONLY) {
  await logicSection();
  console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
/** Never signed in. See the long note in verify-az — `anon` answers as a member. */
const publicAnon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

function cookieParts(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    out.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  }
  return out;
}
const cookieHeaderFrom = (parts) => parts.map((c) => `${c.name}=${c.value}`).join("; ");

async function api(pathname, cookie, init = {}) {
  const res = await fetch(`${APP}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };
/** Minutes to ADD to UTC, the argument the RPC takes. */
const OFFSET = -new Date().getTimezoneOffset();

async function makeUser(orgId, role, label, scopeFacilityId = null) {
  const email = `zz-ba-${label}-${stamp}@example.invalid`;
  const password = `Zb!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);

  const { data: membership, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: data.user.id, role })
    .select("id")
    .single();
  // Read the error — rule 5 in scripts/verify/README.md. A silently failed
  // membership makes every request 403 "No organization found", which reads
  // like a product bug.
  if (mErr) throw new Error(`membership ${label} (${role}): ${mErr.message}`);

  if (scopeFacilityId) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert({ membership_id: membership.id, org_id: orgId, facility_id: scopeFacilityId });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }

  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);

  const parts = cookieParts(signIn.session);
  return {
    userId: data.user.id,
    email,
    password,
    cookie: cookieHeaderFrom(parts),
    cookieParts: parts,
  };
}

/** A client signed in as this fixture user, for asking PostgREST directly. */
async function clientFor(user) {
  const c = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  await c.auth.signInWithPassword({ email: user.email, password: user.password });
  return c;
}

async function main() {
  await logicSection();

  const { error: probe } = await admin.from("facility_readings").select("id").limit(1);
  if (probe) {
    console.log("\n  migration 061: NOT applied — everything below needs the table.");
    skipped("sections 1-7", "migration 061 not applied");
    return;
  }
  console.log("\n  migration 061: applied");

  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ readings ${stamp}`, slug: `zz-readings-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const mkFacility = async (name, extra = {}) =>
    (
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name: `ZZ ${name} ${stamp}`,
          slug: `zz-${name}-${stamp}`,
          address_line1: "1 Test St",
          city: "Victoria",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: true,
          ...extra,
        })
        .select("id, slug")
        .single()
    ).data;

  const pool = await mkFacility("rpool", { public_headcount: "count", public_conditions: true });
  const arena = await mkFacility("rarena");

  const { data: lane } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: pool.id,
      name: `ZZ Lane pool ${stamp}`,
      slug: `zz-lanepool-${stamp}`,
      capacity: 100,
      is_published: true,
    })
    .select("id, name")
    .single();

  const guard = await makeUser(org.id, "aux", "guard", pool.id);
  const owner = await makeUser(org.id, "owner", "owner");

  const readingsPath = `/api/facilities/${pool.id}/readings`;

  // ── 1. An aux staffer records ─────────────────────────────────────────────
  console.log("\n1. Recording, as an aux staffer");

  const posted = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "headcount", value: 42 }),
  });
  // FALSIFY: remove "aux" from ALLOWED["reading:write"] and this 403s.
  check("an aux staffer can record a head count", posted.status === 201, `${posted.status} ${JSON.stringify(posted.body)}`);
  const reading = posted.body.reading;

  check(
    "the row is stamped with WHO recorded it, from the session not the payload",
    reading?.recorded_by === guard.userId,
    reading?.recorded_by
  );

  const spoofed = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "headcount", value: 7, recorded_by: owner.userId }),
  });
  const { data: spoofCheck } = await admin
    .from("facility_readings")
    .select("recorded_by")
    .eq("id", spoofed.body.reading?.id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check(
    "a payload cannot file a count under someone else's name",
    spoofCheck?.recorded_by === guard.userId,
    spoofCheck?.recorded_by
  );

  const temps = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "water_temp_c", value: 27.5, space_id: lane.id }),
  });
  check("...and a water temperature", temps.status === 201, `${temps.status}`);

  // The bounds. Each is a CHECK in the database and a message in the route;
  // the route's job is to make the refusal readable.
  const fahrenheit = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "water_temp_c", value: 82 }),
  });
  check("82 in a Celsius field is refused", fahrenheit.status === 400, `${fahrenheit.status}`);
  check(
    "...with a sentence, not a constraint name",
    /between/i.test(fahrenheit.body.error ?? ""),
    fahrenheit.body.error
  );

  const fractional = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "headcount", value: 40.5 }),
  });
  check("half a person is refused", fractional.status === 400, `${fractional.status}`);

  const negative = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "headcount", value: -1 }),
  });
  check("a negative count is refused", negative.status === 400, `${negative.status}`);

  const future = await api(readingsPath, guard.cookie, {
    method: "POST",
    body: JSON.stringify({
      metric: "headcount",
      value: 5,
      recorded_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
    }),
  });
  check("a reading stamped in the future is refused", future.status === 400, `${future.status}`);

  // ── 2. Append-only ────────────────────────────────────────────────────────
  console.log("\n2. Append-only");

  const guardClient = await clientFor(guard);
  const { error: updateErr, data: updated } = await guardClient
    .from("facility_readings")
    .update({ value: 999 })
    .eq("id", reading.id)
    .select("id");
  // No UPDATE policy means the update matches no rows rather than erroring, so
  // BOTH halves are asserted: nothing came back, and the value did not move.
  check("an UPDATE changes nothing (there is no policy for it)", (updated ?? []).length === 0, updateErr?.message);
  const { data: stillThere } = await admin
    .from("facility_readings")
    .select("value")
    .eq("id", reading.id)
    .maybeSingle();
  check("...and the recorded value is untouched", Number(stillThere?.value) === 42, String(stillThere?.value));

  const { error: delOwnErr } = await guardClient
    .from("facility_readings")
    .delete()
    .eq("id", spoofed.body.reading.id);
  check("a staffer can delete their own mistake", !delOwnErr, delOwnErr?.message);

  // ── 3. Not public, but projected ──────────────────────────────────────────
  console.log("\n3. The public boundary");

  const { data: rawPublic } = await publicAnon
    .from("facility_readings")
    .select("id")
    .eq("facility_id", pool.id);
  check(
    "a never-signed-in client reads ZERO rows from facility_readings",
    (rawPublic ?? []).length === 0,
    `${rawPublic?.length} rows`
  );

  // THE CONTROL for the line above. Without it, zero rows from a locked table
  // and zero rows from an empty one are the same result.
  const { data: projected, error: rpcErr } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  check("...while the projection returns rows for the same facility", (projected ?? []).length > 0, rpcErr?.message);

  const headRow = (projected ?? []).find((r) => r.metric === "headcount");
  check("in 'count' mode the exact number is published", Number(headRow?.value) === 42, JSON.stringify(headRow));
  check("...and no band is", headRow?.level === null, headRow?.level);

  const waterRow = (projected ?? []).find((r) => r.metric === "water_temp_c");
  check("the water temperature is published when public_conditions is on", Number(waterRow?.value) === 27.5, JSON.stringify(waterRow));
  check("...and it names the space it was taken in", waterRow?.space_name === lane.name, waterRow?.space_name);

  await admin.from("facilities").update({ public_conditions: false }).eq("id", pool.id);
  const { data: noTemps } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  check(
    "turning public_conditions off removes the temperature",
    !(noTemps ?? []).some((r) => r.metric === "water_temp_c")
  );
  check(
    "...and leaves the head count, which is a separate setting",
    (noTemps ?? []).some((r) => r.metric === "headcount")
  );

  await admin.from("facilities").update({ public_headcount: "hidden" }).eq("id", pool.id);
  const { data: hidden } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  check("'hidden' publishes nothing at all", (hidden ?? []).length === 0, JSON.stringify(hidden));

  // ── 4. level mode ─────────────────────────────────────────────────────────
  console.log("\n4. 'level' mode never emits the count");

  await admin
    .from("facilities")
    .update({ public_headcount: "level", occupancy_capacity: 100 })
    .eq("id", pool.id);

  const { data: banded } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  const band = (banded ?? []).find((r) => r.metric === "headcount");
  // FALSIFY: return l.value unconditionally from the function and this goes red
  // while the next line stays green — which is the whole point of asserting
  // both.
  check("the exact count is NULL", band?.value === null, String(band?.value));
  check("a band is returned instead", band?.level === "moderate", band?.level);
  check(
    "the raw number is absent from the WHOLE serialized row, not just `value`",
    !JSON.stringify(band ?? {}).includes("42"),
    JSON.stringify(band)
  );

  // Each boundary, against a capacity of 100 so the percentage is the value.
  for (const [value, expected] of [[0, "quiet"], [34, "quiet"], [35, "moderate"], [69, "moderate"], [70, "busy"], [94, "busy"], [95, "full"], [200, "full"]]) {
    const { data: lvl } = await admin.rpc("occupancy_level", { p_value: value, p_capacity: 100 });
    check(`${value}/100 reads as "${expected}"`, lvl === expected, String(lvl));
  }
  const { data: noCap } = await admin.rpc("occupancy_level", { p_value: 40, p_capacity: null });
  check("no capacity yields no band", noCap === null, String(noCap));

  // The dangerous case: level mode with nothing to divide by. The row must be
  // DROPPED — falling back to the number would publish exactly what the mode
  // withholds.
  await admin.from("facilities").update({ occupancy_capacity: null }).eq("id", pool.id);
  const { data: uncapped } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  check(
    "level mode with no capacity omits the reading rather than falling back to the number",
    !(uncapped ?? []).some((r) => r.metric === "headcount"),
    JSON.stringify(uncapped)
  );
  await admin.from("facilities").update({ occupancy_capacity: 100 }).eq("id", pool.id);

  // A space-level count uses the SPACE's capacity, not the building's.
  await admin.from("facility_readings").insert({
    org_id: org.id,
    facility_id: pool.id,
    space_id: lane.id,
    metric: "headcount",
    value: 80,
    recorded_by: guard.userId,
  });
  const { data: spaceBand } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  const laneBand = (spaceBand ?? []).find((r) => r.metric === "headcount" && r.space_id === lane.id);
  // 80/100 (the lane's own capacity) is "busy". If it used the building's 100
  // the answer would be the same — so the lane's capacity is changed first to
  // make the two differ, below.
  check("a space-level count is banded too", laneBand?.level === "busy", laneBand?.level);

  await admin.from("spaces").update({ capacity: 400 }).eq("id", lane.id);
  const { data: rebanded } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: pool.id,
    p_utc_offset_minutes: OFFSET,
  });
  const laneBand2 = (rebanded ?? []).find((r) => r.metric === "headcount" && r.space_id === lane.id);
  check(
    "...against the SPACE's capacity, not the building's",
    laneBand2?.level === "quiet",
    `${laneBand2?.level} (80/400 should be quiet; 80/100 would be busy)`
  );

  // ── 5. typical_value ──────────────────────────────────────────────────────
  console.log("\n5. 'Usually about N at this time'");

  await admin.from("facilities").update({ public_headcount: "count" }).eq("id", pool.id);

  // A facility of its own, so the history is exactly what this section built.
  const histFacility = await mkFacility("rhist", { public_headcount: "count" });
  const nowLocal = new Date();
  // Same weekday and hour, one/two/three weeks back. Built with LOCAL getters,
  // like every fixture week in this repo — see scripts/verify/README.md.
  const weeksAgo = (n) => {
    const d = new Date(nowLocal);
    d.setDate(d.getDate() - 7 * n);
    return d.toISOString();
  };
  for (const [weeks, value] of [[1, 30], [2, 40], [3, 50]]) {
    const { error } = await admin.from("facility_readings").insert({
      org_id: org.id,
      facility_id: histFacility.id,
      metric: "headcount",
      value,
      recorded_at: weeksAgo(weeks),
      recorded_by: guard.userId,
    });
    if (error) check(`fixture: history ${weeks}w`, false, error.message);
  }
  // Something recent, so there is a row for `typical_value` to hang off.
  await admin.from("facility_readings").insert({
    org_id: org.id,
    facility_id: histFacility.id,
    metric: "headcount",
    value: 11,
    recorded_by: guard.userId,
  });

  const { data: withHistory } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: histFacility.id,
    p_utc_offset_minutes: OFFSET,
  });
  const hist = (withHistory ?? []).find((r) => r.metric === "headcount");
  // (30 + 40 + 50 + 11) / 4 = 32.75 → 33. The just-recorded row is in the
  // window too, which is correct: it is a reading at this weekday and hour.
  check(
    "typical_value is the mean of this weekday and hour",
    Number(hist?.typical_value) === 33,
    `${hist?.typical_value} (expected 33 from 30/40/50/11)`
  );
  check("...and the live value is still the live one", Number(hist?.value) === 11, String(hist?.value));

  // Not a constant: the same code, different numbers, different answer.
  const thinFacility = await mkFacility("rthin", { public_headcount: "count" });
  await admin.from("facility_readings").insert({
    org_id: org.id,
    facility_id: thinFacility.id,
    metric: "headcount",
    value: 5,
    recorded_by: guard.userId,
  });
  const { data: thin } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: thinFacility.id,
    p_utc_offset_minutes: OFFSET,
  });
  const thinRow = (thin ?? []).find((r) => r.metric === "headcount");
  // FALSIFY: drop the `sample_size >= 3` guard and this reports 5 — one quiet
  // Tuesday presented as what usually happens.
  check(
    "one sample produces NO 'usually' at all",
    thinRow?.typical_value === null,
    String(thinRow?.typical_value)
  );
  check("...while the live reading is still published", Number(thinRow?.value) === 5, String(thinRow?.value));

  // ── 6. Scope, and the 24-hour floor ───────────────────────────────────────
  console.log("\n6. Scope and staleness");

  const elsewhere = await api(`/api/facilities/${arena.id}/readings`, guard.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "headcount", value: 3 }),
  });
  check(
    "an aux staffer cannot record at a building outside their scope",
    elsewhere.status === 403,
    `${elsewhere.status}`
  );

  const ownerElsewhere = await api(`/api/facilities/${arena.id}/readings`, owner.cookie, {
    method: "POST",
    body: JSON.stringify({ metric: "headcount", value: 3 }),
  });
  check("...but an owner can (the control)", ownerElsewhere.status === 201, `${ownerElsewhere.status}`);

  const staleFacility = await mkFacility("rstale", { public_headcount: "count" });
  await admin.from("facility_readings").insert({
    org_id: org.id,
    facility_id: staleFacility.id,
    metric: "headcount",
    value: 77,
    recorded_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
    recorded_by: guard.userId,
  });
  const { data: stale } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: staleFacility.id,
    p_utc_offset_minutes: OFFSET,
  });
  check(
    "a reading older than 24 hours is not published at all",
    (stale ?? []).length === 0,
    JSON.stringify(stale)
  );

  const unpublished = await mkFacility("rdraft", { is_published: false, public_headcount: "count" });
  await admin.from("facility_readings").insert({
    org_id: org.id,
    facility_id: unpublished.id,
    metric: "headcount",
    value: 9,
    recorded_by: guard.userId,
  });
  const { data: draftRows } = await publicAnon.rpc("facility_public_conditions", {
    p_facility_id: unpublished.id,
    p_utc_offset_minutes: OFFSET,
  });
  check(
    "an unpublished facility publishes nothing, whatever its settings say",
    (draftRows ?? []).length === 0,
    JSON.stringify(draftRows)
  );

  // ── 7. The endpoint, and the tool on a phone ──────────────────────────────
  console.log("\n7. The public endpoint, and the tool at 390px");

  const res = await fetch(`${APP}/api/public/v1/facility/${pool.id}/conditions`);
  const body = await res.json().catch(() => ({}));
  check("the public endpoint answers 200", res.status === 200, `${res.status}`);
  check("...with apiVersion 1", body.apiVersion === 1, JSON.stringify(body).slice(0, 120));
  check("...and camelCase keys, per the contract", Array.isArray(body.readings) && (body.readings.length === 0 || "recordedAt" in body.readings[0]), JSON.stringify(body.readings?.[0]));
  check(
    "...and a public cache header",
    /s-maxage=30/.test(res.headers.get("cache-control") ?? ""),
    res.headers.get("cache-control")
  );

  const badId = await fetch(`${APP}/api/public/v1/facility/not-a-uuid/conditions`);
  check("a bad facility id is a 400, not a 500", badId.status === 400, `${badId.status}`);

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    skipped("the tool in a browser", "playwright not installed");
    return;
  }

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies(
      guard.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false }))
    );
    const page = await context.newPage();
    await page.goto(`${APP}/dashboard/counts?facility=${pool.id}`, { waitUntil: "networkidle" });

    check("an aux staffer reaches the tool", await page.getByRole("heading", { name: "Head counts" }).isVisible());

    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);

    const plus = page.getByRole("button", { name: "One more" });
    const box = await plus.boundingBox();
    check(
      "the stepper is a 44px+ target",
      !!box && box.width >= 44 && box.height >= 44,
      box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "not found"
    );

    // The field opens on the last count for this space, not on zero — two taps
    // for "about the same" is the whole interaction.
    const opened = await page.locator("#count").inputValue();
    check("the count opens on the last recorded number", opened === "42", opened);

    await page.locator("#count").fill("57");
    await page.getByRole("button", { name: "Record count" }).click();
    await page.getByText("Saved", { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});

    const { data: landed } = await admin
      .from("facility_readings")
      .select("value, recorded_by")
      .eq("facility_id", pool.id)
      .is("space_id", null)
      .eq("metric", "headcount")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // The assertion that matters: the number reached the DATABASE, recorded as
    // the guard. A green screen proves only that the button animated.
    check("the typed count lands in the database", Number(landed?.value) === 57, String(landed?.value));
    check("...recorded as the guard who typed it", landed?.recorded_by === guard.userId);

    await page.screenshot({ path: path.join(OUT, "counts-mobile.png"), fullPage: true });

    // And the public page shows it. `public_headcount` is 'count' again by now.
    const publicPage = await context.newPage();
    await publicPage.goto(`${APP}/facility/${pool.slug}`, { waitUntil: "networkidle" });
    await publicPage.getByText("About 57 here").waitFor({ timeout: 10_000 }).catch(() => {});
    check(
      "the count reaches the public facility page",
      await publicPage.getByText("About 57 here").isVisible().catch(() => false)
    );
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.message}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
