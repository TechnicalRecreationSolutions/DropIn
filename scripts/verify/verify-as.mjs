/**
 * Department operating hours + sessions that follow them (migration 058).
 *
 *   npm run dev
 *   node scripts/verify/verify-as.mjs [--app=http://localhost:3001]
 *
 * NEEDS MIGRATION 058 APPLIED. It probes for the table and column first and
 * stops with instructions rather than reporting a wall of failures.
 *
 * What is actually under test is the claim the feature is built on: an
 * all-day session does not COPY the department's hours, it POINTS at them.
 * So the centre of this file is section 4 — change the hours through the real
 * API, re-expand, and assert the occurrences moved while `sessions.dtstart`
 * did not. Everything else exists to make that assertion mean something.
 *
 * Following the rules in README.md:
 *
 *   * Every negative has a positive control. "Wednesday produces no
 *     occurrence" is asserted alongside a fixed-time session on the SAME
 *     Wednesday that does appear — otherwise a broken fixture, an empty
 *     range or a wrong week would all read as a pass.
 *   * The service role builds fixtures; a really signed-in user does the
 *     acting, over cookies, through the real routes.
 *   * The mechanism, not the outcome: section 7 asserts an exclusive program
 *     inside the morning window 409s AND that the same program in the midday
 *     gap does not. Only checking that "a conflict was reported" would pass
 *     with the hours ignored entirely.
 *
 * The fixture week is 2026-11-02 (a Monday) — fixed dates, never "today", so
 * this does not go red in the evening the way verify-p/q/r/s did (see
 * README.md's note on harness weeks matching the app).
 */
import fs from "fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

/**
 * `--logic-only` runs section 0 alone: the real expandOccurrenceTimes() and
 * the real operating-hours helpers, imported from src/, with no database, no
 * server and no migration applied. It is the only part of this file that can
 * run before 058 reaches a database, and it covers the arithmetic the rest of
 * the feature rests on.
 *
 *   node --experimental-strip-types scripts/verify/verify-as.mjs --logic-only
 */
const LOGIC_ONLY = process.argv.includes("--logic-only");

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
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

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

// The fixture week. MON=2026-11-02 .. SUN=2026-11-08.
// sessionWeekStart() is SUNDAY-based (src/lib/utils/dates.ts), so the week
// containing MON begins the day before it. The per-week review gate (037)
// keys on that Sunday — using MON there silently matches nothing.
const SUN = "2026-11-01";
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";
const RANGE = `rangeStart=2026-11-02T00:00:00.000Z&rangeEnd=2026-11-08T23:59:59.000Z`;

/** Occurrences of one session, sorted, as "YYYY-MM-DD HH:MM–HH:MM" strings.
 *  Times read off the ISO digits directly: an occurrence is wall-clock digits
 *  wearing a meaningless "Z" (src/lib/rrule/README.md), so slicing the string
 *  is correct and `new Date(...).getHours()` would not be. */
function occurrencesOf(body, sessionId) {
  return (body.data ?? [])
    .filter((s) => s.sessionId === sessionId)
    .map((s) => `${s.start.slice(0, 10)} ${s.start.slice(11, 16)}–${s.end.slice(11, 16)}`)
    .sort();
}

/**
 * Section 0 — the resolution arithmetic, against the real modules.
 *
 * Runs in every mode. It needs no database, so it is also what tells you
 * whether a failure further down is a logic bug or a schema/RLS one.
 */
async function logicChecks() {
  register("./_alias-hooks.mjs", import.meta.url);
  const { expandOccurrenceTimes } = await import("../../src/lib/rrule/expand.ts");
  const hours = await import("../../src/lib/schedule/operating-hours.ts");

  console.log("\n0. Resolution arithmetic (real modules, no database)");

  // --- the helpers ------------------------------------------------------
  check("timeToMinutes parses HH:MM:SS", hours.timeToMinutes("06:30:00") === 390);
  check("timeToMinutes rejects nonsense rather than returning NaN", hours.timeToMinutes("25:00") === null);
  check(
    "mergeWindows joins TOUCHING windows (no seam where the building never closed)",
    JSON.stringify(hours.mergeWindows([{ opens: 360, closes: 720 }, { opens: 720, closes: 1260 }])) ===
      JSON.stringify([{ opens: 360, closes: 1260 }])
  );
  check(
    "mergeWindows KEEPS a genuine gap",
    hours.mergeWindows([{ opens: 360, closes: 720 }, { opens: 960, closes: 1260 }]).length === 2
  );
  check(
    "mergeWindows collapses an overlap without shrinking it",
    JSON.stringify(hours.mergeWindows([{ opens: 360, closes: 720 }, { opens: 660, closes: 1260 }])) ===
      JSON.stringify([{ opens: 360, closes: 1260 }])
  );

  const grouped = hours.groupHoursByDepartment([
    { department_id: "d1", day_of_week: 1, opens_at: "16:00:00", closes_at: "21:00:00" },
    { department_id: "d1", day_of_week: 1, opens_at: "06:00:00", closes_at: "12:00:00" },
    { department_id: "d1", day_of_week: 9, opens_at: "06:00:00", closes_at: "07:00:00" },
    { department_id: "d1", day_of_week: 2, opens_at: "08:00:00", closes_at: "08:00:00" },
  ]);
  // groupHoursByDepartment returns { week, overrides } since 059; the weekly
  // helpers below still take the bare week.
  const departmentHours = grouped.get("d1");
  const week = departmentHours.week;
  check("grouping sorts a day's windows regardless of row order", week[1][0].opens === 360);
  check("an out-of-range day_of_week row is dropped", week.length === 7);
  check("a zero-length window is dropped, not stored as a sliver", week[2].length === 0);
  check(
    "widestWindowOfDay flattens the midday gap (snapshot only)",
    JSON.stringify(hours.widestWindowOfDay(week, 1)) === JSON.stringify({ opens: 360, closes: 1260 })
  );
  check("firstOpenDayFrom skips a closed start day", hours.firstOpenDayFrom(week, 0) === 1);
  check("firstOpenDayFrom returns null for a wholly closed week", hours.firstOpenDayFrom(hours.emptyWeek(), 0) === null);
  check(
    `summarizeWeek collapses runs and starts on Monday (got "${hours.summarizeWeek(week)}")`,
    hours.summarizeWeek(week).startsWith("Mon 6:00 AM–12:00 PM, 4:00 PM–9:00 PM")
  );

  // --- the expansion ----------------------------------------------------
  // MON 2026-11-02 .. SUN 2026-11-08. Monday split, Tuesday one window,
  // Wednesday closed.
  const fixtureWeekDays = hours.emptyWeek();
  fixtureWeekDays[1] = [{ opens: 360, closes: 720 }, { opens: 960, closes: 1260 }];
  fixtureWeekDays[2] = [{ opens: 360, closes: 1260 }];
  // No holiday overrides here — those are verify-at's subject.
  const fixtureWeek = { week: fixtureWeekDays, overrides: new Map() };

  const session = {
    id: "s1",
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE",
    dtstart: "2026-11-02T09:00:00Z",
    dtend_time: "10:00",
    valid_from: "2026-11-02",
    valid_until: null,
    follows_operating_hours: true,
  };
  const range = {
    rangeStart: new Date("2026-11-02T00:00:00Z"),
    rangeEnd: new Date("2026-11-08T23:59:59Z"),
  };

  const show = (occ) =>
    occ.map((o) => `${o.start.toISOString().slice(0, 10)} ${o.start.toISOString().slice(11, 16)}–${o.end.toISOString().slice(11, 16)}`);

  const followed = expandOccurrenceTimes(session, [], range, fixtureWeek);
  const shown = show(followed);
  check(
    `Monday splits into two occurrences (got ${JSON.stringify(shown)})`,
    shown.includes("2026-11-02 06:00–12:00") && shown.includes("2026-11-02 16:00–21:00")
  );
  check("Tuesday is one long occurrence", shown.includes("2026-11-03 06:00–21:00"));
  check("the closed Wednesday yields nothing", !shown.some((s) => s.startsWith("2026-11-04")));
  check("the stored 09:00–10:00 is never used", !shown.some((s) => s.includes("09:00–10:00")));
  check("three occurrences in the week", followed.length === 3, JSON.stringify(shown));
  check(
    "the two Monday occurrences carry different windowIndex values",
    followed.filter((o) => o.occurrenceDate === "2026-11-02").map((o) => o.windowIndex).join() === "0,1"
  );

  // POSITIVE CONTROL: identical session, flag off — proves the absences above
  // are the hours doing their job and not a dead rrule or an empty range.
  const fixedShown = show(
    expandOccurrenceTimes({ ...session, follows_operating_hours: false }, [], range, fixtureWeek)
  );
  check(
    "CONTROL: with the flag off the SAME rrule yields all three days at the stored times",
    fixedShown.length === 3 && fixedShown.every((s) => s.includes("09:00–10:00")),
    JSON.stringify(fixedShown)
  );

  // Hours absent entirely -> falls back rather than vanishing.
  const orphanShown = show(expandOccurrenceTimes(session, [], range, undefined));
  check(
    "with no hours at all the session falls back to its stored times",
    orphanShown.length === 3 && orphanShown.every((s) => s.includes("09:00–10:00")),
    JSON.stringify(orphanShown)
  );
  check(
    "an all-closed week is treated as 'no hours', not 'never runs'",
    show(expandOccurrenceTimes(session, [], range, hours.emptyOperatingHours())).length === 3
  );

  // Exceptions still key on the date, across both windows.
  const cancelled = expandOccurrenceTimes(
    session,
    [{ session_id: "s1", exception_date: "2026-11-02", exception_type: "cancelled", modified_start: null, modified_end: null, note: null }],
    range,
    fixtureWeek
  );
  check(
    "cancelling a date drops BOTH of its windows",
    !show(cancelled).some((s) => s.startsWith("2026-11-02")) && cancelled.length === 1,
    JSON.stringify(show(cancelled))
  );

  const modified = expandOccurrenceTimes(
    session,
    [{
      session_id: "s1",
      exception_date: "2026-11-02",
      exception_type: "modified",
      modified_start: "2026-11-02T09:00:00Z",
      modified_end: "2026-11-02T11:00:00Z",
      note: "Meet",
    }],
    range,
    fixtureWeek
  );
  const modMonday = show(modified).filter((s) => s.startsWith("2026-11-02"));
  check(
    `a modified date COLLAPSES to one occurrence rather than duplicating across windows (got ${JSON.stringify(modMonday)})`,
    modMonday.length === 1 && modMonday[0] === "2026-11-02 09:00–11:00"
  );

  // THE ANCHOR. rule.between() clamps on instants, so for a following session
  // the arbitrary stored time-of-day must not decide whether a DAY is in
  // range — its real hours have not been consulted yet at that point.
  //
  // The boundary that exposes it is the range END. Wednesday's real hours are
  // 06:00–11:00, the range ends Wednesday midday, and the stored snapshot
  // says 21:00. Unanchored, rrule generates Wednesday at 21:00 — past
  // rangeEnd — and the whole day is dropped, even though the department's
  // actual opening sits squarely inside what was asked for. Anchored, the day
  // is generated and the window filter then judges it on its real hours.
  const wedWeekDays = hours.emptyWeek();
  wedWeekDays[3] = [{ opens: 360, closes: 660 }];
  const wedWeek = { week: wedWeekDays, overrides: new Map() };
  const edgeRange = {
    rangeStart: new Date("2026-11-02T00:00:00Z"),
    rangeEnd: new Date("2026-11-04T12:00:00Z"),
  };
  const lateSnapshot = { ...session, rrule: "FREQ=WEEKLY;BYDAY=WE", dtstart: "2026-11-04T21:00:00Z" };
  const anchorShown = show(expandOccurrenceTimes(lateSnapshot, [], edgeRange, wedWeek));
  check(
    `a late stored dtstart does not cost a day whose real hours are in range (got ${JSON.stringify(anchorShown)})`,
    anchorShown.length === 1 && anchorShown[0] === "2026-11-04 06:00–11:00"
  );
  check(
    "CONTROL: with the flag off the same session is clamped on its stored time and drops out",
    show(
      expandOccurrenceTimes({ ...lateSnapshot, follows_operating_hours: false }, [], edgeRange, wedWeek)
    ).length === 0
  );
  check(
    "a window entirely past rangeEnd is still excluded — the anchor does not drag it in",
    show(
      expandOccurrenceTimes(lateSnapshot, [], {
        rangeStart: new Date("2026-11-02T00:00:00Z"),
        rangeEnd: new Date("2026-11-04T00:00:00Z"),
      }, wedWeek)
    ).length === 0
  );
  // The other half of the same boundary: /api/sessions/expand takes an
  // explicit rangeStart literally, so it need not be midnight. A mid-day
  // rangeStart must keep the windows that are still ahead and drop the ones
  // already over — not lose the whole day, and not return the morning.
  const midDay = show(
    expandOccurrenceTimes(
      session,
      [],
      { rangeStart: new Date("2026-11-02T14:00:00Z"), rangeEnd: new Date("2026-11-08T23:59:59Z") },
      fixtureWeek
    )
  );
  check(
    `a mid-day rangeStart keeps Monday's evening window (got ${JSON.stringify(midDay)})`,
    midDay.includes("2026-11-02 16:00–21:00")
  );
  check(
    "…and drops the morning window that had already finished",
    !midDay.includes("2026-11-02 06:00–12:00"),
    JSON.stringify(midDay)
  );
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

if (LOGIC_ONLY) {
  await logicChecks();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

try {
  await logicChecks();

  // ------------------------------------------------------- migration probe
  const probeTable = await admin.from("department_hours").select("id").limit(1);
  const probeColumn = await admin.from("sessions").select("follows_operating_hours").limit(1);
  if (probeTable.error || probeColumn.error) {
    console.log("\nMigration 058 is not applied to this database.\n");
    console.log(`  department_hours          : ${probeTable.error ? probeTable.error.message : "ok"}`);
    console.log(`  sessions.follows_operating_hours : ${probeColumn.error ? probeColumn.error.message : "ok"}`);
    console.log("\nApply supabase/migrations/058_department_operating_hours.sql, then re-run.");
    process.exit(1);
  }

  // ------------------------------------------------------------- fixtures
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-as ${stamp}`, slug: `zz-verify-as-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-as-${stamp}@example.invalid`;
  const password = `Zp!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  ids.users.push(userData.user.id);
  // `owner`, not `admin` — `admin` was retired by migration 055 and a row
  // carrying it grants nothing, which reads as a broken harness.
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });

  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  const cookie = sessionCookies(signIn.session);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ Pool ${stamp}`,
        slug: `zz-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Victoria",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const department = (
    await admin
      .from("departments")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "Aquatics",
        slug: `aquatics-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  // A second department with NO hours, for the "nothing to follow" guard.
  const dryDepartment = (
    await admin
      .from("departments")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "Fitness",
        slug: `fitness-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const lane = (
    await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: "Lane 1",
        slug: `lane-1-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  // A second lane, kept clear of the drop-in block above, so section 6 can
  // put two EXCLUSIVE claims on one space without the residual rule masking
  // the result.
  const lane2 = (
    await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: "Lane 2",
        slug: `lane-2-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  // Lanes 3 and 4 carry section 7's candidate-side checks: one with an
  // exclusive block inside the open hours, one with the block in the midday
  // gap. Separate lanes so neither can be affected by the other's result.
  const [lane3, lane4] = await Promise.all(
    [3, 4].map(async (n) =>
      (
        await admin
          .from("spaces")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            department_id: department.id,
            name: `Lane ${n}`,
            slug: `lane-${n}-${stamp}`,
            is_published: true,
          })
          .select("id")
          .single()
      ).data
    )
  );

  const group = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        department_id: department.id,
        facility_id: facility.id,
        name: "Lengths",
        slug: `lengths-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        source: "manual",
        status: "published",
        starts_on: MON,
        ends_on: "2026-12-31",
      })
      .select("id")
      .single()
  ).data;

  const dryGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        department_id: dryDepartment.id,
        facility_id: facility.id,
        name: "Weights",
        slug: `weights-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        source: "manual",
        status: "published",
        starts_on: MON,
        ends_on: "2026-12-31",
      })
      .select("id")
      .single()
  ).data;

  // =====================================================================
  console.log("\n1. Writing a week of operating hours through the real route");
  // =====================================================================
  // Monday SPLIT (the case a single open/close pair cannot express), Tuesday
  // one long window, Wednesday closed. Indices are 0=Sunday..6=Saturday.
  const week = [[], [], [], [], [], [], []];
  week[1] = [
    { opens: "06:00", closes: "12:00" },
    { opens: "16:00", closes: "21:00" },
  ];
  week[2] = [{ opens: "06:00", closes: "21:00" }];
  // week[3] (Wednesday) left empty = closed.

  const putHours = await api(`/api/departments/${department.id}/hours`, cookie, {
    method: "PUT",
    body: JSON.stringify({ days: week }),
  });
  check("PUT hours succeeds", putHours.status === 200, JSON.stringify(putHours.body));

  const { data: storedRows } = await admin
    .from("department_hours")
    .select("day_of_week, opens_at, closes_at")
    .eq("department_id", department.id)
    .order("day_of_week")
    .order("opens_at");
  check("three windows stored", (storedRows ?? []).length === 3, JSON.stringify(storedRows));
  check(
    "Monday kept BOTH windows (the midday gap survived the round trip)",
    (storedRows ?? []).filter((r) => r.day_of_week === 1).length === 2,
    JSON.stringify(storedRows)
  );
  check(
    "Wednesday stored no row at all (closed is the absence of rows)",
    !(storedRows ?? []).some((r) => r.day_of_week === 3)
  );

  // Overlapping windows collapse rather than erroring or duplicating.
  const merged = await api(`/api/departments/${dryDepartment.id}/hours`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      days: [[], [{ opens: "06:00", closes: "12:00" }, { opens: "11:00", closes: "21:00" }], [], [], [], [], []],
    }),
  });
  check("PUT with overlapping windows succeeds", merged.status === 200, JSON.stringify(merged.body));
  const { data: mergedRows } = await admin
    .from("department_hours")
    .select("day_of_week, opens_at, closes_at")
    .eq("department_id", dryDepartment.id);
  check(
    "overlapping windows merged into one 06:00–21:00",
    (mergedRows ?? []).length === 1 &&
      mergedRows[0].opens_at.slice(0, 5) === "06:00" &&
      mergedRows[0].closes_at.slice(0, 5) === "21:00",
    JSON.stringify(mergedRows)
  );
  // Put Fitness back to having no hours, for section 5's guard.
  await admin.from("department_hours").delete().eq("department_id", dryDepartment.id);

  const badWindow = await api(`/api/departments/${department.id}/hours`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      days: [[], [{ opens: "21:00", closes: "06:00" }], [], [], [], [], []],
    }),
  });
  check("an inverted window is rejected, not merged away", badWindow.status === 400, JSON.stringify(badWindow.body));
  // That PUT deleted nothing (it fails before the delete), so the week above
  // is still stored — re-assert rather than assume.
  const { count: stillThree } = await admin
    .from("department_hours")
    .select("id", { count: "exact", head: true })
    .eq("department_id", department.id);
  check("the rejected PUT left the stored week intact", stillThree === 3, `count=${stillThree}`);

  // =====================================================================
  console.log("\n2. A following session resolves per-window, and skips closed days");
  // =====================================================================
  const following = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE",
      // Deliberately nonsense times: if any of them leak into the rendered
      // schedule, the assertions below will show it.
      dtstart: `${MON}T09:00:00Z`,
      dtend_time: "10:00",
      follows_operating_hours: true,
      valid_from: MON,
      space_ids: [lane.id],
      occupancy_kind: "drop_in",
      disclosure: "public",
    }),
  });
  check("following session creates", following.status < 300, JSON.stringify(following.body));
  const followingId = following.body.sessionId;

  // Positive control: same days, same space, fixed times — proves the range,
  // the week and the space all work, so a missing Wednesday above is about
  // the hours and nothing else.
  const fixed = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE",
      dtstart: `${MON}T13:00:00Z`,
      dtend_time: "14:00",
      valid_from: MON,
      space_ids: [],
      occupancy_kind: "drop_in",
      disclosure: "public",
    }),
  });
  check("fixed-time control session creates", fixed.status < 300, JSON.stringify(fixed.body));
  const fixedId = fixed.body.sessionId;

  const expanded = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, cookie);
  check("expand answers 200", expanded.status === 200, JSON.stringify(expanded.body).slice(0, 300));

  const got = occurrencesOf(expanded.body, followingId);
  check(
    `Monday produced TWO occurrences, split around the midday closure (got ${JSON.stringify(got)})`,
    got.includes(`${MON} 06:00–12:00`) && got.includes(`${MON} 16:00–21:00`)
  );
  check(
    "Tuesday produced ONE occurrence spanning the single window",
    got.includes(`${TUE} 06:00–21:00`)
  );
  check(
    "Wednesday produced NO occurrence (department closed)",
    !got.some((o) => o.startsWith(WED)),
    JSON.stringify(got)
  );
  check(
    "the stored 09:00–10:00 never reached the schedule",
    !got.some((o) => o.includes("09:00–10:00")),
    JSON.stringify(got)
  );
  check("exactly three occurrences in the week", got.length === 3, JSON.stringify(got));

  const control = occurrencesOf(expanded.body, fixedId);
  check(
    "POSITIVE CONTROL: the fixed-time session DOES appear on that same Wednesday",
    control.includes(`${WED} 13:00–14:00`),
    JSON.stringify(control)
  );

  // The two Monday blocks must be distinguishable downstream — `key` is a
  // React key and a DOM id, and before 058 it was sessionId + date alone.
  const mondayKeys = (expanded.body.data ?? [])
    .filter((s) => s.sessionId === followingId && s.start.startsWith(MON))
    .map((s) => s.key);
  check(
    `the two Monday occurrences carry distinct keys (${JSON.stringify(mondayKeys)})`,
    mondayKeys.length === 2 && new Set(mondayKeys).size === 2
  );
  check(
    "the first window keeps the pre-058 key spelling",
    mondayKeys.includes(`${followingId}_${MON}`),
    JSON.stringify(mondayKeys)
  );
  check(
    "expanded occurrences are flagged followsOperatingHours",
    (expanded.body.data ?? [])
      .filter((s) => s.sessionId === followingId)
      .every((s) => s.followsOperatingHours === true)
  );

  // =====================================================================
  console.log("\n3. The snapshot columns are written, and are not what renders");
  // =====================================================================
  const { data: storedSession } = await admin
    .from("sessions")
    .select("dtstart, dtend_time, follows_operating_hours")
    .eq("id", followingId)
    .single();
  check("the flag persisted", storedSession.follows_operating_hours === true);
  check(
    `dtstart holds the widest window of the start day, not the submitted 09:00 (got ${storedSession.dtstart})`,
    storedSession.dtstart.slice(11, 16) === "06:00"
  );
  check(
    `dtend_time holds the day's latest close (got ${storedSession.dtend_time})`,
    storedSession.dtend_time.slice(0, 5) === "21:00"
  );

  // =====================================================================
  console.log("\n4. THE POINT: changing the hours moves the sessions");
  // =====================================================================
  const before = JSON.stringify(storedSession);

  const shifted = [[], [], [], [], [], [], []];
  shifted[1] = [{ opens: "07:30", closes: "11:00" }]; // split gone, opens later
  shifted[2] = [{ opens: "06:00", closes: "21:00" }];
  shifted[3] = [{ opens: "08:00", closes: "20:00" }]; // Wednesday now OPEN
  const reput = await api(`/api/departments/${department.id}/hours`, cookie, {
    method: "PUT",
    body: JSON.stringify({ days: shifted }),
  });
  check("PUT new hours succeeds", reput.status === 200, JSON.stringify(reput.body));
  check(
    "the route reports how many sessions follow these hours",
    reput.body.sessionsFollowing === 1,
    JSON.stringify(reput.body)
  );

  const after = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, cookie);
  const moved = occurrencesOf(after.body, followingId);
  check(
    `Monday now has ONE occurrence at the new hours (got ${JSON.stringify(moved)})`,
    moved.filter((o) => o.startsWith(MON)).length === 1 && moved.includes(`${MON} 07:30–11:00`)
  );
  check(
    "Wednesday now HAS an occurrence, because the department opened that day",
    moved.includes(`${WED} 08:00–20:00`),
    JSON.stringify(moved)
  );

  const { data: afterRow } = await admin
    .from("sessions")
    .select("dtstart, dtend_time, follows_operating_hours")
    .eq("id", followingId)
    .single();
  check(
    "the session row itself was never rewritten — the times are derived, not copied",
    JSON.stringify(afterRow) === before,
    `${before} -> ${JSON.stringify(afterRow)}`
  );

  const controlAfter = occurrencesOf(after.body, fixedId);
  check(
    "POSITIVE CONTROL: the fixed-time session did NOT move",
    controlAfter.includes(`${MON} 13:00–14:00`),
    JSON.stringify(controlAfter)
  );

  // =====================================================================
  console.log("\n5. The write guard, and the fallback");
  // =====================================================================
  const noHours = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: dryGroup.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T09:00:00Z`,
      dtend_time: "10:00",
      follows_operating_hours: true,
      valid_from: MON,
      space_ids: [],
    }),
  });
  check(
    "following a department with no hours is refused at write time",
    noHours.status === 400,
    JSON.stringify(noHours.body)
  );

  // A partial update (the shape the reschedule/duplicate callers send) must
  // not silently clear the flag.
  const partial = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      sessionId: followingId,
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE",
      dtstart: `${MON}T06:00:00Z`,
      dtend_time: "21:00",
      valid_from: MON,
      space_ids: [lane.id],
    }),
  });
  check("a partial update succeeds", partial.status < 300, JSON.stringify(partial.body));
  const { data: afterPartial } = await admin
    .from("sessions")
    .select("follows_operating_hours")
    .eq("id", followingId)
    .single();
  check(
    "a payload that never mentions the flag leaves it set",
    afterPartial.follows_operating_hours === true
  );

  // Hours deleted entirely: the session degrades to its snapshot rather than
  // vanishing from the schedule.
  //
  // The expected times are READ BACK from the row rather than hard-coded,
  // because the partial update above re-derived the snapshot from the hours
  // in force at that moment (section 4 had already shifted Monday to
  // 07:30–11:00). That refresh is correct and wanted — the snapshot should
  // track the last save — and pinning a literal here would make this
  // assertion a record of test ordering instead of the invariant, which is
  // "the fallback is exactly what the columns hold".
  const { data: snapshotRow } = await admin
    .from("sessions")
    .select("dtstart, dtend_time")
    .eq("id", followingId)
    .single();
  const expectedFallback = `${snapshotRow.dtstart.slice(11, 16)}–${snapshotRow.dtend_time.slice(0, 5)}`;

  await admin.from("department_hours").delete().eq("department_id", department.id);
  const orphaned = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, cookie);
  const fallback = occurrencesOf(orphaned.body, followingId);
  check(
    `with the hours gone the session falls back to its stored snapshot (${expectedFallback}) rather than disappearing (got ${JSON.stringify(fallback)})`,
    fallback.length > 0 && fallback.every((o) => o.endsWith(expectedFallback))
  );
  check(
    "and it is back to one occurrence per rrule day, including Wednesday",
    fallback.length === 3 && fallback.some((o) => o.startsWith(WED)),
    JSON.stringify(fallback)
  );

  // Restore the shifted week for section 6.
  await api(`/api/departments/${department.id}/hours`, cookie, {
    method: "PUT",
    body: JSON.stringify({ days: week }),
  });

  // =====================================================================
  console.log("\n6. Anonymous visitors see the same resolved times");
  // =====================================================================
  // THE WEEK GATE COMES FIRST (migration 037). An anonymous caller sees only
  // weeks explicitly approved in `schedule_week_reviews`, so without this row
  // the anon read is empty for EVERY session and an assertion about operating
  // hours here would be testing the review gate by accident. Asserted both
  // ways below so the gate cannot quietly become the reason a future run
  // "passes".
  const ungated = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, null);
  check(
    "before the week is approved, an anonymous read sees nothing at all (037's gate)",
    (ungated.body.data ?? []).length === 0,
    JSON.stringify(ungated.body).slice(0, 200)
  );

  await admin.from("schedule_week_reviews").insert({
    org_id: org.id,
    schedule_group_id: group.id,
    week_start: SUN,
    status: "approved",
  });

  const publicView = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, null);
  const publicOcc = occurrencesOf(publicView.body, followingId);
  check(
    `an anonymous read resolves the split Monday too (got ${JSON.stringify(publicOcc)})`,
    publicOcc.includes(`${MON} 06:00–12:00`) && publicOcc.includes(`${MON} 16:00–21:00`)
  );
  check("and still skips the closed Wednesday", !publicOcc.some((o) => o.startsWith(WED)));
  check(
    "POSITIVE CONTROL: the fixed-time session is visible in that same anonymous read",
    occurrencesOf(publicView.body, fixedId).some((o) => o.startsWith(MON)),
    JSON.stringify(occurrencesOf(publicView.body, fixedId))
  );

  // =====================================================================
  console.log("\n7. Conflict detection uses the resolved hours, not the snapshot");
  // =====================================================================
  // Monday is 06:00–12:00 and 16:00–21:00 again.
  //
  // BOTH SIDES MUST BE EXCLUSIVE. The all-day block above is a `drop_in`,
  // which is *residual* — under migration 046 an exclusive claim and a
  // residual one deliberately do NOT conflict, so pointing a program at it
  // would report "no conflict" whether or not the hours were consulted, and
  // prove nothing. (That is what a first draft of this section did, and it
  // passed for the wrong reason.) So this uses a second lane with its own
  // all-day block recorded as a `closure` — exclusive, and exactly the shape
  // a real maintenance shutdown takes.
  const allDayClosure = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T09:00:00Z`,
      dtend_time: "10:00",
      follows_operating_hours: true,
      valid_from: MON,
      space_ids: [lane2.id],
      occupancy_kind: "closure",
    }),
  });
  check("an all-day exclusive closure creates", allDayClosure.status < 300, JSON.stringify(allDayClosure.body));

  const inWindow = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T08:00:00Z`,
      dtend_time: "09:00",
      valid_from: MON,
      space_ids: [lane2.id],
      occupancy_kind: "program",
    }),
  });
  check(
    "an exclusive program inside the morning open window 409s against the all-day closure",
    inWindow.status === 409,
    JSON.stringify(inWindow.body)
  );

  const inGap = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T13:00:00Z`,
      dtend_time: "15:00",
      valid_from: MON,
      space_ids: [lane2.id],
      occupancy_kind: "program",
    }),
  });
  check(
    "the same program in the midday closure does NOT conflict — the gap is real",
    inGap.status < 300,
    JSON.stringify(inGap.body)
  );

  // The residual rule itself, asserted rather than assumed — so a future
  // change that made drop-in exclusive would show up here as a failure with
  // a name, instead of silently turning the two checks above into tautologies.
  const againstDropIn = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T08:00:00Z`,
      dtend_time: "09:00",
      valid_from: MON,
      space_ids: [lane.id],
      occupancy_kind: "program",
    }),
  });
  check(
    "a program inside the all-day DROP-IN block is still allowed (046's residual rule)",
    againstDropIn.status < 300,
    JSON.stringify(againstDropIn.body)
  );

  // THE CANDIDATE SIDE. Everything above puts a fixed-time session in as the
  // candidate and an hours-following one on the other side, which only
  // exercises half of findSessionConflict — the half that resolves `other`.
  // A first pass of this file did exactly that, and deliberately breaking the
  // candidate's own hours lookup still produced a green run.
  //
  // So: park an exclusive block first, then submit the ALL-DAY session as the
  // candidate and let its derived hours decide.
  const parkedInWindow = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T07:00:00Z`,
      dtend_time: "08:00",
      valid_from: MON,
      space_ids: [lane3.id],
      occupancy_kind: "program",
    }),
  });
  check("a fixed exclusive block parks on lane 3", parkedInWindow.status < 300, JSON.stringify(parkedInWindow.body));

  const candidateCollides = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T09:00:00Z`,
      dtend_time: "10:00",
      follows_operating_hours: true,
      valid_from: MON,
      space_ids: [lane3.id],
      occupancy_kind: "closure",
    }),
  });
  check(
    "an all-day CANDIDATE 409s against a block inside its open hours — its own hours were resolved, not its 09:00–10:00 payload",
    candidateCollides.status === 409,
    JSON.stringify(candidateCollides.body)
  );

  const parkedInGap = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T13:00:00Z`,
      dtend_time: "15:00",
      valid_from: MON,
      space_ids: [lane4.id],
      occupancy_kind: "program",
    }),
  });
  check("a fixed exclusive block parks in lane 4's midday gap", parkedInGap.status < 300, JSON.stringify(parkedInGap.body));

  const candidateClears = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: `${MON}T09:00:00Z`,
      dtend_time: "10:00",
      follows_operating_hours: true,
      valid_from: MON,
      space_ids: [lane4.id],
      occupancy_kind: "closure",
    }),
  });
  check(
    "CONTROL: the same all-day candidate clears a block sitting in the midday closure",
    candidateClears.status < 300,
    JSON.stringify(candidateClears.body)
  );

  // =====================================================================
  console.log("\n8. Week-override dedupes the split day");
  // =====================================================================
  // One date, two occurrences, one session_exceptions row. Before the dedupe
  // this upsert failed outright with "ON CONFLICT DO UPDATE command cannot
  // affect row a second time".
  const override = await api(`/api/sessions/${followingId}/exceptions`, cookie, {
    method: "POST",
    body: JSON.stringify({ weekStart: MON, action: "cancel", note: "Maintenance" }),
  });
  check(
    "cancelling the week succeeds on a split-hours department",
    override.status === 200,
    JSON.stringify(override.body)
  );
  check(
    "the closed Wednesday was not offered as a cancellable date",
    !(override.body.datesAffected ?? []).includes(WED),
    JSON.stringify(override.body.datesAffected)
  );
  check(
    "Monday appears exactly once in the affected dates",
    (override.body.datesAffected ?? []).filter((d) => d === MON).length === 1,
    JSON.stringify(override.body.datesAffected)
  );

  const afterCancel = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, cookie);
  check(
    "cancelling a date removes BOTH of its windows",
    occurrencesOf(afterCancel.body, followingId).filter((o) => o.startsWith(MON)).length === 0
  );
} catch (err) {
  // Without this the `finally` below calls process.exit(), which DISCARDS a
  // thrown error — the run stops partway through and still prints
  // "0 failed", which is the most dangerous possible output for a harness.
  fail++;
  console.log(`\n  THREW  ${err?.stack ?? err}`);
} finally {
  console.log("\nCleaning up…");
  for (const orgId of ids.orgs) await admin.from("organizations").delete().eq("id", orgId);
  for (const userId of ids.users) await admin.auth.admin.deleteUser(userId);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
