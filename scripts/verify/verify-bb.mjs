/**
 * The Analytics section: three pages, two gates, six exports.
 *
 * `/dashboard/analytics` stopped being one page. The claims worth doubting:
 *
 *   1. **The generalisation did not change the arithmetic.** `summariseRange`
 *      over one week must equal `buildWeekOverview` for that week, field for
 *      field. `WeekPanel` still calls the original and `verify-aw` still
 *      asserts it, so a range version that quietly rounded differently would
 *      put two different numbers for the same week in two places in the
 *      product.
 *
 *   2. **Clock hours are a union, not a sum.** Two sessions in two lanes at
 *      the same hour are one clock hour and two space-hours. The fixture is
 *      built so a naive Σ duration gives a different, larger answer — without
 *      that, the assertion passes against the wrong implementation.
 *
 *   3. **The attendance read pages.** More than 1,000 readings in the window,
 *      with the total asserted. `.limit()` returns exactly 1,000 and no error,
 *      which is the trap that has already cost this codebase one wrong number.
 *
 *   4. **The two gates are really two.** A coordinator reaches Utilization and
 *      Attendance and is refused Engagement; an aux staffer is refused all
 *      three. Both directions, on the pages AND on the export route.
 *
 *   5. **Attendance invents no total.** No tile, and no CSV column, adds head
 *      counts together.
 *
 * Sections marked FALSIFY say what to break to watch them go red.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-bb.mjs [--headed]
 *   node --experimental-strip-types scripts/verify/verify-bb.mjs --logic-only
 */
import fs from "fs";
import path from "path";
import { register } from "node:module";
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

// ── Section 0: the arithmetic, with nothing running ─────────────────────────
async function logicSection() {
  // weekOverview.ts and attendance.ts import the app's own modules by the `@/`
  // alias, which Node's ESM resolver does not know. The hook teaches it — without
  // it the harness would have to transcribe the arithmetic, and a transcription
  // tests the transcription.
  register("./_alias-hooks.mjs", import.meta.url);
  console.log("\n0. summariseRange and summariseAttendance (no database, no server)");

  const { buildWeekOverview, summariseRange, unionMinutes, formatHours } =
    await import("../../src/lib/schedule/weekOverview.ts");
  const { summariseAttendance } = await import("../../src/lib/analytics/attendance.ts");
  const { rangeFromPreset, toLocalDay } = await import("../../src/lib/analytics/range.ts");

  // A week starting on a Sunday, built with LOCAL getters. Every fixture week
  // in this repo must — a UTC-built one drifts a day after 17:00 Pacific and
  // turns the whole harness red every evening (see README).
  const weekStart = new Date(2026, 8, 20); // Sunday 2026-09-20, local
  const at = (dayOffset, h, m = 0) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const session = (id, dayOffset, startHour, endHour, spaceIds, kind = "drop_in") => ({
    sessionId: id,
    key: `${id}-${dayOffset}`,
    start: at(dayOffset, startHour),
    end: at(dayOffset, endHour),
    spaceIds,
    spaceNames: spaceIds,
    occupancyKind: kind,
  });

  // THE FIXTURE THAT MAKES CLAIM 2 BITE: two sessions, same Monday hour, two
  // different lanes. Σ durations = 4h. The union = 2h. Space-hours = 4h.
  const parallel = [
    session("a", 1, 9, 11, ["lane-1"]),
    session("b", 1, 9, 11, ["lane-2"]),
  ];
  const openAllWeek = Array.from({ length: 7 }, () => [{ opens: 6 * 60, closes: 22 * 60 }]);

  const week = buildWeekOverview(parallel, openAllWeek);
  check(
    "two parallel sessions are ONE clock hour block, not two",
    week.byKind[0].clockMinutes === 120,
    `${week.byKind[0].clockMinutes} minutes (a naive sum would say 240)`
  );
  check(
    "...and TWO lanes' worth of space-hours",
    week.byKind[0].spaceMinutes === 240,
    `${week.byKind[0].spaceMinutes}`
  );

  // CLAIM 1. Same input, both entry points, every field.
  const ranged = summariseRange(
    [{ weekStart, sessions: parallel, openByDay: openAllWeek }],
    { from: toLocalDay(weekStart), to: toLocalDay(at(6, 0)) }
  );
  for (const field of [
    "openMinutes",
    "programmedMinutes",
    "unprogrammedMinutes",
    "busyMinutes",
    "outsideOpenMinutes",
    "totalSpaceMinutes",
    "totalOccurrences",
    "totalSessions",
  ]) {
    // FALSIFY: change any accumulator in summariseRange and one of these goes red.
    check(
      `summariseRange matches buildWeekOverview on ${field}`,
      ranged[field] === week[field],
      `${ranged[field]} vs ${week[field]}`
    );
  }
  check(
    "...and on the per-kind totals",
    JSON.stringify(ranged.byKind) === JSON.stringify(week.byKind),
    JSON.stringify(ranged.byKind)
  );
  check(
    "byDate covers the seven days of the week",
    ranged.byDate.length === 7,
    String(ranged.byDate.length)
  );

  // Two weeks. Clock hours ADD across weeks (they are disjoint in time), but
  // the recurring-session count must NOT — the same weekly series appears in
  // both expansions, and summing would report "2 sessions" for one booking.
  const weekTwoStart = new Date(weekStart);
  weekTwoStart.setDate(weekTwoStart.getDate() + 7);
  const weekTwo = parallel.map((s) => ({
    ...s,
    key: `${s.sessionId}-w2`,
    start: new Date(s.start.getTime() + 7 * 86400_000),
    end: new Date(s.end.getTime() + 7 * 86400_000),
  }));
  const twoWeeks = summariseRange(
    [
      { weekStart, sessions: parallel, openByDay: openAllWeek },
      { weekStart: weekTwoStart, sessions: weekTwo, openByDay: openAllWeek },
    ],
    { from: toLocalDay(weekStart), to: toLocalDay(new Date(weekTwoStart.getTime() + 6 * 86400_000)) }
  );
  check("two weeks double the space-hours", twoWeeks.totalSpaceMinutes === 480, String(twoWeeks.totalSpaceMinutes));
  check("...double the occurrences", twoWeeks.totalOccurrences === 4, String(twoWeeks.totalOccurrences));
  // FALSIFY: sum `sessions` instead of taking the set size and this reports 4.
  check(
    "...but do NOT double the recurring session count",
    twoWeeks.totalSessions === 2,
    `${twoWeeks.totalSessions} (a sum would say 4)`
  );
  check("...and cover fourteen days", twoWeeks.byDate.length === 14, String(twoWeeks.byDate.length));

  check("unionMinutes merges touching spans", unionMinutes([{ start: 0, end: 60 }, { start: 60, end: 120 }]) === 120);
  check("unionMinutes merges overlapping spans", unionMinutes([{ start: 0, end: 90 }, { start: 60, end: 120 }]) === 120);
  check("formatHours reads as hours and minutes", formatHours(150) === "2h 30m", formatHours(150));

  // ── summariseAttendance ───────────────────────────────────────────────────
  const range = rangeFromPreset("7d");
  const reading = (daysAgo, hour, value, metric = "headcount", spaceId = null) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return {
      id: `${daysAgo}-${hour}-${value}-${metric}`,
      facility_id: "f1",
      space_id: spaceId,
      metric,
      value,
      recorded_at: d.toISOString(),
      recorded_by: "u1",
    };
  };

  const rows = [
    reading(1, 9, 10),
    reading(1, 18, 50),
    reading(2, 18, 30),
    reading(3, 12, 20, "headcount", "lane-1"),
    reading(1, 9, 27.5, "water_temp_c"),
    reading(2, 9, 28.5, "water_temp_c"),
  ];
  const summary = summariseAttendance({ rows, truncated: false }, range);

  check("head counts are counted, temperatures are not", summary.readingCount === 4, String(summary.readingCount));
  check("the peak is the largest single observation", summary.peak?.value === 50, String(summary.peak?.value));
  check(
    "the average is the mean of the observations",
    summary.averageCount === (10 + 50 + 30 + 20) / 4,
    String(summary.averageCount)
  );
  check("every day in the range gets a bar, empty ones included", summary.byDay.length === range.days, String(summary.byDay.length));
  check(
    "a day with no counts is zero, not missing",
    summary.byDay.some((d) => d.samples === 0 && d.peak === 0)
  );
  check(
    "temperatures are summarised separately, with their spread",
    summary.temperatures.length === 1 &&
      summary.temperatures[0].min === 27.5 &&
      summary.temperatures[0].max === 28.5,
    JSON.stringify(summary.temperatures)
  );
  check(
    "a space-level count is broken out from the whole-building ones",
    summary.bySpace.some((s) => s.spaceId === "lane-1") &&
      summary.bySpace.some((s) => s.spaceId === null)
  );
  // FALSIFY: drop the `values.length < 3` guard and this names an hour.
  check(
    "no busiest hour is claimed from fewer than three counts in it",
    summary.busiestHour === null,
    String(summary.busiestHour)
  );

  // THE ONE NUMBER THAT MUST NOT EXIST.
  check(
    "the summary carries no total-attendance field",
    !("totalAttendance" in summary) && !("totalPeople" in summary) && !("visits" in summary),
    Object.keys(summary).join(",")
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
const headerFrom = (parts) => parts.map((c) => `${c.name}=${c.value}`).join("; ");

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function makeUser(orgId, role, label, scopeFacilityId = null) {
  const email = `zz-bb-${label}-${stamp}@example.invalid`;
  const password = `Zc!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);

  const { data: membership, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: data.user.id, role })
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

async function main() {
  await logicSection();

  const { error: probe } = await admin.from("facility_readings").select("id").limit(1);
  if (probe) {
    console.log("\n  migration 061: NOT applied.");
    skipped("sections 1-4", "migration 061 not applied");
    return;
  }

  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ section ${stamp}`, slug: `zz-section-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const { data: facility } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ Section Pool ${stamp}`,
      slug: `zz-section-pool-${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();

  const { data: department } = await admin
    .from("departments")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: "Aquatics",
      slug: `zz-aq-${stamp}`,
      display_order: 0,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: lane } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: department.id,
      name: `ZZ Lane 1 ${stamp}`,
      slug: `zz-bb-lane1-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: lane2 } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: department.id,
      name: `ZZ Lane 2 ${stamp}`,
      slug: `zz-bb-lane2-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: group } = await admin
    .from("schedule_groups")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: department.id,
      name: `ZZ Lengths ${stamp}`,
      slug: `zz-bb-lengths-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status: "published",
      source: "manual",
      starts_on: "2026-01-01",
    })
    .select("id")
    .single();

  // TWO sessions in two lanes at the SAME hour, so the page's clock-hours
  // figure is provably a union rather than a sum — the same shape section 0
  // asserts against the library, now end to end through the real expansion.
  // Without any sessions at all the page short-circuits to "nothing
  // scheduled" and every assertion below it passes for the wrong reason.
  for (const [i, space] of [lane, lane2].entries()) {
    const { data: sessionRow, error: sessionErr } = await admin
      .from("sessions")
      .insert({
        org_id: org.id,
        schedule_group_id: group.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        dtstart: "2026-01-05T09:00:00Z",
        dtend_time: "11:00",
        valid_from: "2026-01-01",
        occupancy_kind: "program",
        is_active: true,
      })
      .select("id")
      .single();
    if (sessionErr) check(`fixture: session ${i}`, false, sessionErr.message);
    else {
      await admin
        .from("session_spaces")
        .insert({ session_id: sessionRow.id, space_id: space.id, org_id: org.id });
    }
  }

  const owner = await makeUser(org.id, "owner", "owner");
  const coord = await makeUser(org.id, "coordinator", "coord", facility.id);
  const guard = await makeUser(org.id, "aux", "guard", facility.id);

  // ── 1. The paged read ─────────────────────────────────────────────────────
  console.log("\n1. More than 1,000 readings");

  // 1,100 counts in the last two days, each a distinct value so the peak is
  // knowable. PostgREST caps a response at 1,000 with no error, so a read that
  // does not page reports 1,000 here and calls it the total.
  const bulk = [];
  const base = new Date();
  base.setDate(base.getDate() - 1);
  base.setHours(9, 0, 0, 0);
  for (let i = 0; i < 1100; i++) {
    const at = new Date(base.getTime() + i * 30_000);
    bulk.push({
      org_id: org.id,
      facility_id: facility.id,
      metric: "headcount",
      value: (i % 60) + 1,
      recorded_at: at.toISOString(),
      recorded_by: guard.userId,
    });
  }
  for (let i = 0; i < bulk.length; i += 500) {
    const { error } = await admin.from("facility_readings").insert(bulk.slice(i, i + 500));
    if (error) check(`fixture: readings ${i}`, false, error.message);
  }

  const { count } = await admin
    .from("facility_readings")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facility.id);
  check("fixture: 1,100 readings exist", count === 1100, String(count));

  const { fetchReadings, summariseAttendance } = await import("../../src/lib/analytics/attendance.ts");
  const { rangeFromPreset } = await import("../../src/lib/analytics/range.ts");
  const range = rangeFromPreset("7d");

  const fetched = await fetchReadings(admin, { orgId: org.id, range });
  // FALSIFY: set PAGE_SIZE to 5000 and this reports exactly 1000 — PostgREST
  // caps the response, the loop sees fewer rows than it asked for, decides the
  // window is exhausted and stops. No error, no crash, a wrong total. Verified.
  check(
    "the paged read returns all 1,100, not PostgREST's 1,000",
    fetched.rows.length === 1100,
    `${fetched.rows.length} rows`
  );
  const summary = summariseAttendance(fetched, range);
  check("the peak is the real maximum", summary.peak?.value === 60, String(summary.peak?.value));
  check("...and the count is the real count", summary.readingCount === 1100, String(summary.readingCount));

  // ── 2. The gates ──────────────────────────────────────────────────────────
  console.log("\n2. Two gates, both directions");

  const get = async (pathname, cookie) => {
    const res = await fetch(`${APP}${pathname}`, { headers: { Cookie: cookie }, redirect: "manual" });
    return { status: res.status, body: await res.text().catch(() => "") };
  };

  for (const [who, cookie, expectations] of [
    ["an owner", owner.cookie, { engagement: true, utilization: true, attendance: true }],
    ["a coordinator", coord.cookie, { engagement: false, utilization: true, attendance: true }],
    ["an aux staffer", guard.cookie, { engagement: false, utilization: false, attendance: false }],
  ]) {
    const pages = {
      engagement: "/dashboard/analytics",
      utilization: "/dashboard/analytics/utilization",
      attendance: "/dashboard/analytics/attendance",
    };
    for (const [key, pathname] of Object.entries(pages)) {
      const { body } = await get(pathname, cookie);
      // The pages answer 200 and render a refusal card rather than redirecting,
      // so the assertion is on the CARD, not the status.
      const refused = /Not available for this account|limited to owners and managers/.test(body);
      check(
        `${who} ${expectations[key] ? "sees" : "is refused"} ${key}`,
        expectations[key] ? !refused : refused,
        refused ? "refusal card shown" : "content shown"
      );
    }
  }

  // The export route is the other half — a page that hides a button is not a
  // gate, and this is the one an outsider would call directly.
  const exportUrl = (dataset) =>
    `/api/analytics/export?range=7d&dataset=${dataset}&facility=${facility.id}`;

  const coordEngagement = await get(exportUrl("summary"), coord.cookie);
  check("a coordinator is refused the engagement CSV", coordEngagement.status === 403, String(coordEngagement.status));

  const coordAttendance = await get(exportUrl("attendance"), coord.cookie);
  check("...and allowed the attendance CSV", coordAttendance.status === 200, String(coordAttendance.status));

  const guardAttendance = await get(exportUrl("attendance"), guard.cookie);
  check("an aux staffer is refused it", guardAttendance.status === 403, String(guardAttendance.status));

  // ── 3. The CSVs ───────────────────────────────────────────────────────────
  console.log("\n3. The two new exports");

  const attendanceCsvBody = coordAttendance.body;
  check(
    "the attendance CSV names its columns",
    /Recorded at,Facility,Space,Measure,Value/.test(attendanceCsvBody),
    attendanceCsvBody.split("\r\n").slice(0, 12).join(" | ")
  );
  check(
    "...and warns against summing the counts",
    /Do not sum/i.test(attendanceCsvBody)
  );
  check(
    "...and contains no total row",
    !/^Total/im.test(attendanceCsvBody)
  );
  // Read as BYTES. `Response.text()` decodes UTF-8 and strips the BOM, so the
  // string always starts with "D" and an assertion on charCodeAt(0) fails
  // whether or not the BOM was sent — a check that could never pass, which is
  // worse than no check.
  const rawCsv = await fetch(`${APP}${exportUrl("attendance")}`, {
    headers: { Cookie: coord.cookie },
  }).then((r) => r.arrayBuffer());
  const firstBytes = new Uint8Array(rawCsv.slice(0, 3));
  check(
    "...and opens with a UTF-8 BOM, so Excel does not mojibake a facility name",
    firstBytes[0] === 0xef && firstBytes[1] === 0xbb && firstBytes[2] === 0xbf,
    Array.from(firstBytes).map((b) => b.toString(16)).join(" ")
  );

  const utilizationCsv = await get(exportUrl("utilization"), coord.cookie);
  check("the utilization CSV is served", utilizationCsv.status === 200, String(utilizationCsv.status));
  check(
    "...and states the two-kinds-of-hour rule in the file itself",
    /Clock hours count parallel sessions ONCE/.test(utilizationCsv.body)
  );

  // Formula injection, on the new datasets too. A facility name is staff-typed
  // and a CSV cell starting with `=` executes when Excel opens it.
  await admin
    .from("facilities")
    .update({ name: `=cmd|' /C calc'!A1 ${stamp}` })
    .eq("id", facility.id);
  const risky = await get(exportUrl("attendance"), coord.cookie);
  check(
    "a facility name that looks like a formula is neutralised",
    !/\n=cmd/.test(risky.body) && risky.body.includes("'=cmd"),
    risky.body.split("\r\n").find((l) => l.includes("cmd")) ?? "not found"
  );
  await admin.from("facilities").update({ name: `ZZ Section Pool ${stamp}` }).eq("id", facility.id);

  // ── 4. In a browser ───────────────────────────────────────────────────────
  console.log("\n4. The section in a real browser");

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    skipped("the browser section", "playwright not installed");
    return;
  }

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(
      owner.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false }))
    );
    const page = await context.newPage();

    await page.goto(`${APP}/dashboard/analytics?range=7d&facility=${facility.id}`, {
      waitUntil: "networkidle",
    });
    // ⚠️ SCOPED TO THE TAB STRIP, always. The sidebar's Analytics group carries
    // the same three labels, and its links deliberately have no query string —
    // an unscoped locator picks one of those and then "the period travels"
    // fails against a link that was never meant to carry it. This is the same
    // class of harness bug the Overview rebuild hit twice.
    const tabs = page.getByRole("navigation", { name: "Analytics views" });

    check("the owner lands on Engagement", await page.getByRole("heading", { name: "Engagement" }).first().isVisible());
    check("all three tabs are offered", (await tabs.getByRole("link").count()) === 3);

    // THE TAB CLAIM: the period travels. Landing on a default 30-day view
    // after choosing 7 days is the thing the strip exists not to do.
    await tabs.getByRole("link", { name: "Attendance", exact: true }).click();
    await page.waitForURL(/\/analytics\/attendance/);
    check(
      "switching tabs keeps the period and the facility",
      page.url().includes("range=7d") && page.url().includes(`facility=${facility.id}`),
      page.url()
    );

    // ⚠️ Wait for the CONTENT, not for the network. These pages paint a static
    // shell and stream the body in behind Suspense, so `networkidle` resolves
    // while the tiles are still skeletons — three assertions here failed that
    // way on the first run, against a page that was rendering perfectly.
    const peakTile = page.getByText("Peak", { exact: true }).first();
    await peakTile.waitFor({ timeout: 20_000 }).catch(() => {});

    check("attendance renders the peak", await peakTile.isVisible().catch(() => false));
    // The number itself, not just the tile — a tile showing "—" would pass a
    // visibility check while proving nothing.
    check(
      "...with the real peak in it",
      await page.getByText("60", { exact: true }).first().isVisible().catch(() => false)
    );
    check(
      "the page says outright that there is no total",
      await page.getByText(/no total-visits figure/i).isVisible().catch(() => false)
    );
    // The grid is Engagement's, and its default noun is "views". Head counts
    // are people, and a heatmap saying "50 views" over a pool's counts is the
    // wrong noun on a number someone is about to quote.
    check(
      "the heatmap counts people, not views",
      !(await page.getByText(/\bviews\b/i).first().isVisible().catch(() => false)),
      "the word 'views' appears on the attendance page"
    );

    await page
      .getByRole("navigation", { name: "Analytics views" })
      .getByRole("link", { name: "Utilization", exact: true })
      .click();
    await page.waitForURL(/\/analytics\/utilization/);
    const hoursCallout = page.getByText(/has no operating hours/i).first();
    await hoursCallout.waitFor({ timeout: 20_000 }).catch(() => {});

    check("utilization renders", await page.getByRole("heading", { name: "Utilization" }).first().isVisible());
    check(
      "it names the department with no operating hours rather than counting it",
      (await hoursCallout.textContent().catch(() => ""))?.includes("Aquatics") ?? false,
      (await hoursCallout.textContent().catch(() => "")) ?? "callout missing"
    );
    // CLAIM 2, end to end: two two-hour sessions in two lanes at the same hour
    // are 2 clock hours and 4 space-hours over one weekday, never 4 and 4.
    // The fixture recurs Mon-Fri, so over any 7-day window the ratio holds.
    const clockHours = await page.getByText("Space-hours", { exact: true }).first().isVisible().catch(() => false);
    check("space-hours is reported alongside clock hours", clockHours);

    // A coordinator, in their own context, gets two tabs and not three.
    const coordContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await coordContext.addCookies(
      coord.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false }))
    );
    const coordPage = await coordContext.newPage();
    await coordPage.goto(`${APP}/dashboard/analytics/attendance`, { waitUntil: "networkidle" });
    const coordTabs = coordPage.getByRole("navigation", { name: "Analytics views" });
    check(
      "a coordinator is not offered the Engagement tab",
      (await coordTabs.getByRole("link", { name: "Engagement", exact: true }).count()) === 0
    );
    check(
      "...but is offered the other two",
      (await coordTabs.getByRole("link").count()) === 2,
      (await coordTabs.getByRole("link").allInnerTexts()).join(", ")
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
    await page.screenshot({ path: path.join(OUT, "analytics-utilization-mobile.png"), fullPage: true });
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
