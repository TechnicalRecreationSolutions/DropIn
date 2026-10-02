/**
 * People here records where, during which session, and when; history moved
 * to Analytics (2026-10-01).
 *
 * The user's report: "it's not letting the staff select those details". The
 * cause for WHERE was real and measurable — the counter offered published
 * spaces only, and Panorama has ten spaces and none published, so it had no
 * picker at all. SESSION had no picker and no column (migration 069 adds
 * `facility_readings.session_id`). WHEN was accepted by the API and never
 * offered by the UI.
 *
 *   1. API: a session at ANOTHER facility is refused (400) and one here is
 *      accepted (positive control); an unpublished space is accepted; a
 *      future time is refused.
 *   2. Browser, as an aux staffer at 390px: the Where chips include an
 *      UNPUBLISHED space; the session running now is offered; picking it and
 *      recording files session_id + space_id; "Earlier today" files the time
 *      typed; Undo deletes the entry. The status page has no "History" and no
 *      "Recent entries" any more.
 *   3. Analytics, as the owner: Attendance shows "By session" and a "Count
 *      log" naming the session, and deleting from the log removes the row.
 *      Status history lists a cleared notice and leaves out a draft and an
 *      unapproved report. The notices export works for a coordinator and is
 *      refused to aux; the attendance export carries a Session column.
 *
 * FALSIFY: in the status page, put back `.filter((s) => s.is_published)` on
 * the spaces passed to HeadCountTool — section 2's first check goes red.
 * Remove the session guard in the readings POST — section 1's cross-facility
 * check goes red.
 *
 * Needs migration 069 for the session checks; without it they are SKIPPED
 * (named), and everything else still runs.
 *
 *   npm run dev
 *   node scripts/verify/verify-bk.mjs [--app=http://localhost:3000] [--headed]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const OUT = path.resolve("scripts/verify/out/bk");
fs.mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

let pass = 0;
let fail = 0;
let skip = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function skipped(label, why) {
  skip++;
  console.log(`  SKIP  ${label} — ${why}`);
}

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
const headerFrom = (parts) => parts.map((c) => `${c.name}=${c.value}`).join("; ");

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function makeUser(orgId, role, label, scopeFacilityId = null) {
  const email = `zz-bk-${label}-${stamp}@example.invalid`;
  const password = `Zc!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);
  const { data: membership, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: data.user.id, role, email, display_name: `ZZ ${label}` })
    .select("id")
    .single();
  if (mErr) throw new Error(`membership ${label} (${role}): ${mErr.message}`);
  if (scopeFacilityId) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert({ membership_id: membership.id, org_id: orgId, facility_id: scopeFacilityId });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn ${label}: ${signInErr.message}`);
  const parts = cookieParts(signIn.session);
  return { userId: data.user.id, cookie: headerFrom(parts), cookieParts: parts };
}

const pad = (n) => String(n).padStart(2, "0");
/** Local wall clock as the session convention stores it: the digits, labelled UTC. */
function sessionStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00Z`;
}

async function makeFacility(orgId, label) {
  const { data, error } = await admin
    .from("facilities")
    .insert({
      org_id: orgId,
      name: `ZZ ${label} ${stamp}`,
      slug: `zz-bk-${label.toLowerCase()}-${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`facility ${label}: ${error.message}`);
  return data;
}

/** A daily session in one space, running from 30 minutes ago for 90 minutes. */
async function makeSessionNow(orgId, facilityId, departmentId, spaceId, name) {
  const { data: group, error: gErr } = await admin
    .from("schedule_groups")
    .insert({
      org_id: orgId,
      facility_id: facilityId,
      department_id: departmentId,
      name,
      slug: `zz-bk-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status: "published",
      source: "manual",
      starts_on: "2026-01-01",
    })
    .select("id")
    .single();
  if (gErr) throw new Error(`group ${name}: ${gErr.message}`);

  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60_000);
  // Clamp inside today: a session spanning midnight would start "yesterday"
  // and the counter (rightly) offers only today's.
  if (start.getDate() !== now.getDate()) start.setHours(0, 0, 0, 0);
  const end = new Date(now.getTime() + 60 * 60_000);
  const endHhmm = end.getDate() !== now.getDate() ? "23:59" : `${pad(end.getHours())}:${pad(end.getMinutes())}`;

  const { data: session, error: sErr } = await admin
    .from("sessions")
    .insert({
      org_id: orgId,
      schedule_group_id: group.id,
      rrule: "FREQ=DAILY",
      dtstart: sessionStamp(start),
      dtend_time: endHhmm,
      valid_from: "2026-01-01",
      occupancy_kind: "program",
      is_active: true,
    })
    .select("id")
    .single();
  if (sErr) throw new Error(`session ${name}: ${sErr.message}`);
  const { error: ssErr } = await admin
    .from("session_spaces")
    .insert({ session_id: session.id, space_id: spaceId, org_id: orgId });
  if (ssErr) throw new Error(`session_spaces ${name}: ${ssErr.message}`);
  return session.id;
}

async function main() {
  const { error: probe } = await admin.from("facility_readings").select("session_id").limit(1);
  const has069 = !probe;
  console.log(`\n  migration 069: ${has069 ? "applied" : "NOT applied — session checks will be skipped"}`);

  // ── Fixtures ──────────────────────────────────────────────────────────────
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ People here ${stamp}`, slug: `zz-people-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const pool = await makeFacility(org.id, "Pool");
  const other = await makeFacility(org.id, "Arena");

  const { data: dept } = await admin
    .from("departments")
    .insert({ org_id: org.id, facility_id: pool.id, name: "Aquatics", slug: `zz-bk-aq-${stamp}`, display_order: 0, is_published: true })
    .select("id")
    .single();
  const { data: otherDept } = await admin
    .from("departments")
    .insert({ org_id: org.id, facility_id: other.id, name: "Arena", slug: `zz-bk-ar-${stamp}`, display_order: 0, is_published: true })
    .select("id")
    .single();

  // UNPUBLISHED on purpose — the Panorama case.
  const laneName = `ZZ Back Lane ${stamp}`;
  const { data: lane } = await admin
    .from("spaces")
    .insert({ org_id: org.id, facility_id: pool.id, department_id: dept.id, name: laneName, slug: `zz-bk-lane-${stamp}`, is_published: false })
    .select("id")
    .single();
  const { data: rink } = await admin
    .from("spaces")
    .insert({ org_id: org.id, facility_id: other.id, department_id: otherDept.id, name: `ZZ Rink ${stamp}`, slug: `zz-bk-rink-${stamp}`, is_published: true })
    .select("id")
    .single();

  const sessionName = `ZZ Lengths ${stamp}`;
  const sessionId = await makeSessionNow(org.id, pool.id, dept.id, lane.id, sessionName);
  const otherSessionId = await makeSessionNow(org.id, other.id, otherDept.id, rink.id, `ZZ Skate ${stamp}`);

  const owner = await makeUser(org.id, "owner", "owner");
  const coord = await makeUser(org.id, "coordinator", "coord", pool.id);
  const guard = await makeUser(org.id, "aux", "guard", pool.id);

  const post = (user, facilityId, body) =>
    fetch(`${APP}/api/facilities/${facilityId}/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify(body),
    });

  // ── 1. API ────────────────────────────────────────────────────────────────
  console.log("\n1. The readings API");

  const unpublished = await post(guard, pool.id, { metric: "headcount", value: 7, space_id: lane.id });
  check("an aux staffer may file a count against an UNPUBLISHED space", unpublished.status === 201, `status ${unpublished.status}`);

  const future = await post(guard, pool.id, {
    metric: "headcount",
    value: 7,
    recorded_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
  });
  check("a time in the future is refused", future.status === 400, `status ${future.status}`);

  if (has069) {
    const cross = await post(guard, pool.id, { metric: "headcount", value: 9, session_id: otherSessionId });
    const crossBody = await cross.json().catch(() => ({}));
    check("a session at ANOTHER facility is refused", cross.status === 400 && /session/i.test(crossBody.error ?? ""), `status ${cross.status} ${crossBody.error ?? ""}`);

    const own = await post(guard, pool.id, { metric: "headcount", value: 11, session_id: sessionId, space_id: lane.id });
    const ownBody = await own.json().catch(() => ({}));
    check("positive control: a session here is accepted and stored", own.status === 201 && ownBody.reading?.session_id === sessionId, `status ${own.status}`);
  } else {
    skipped("session_id cross-facility guard + positive control", "migration 069 not applied");
  }

  // Clean slate for the browser section's "what got written" reads.
  await admin.from("facility_readings").delete().eq("facility_id", pool.id);

  // ── 2. The counter, in a browser ──────────────────────────────────────────
  console.log("\n2. People here, as an aux staffer on a phone");

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
    await ctx.addCookies(guard.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false })));
    const page = await ctx.newPage();
    await page.goto(`${APP}/dashboard/facilities/${pool.id}/status`, { waitUntil: "networkidle" });
    const people = page.locator("#people");
    await people.waitFor({ timeout: 30_000 });

    // Where and Session are native selects since the 2026-10-01 redesign.
    const where = people.locator("#count-where");
    const sessionSelect = people.locator("#count-session");
    check(
      "Where offers the unpublished space",
      (await where.locator("option", { hasText: laneName }).count()) === 1
    );

    const sessionOption = sessionSelect.locator("option", { hasText: new RegExp(sessionName) });
    await sessionOption.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
    check("Session offers the session running now", (await sessionOption.count()) >= 1);
    check(
      "no settings on the status page ('What patrons see' moved to Edit)",
      (await page.getByText("What patrons see").count()) === 0
    );

    check("no 'Recent entries' log on the status page", (await page.getByText("Recent entries").count()) === 0);
    check("no 'History' section on the status page", (await page.getByText("History", { exact: true }).count()) === 0);

    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);

    // Pick the session: a one-space session names the space too.
    await sessionSelect.selectOption(await sessionOption.first().getAttribute("value"));
    check(
      "picking a one-space session selects its space",
      (await where.inputValue()) === lane.id,
      await where.inputValue()
    );
    await people.locator("#count").fill("23");
    await people.getByRole("button", { name: "Record count" }).click();
    await people.getByText("Saved").waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const { data: afterSession } = await admin
      .from("facility_readings")
      .select("*")
      .eq("facility_id", pool.id)
      .order("created_at", { ascending: false });
    const latest = afterSession?.[0];
    check("the count was written", latest?.value == 23, JSON.stringify(latest ?? null));
    check("...against the space", latest?.space_id === lane.id);
    if (has069) check("...and the session", latest?.session_id === sessionId, String(latest?.session_id));
    else skipped("count carries session_id", "migration 069 not applied");
    check("...recorded by the aux staffer", latest?.recorded_by === guard.userId);

    // Earlier today, at a typed time.
    const back = new Date(Date.now() - 20 * 60_000);
    const hhmm = `${pad(back.getHours())}:${pad(back.getMinutes())}`;
    if (back.getDate() === new Date().getDate()) {
      await people.getByRole("radio", { name: "Earlier" }).click();
      await people.getByLabel("Time of the count").fill(hhmm);
      await people.locator("#count").fill("31");
      await people.getByRole("button", { name: "Record count" }).click();
      await page.waitForTimeout(1500);
      const { data: rows } = await admin
        .from("facility_readings")
        .select("*")
        .eq("facility_id", pool.id)
        .eq("value", 31);
      const at = rows?.[0] ? new Date(rows[0].recorded_at) : null;
      check(
        "'Earlier today' files the time typed",
        !!at && at.getHours() === back.getHours() && at.getMinutes() === back.getMinutes(),
        at?.toString() ?? "no row"
      );

      // Undo the entry just made.
      const undo = people.getByRole("button", { name: /Undo/ });
      check("Undo is offered for the entry just made", (await undo.count()) === 1);
      await undo.click();
      await page.waitForTimeout(1500);
      const { count: left31 } = await admin
        .from("facility_readings")
        .select("*", { count: "exact", head: true })
        .eq("facility_id", pool.id)
        .eq("value", 31);
      check("Undo deletes it", left31 === 0, `left ${left31}`);
    } else {
      skipped("'Earlier today' + Undo", "20 minutes ago is yesterday");
    }
    await page.screenshot({ path: path.join(OUT, "status-people-here-390.png"), fullPage: true });
    await ctx.close();

    // ── 3. Analytics ────────────────────────────────────────────────────────
    console.log("\n3. Analytics, as the owner");

    // Notices: one cleared yesterday (in), one draft (out), one unapproved report (out).
    const day = 24 * 3600_000;
    const noticeBase = { org_id: org.id, facility_id: pool.id, category: "mechanical", severity: "closure", body: null };
    const { error: nErr } = await admin.from("facility_notices").insert([
      { ...noticeBase, headline: `ZZ Cleared closure ${stamp}`, starts_at: new Date(Date.now() - day - 3600_000).toISOString(), ends_at: new Date(Date.now() - day).toISOString(), is_published: true },
      { ...noticeBase, headline: `ZZ Draft ${stamp}`, starts_at: new Date(Date.now() - day).toISOString(), ends_at: null, is_published: false },
    ]);
    if (nErr) check("fixture: notices", false, nErr.message);
    const { error: rErr } = await admin.from("facility_notices").insert({
      ...noticeBase, headline: `ZZ Unapproved report ${stamp}`, starts_at: new Date(Date.now() - day).toISOString(), ends_at: null, is_published: false, needs_review: true,
    });
    if (rErr) skipped("unapproved-report fixture", rErr.message);

    const octx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    await octx.addCookies(owner.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false })));
    const op = await octx.newPage();

    await op.goto(`${APP}/dashboard/analytics/attendance?range=7d&facility=${pool.id}`, { waitUntil: "networkidle" });
    check("Attendance has a Count log", (await op.getByRole("heading", { name: "Count log" }).count()) === 1);
    if (has069) {
      check("Attendance has By session", (await op.getByRole("heading", { name: "By session" }).count()) === 1);
      check("the log names the session", (await op.getByText(new RegExp(`${laneName} · ${sessionName}`)).count()) >= 1);
    } else {
      skipped("By session + session in the log", "migration 069 not applied");
    }

    const del = op.getByRole("button", { name: "Delete this entry" });
    const before = await del.count();
    check("the owner may delete entries from the log", before >= 1, `buttons ${before}`);
    if (before >= 1) {
      await del.first().click();
      await op.waitForTimeout(2000);
      const { count: remaining } = await admin
        .from("facility_readings")
        .select("*", { count: "exact", head: true })
        .eq("facility_id", pool.id);
      check("deleting from the log removes the row", remaining === before - 1, `remaining ${remaining}, before ${before}`);
    }
    await op.screenshot({ path: path.join(OUT, "attendance.png"), fullPage: true });

    await op.goto(`${APP}/dashboard/analytics/notices?range=7d`, { waitUntil: "networkidle" });
    check("Status history tab exists", (await op.getByRole("navigation", { name: "Analytics views" }).getByRole("link", { name: "Status history" }).count()) === 1);
    check("it lists the cleared closure", (await op.getByText(`ZZ Cleared closure ${stamp}`).count()) === 1);
    check("it leaves out the draft", (await op.getByText(`ZZ Draft ${stamp}`).count()) === 0);
    if (!rErr) check("it leaves out the unapproved report", (await op.getByText(`ZZ Unapproved report ${stamp}`).count()) === 0);
    await op.screenshot({ path: path.join(OUT, "status-history.png"), fullPage: true });
    await octx.close();
  } finally {
    await browser.close();
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  const csv = (user, dataset) =>
    fetch(`${APP}/api/analytics/export?range=7d&dataset=${dataset}`, { headers: { Cookie: user.cookie } });

  const coordNotices = await csv(coord, "notices");
  const coordText = await coordNotices.text();
  check("a coordinator can export status notices", coordNotices.status === 200 && coordText.includes(`ZZ Cleared closure ${stamp}`), `status ${coordNotices.status}`);
  check("...without the draft", !coordText.includes(`ZZ Draft ${stamp}`));
  const auxNotices = await csv(guard, "notices");
  check("aux is refused the notices export", auxNotices.status === 403, `status ${auxNotices.status}`);
  const attendance = await (await csv(owner, "attendance")).text();
  check("the attendance export has a Session column", attendance.includes("Recorded at,Facility,Space,Session,Measure,Value"));
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.stack ?? e.message}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
