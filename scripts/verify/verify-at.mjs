/**
 * Statutory holidays, per department (migration 059).
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-at.mjs
 *   node --experimental-strip-types scripts/verify/verify-at.mjs --logic-only
 *
 * NEEDS MIGRATION 059 APPLIED (and 058 before it). Probes for both tables
 * first and stops with instructions rather than reporting a wall of failures.
 *
 * Companion to verify-as, which covers the weekly operating hours these
 * holidays override. The claim under test here is narrow and specific: a date
 * with a holiday row beats the weekly pattern, a date without one does not
 * exist as far as the schedule is concerned, and the difference between
 * "closed" and "open as usual" survives a round trip — because both store
 * zero window rows and only `observance` tells them apart.
 *
 * Fixed fixture dates throughout (2026), never "today", so this cannot go red
 * in the evening the way verify-p/q/r/s did.
 */
import fs from "fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

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
/**
 * A SECOND publishable-key client that is never signed in.
 *
 * `anon` above is signed in as the fixture owner further down, to mint the
 * session cookie — after which it is authenticated, and every "can an outsider
 * see this?" read through it silently answers as a member. Section 5 read as
 * an RLS leak because of exactly that, not because of the policy.
 */
const publicAnon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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

// The fixture week: MON 2026-12-21 .. SUN 2026-12-27. Chosen because Christmas
// Day 2026 is a FRIDAY and Boxing Day a Saturday — a week with an ordinary
// working day, a statutory closure and a reduced-hours day in it.
const MON = "2026-12-21";
const THU = "2026-12-24";
const FRI = "2026-12-25";
const SAT = "2026-12-26";
const RANGE = `rangeStart=2026-12-21T00:00:00.000Z&rangeEnd=2026-12-27T23:59:59.000Z`;

function occurrencesOf(body, sessionId) {
  return (body.data ?? [])
    .filter((s) => s.sessionId === sessionId)
    .map((s) => `${s.start.slice(0, 10)} ${s.start.slice(11, 16)}–${s.end.slice(11, 16)}`)
    .sort();
}

/**
 * Section 0 — the catalogue and the resolver, against the real modules.
 * No database, no server, no migration.
 */
async function logicChecks() {
  register("./_alias-hooks.mjs", import.meta.url);
  const cat = await import("../../src/lib/schedule/holiday-catalogue.ts");
  const oh = await import("../../src/lib/schedule/operating-hours.ts");
  const { expandOccurrenceTimes } = await import("../../src/lib/rrule/expand.ts");

  console.log("\n0. The catalogue and the resolver (real modules, no database)");

  // --- the catalogue ----------------------------------------------------
  const bc2026 = cat.suggestedHolidays("BC", 2026);
  const byId = (list, id) => list.find((h) => h.id === id);

  // Hand-checked against a 2026 calendar. These are the rules, not a snapshot:
  // if the nth-weekday or Easter arithmetic breaks, these are what say so.
  check("Canada Day is the fixed 1 July", byId(bc2026, "canada-day")?.date === "2026-07-01");
  check(
    "BC Family Day is the 3rd Monday in February (2026-02-16)",
    byId(bc2026, "family-day")?.date === "2026-02-16",
    byId(bc2026, "family-day")?.date
  );
  check(
    "Good Friday is Easter minus two (2026-04-03)",
    byId(bc2026, "good-friday")?.date === "2026-04-03",
    byId(bc2026, "good-friday")?.date
  );
  check(
    "Victoria Day is the Monday BEFORE 25 May — and 2026-05-25 is itself a Monday, so 05-18",
    byId(bc2026, "victoria-day")?.date === "2026-05-18",
    byId(bc2026, "victoria-day")?.date
  );
  check(
    "Labour Day is the 1st Monday in September (2026-09-07)",
    byId(bc2026, "labour-day")?.date === "2026-09-07"
  );
  check(
    "Thanksgiving is the 2nd Monday in October (2026-10-12)",
    byId(bc2026, "thanksgiving")?.date === "2026-10-12"
  );
  check(
    "every suggested date really falls in the year asked for",
    cat.suggestedHolidays("BC", 2031).every((h) => h.date.startsWith("2031-"))
  );
  check(
    "the list is returned in date order",
    bc2026.every((h, i) => i === 0 || bc2026[i - 1].date <= h.date)
  );

  // Jurisdiction differences — the reason the catalogue exists at all.
  check(
    "BC gets BC Day; Ontario gets the Civic Holiday by its own name",
    byId(bc2026, "civic-holiday")?.name === "BC Day" &&
      byId(cat.suggestedHolidays("ON", 2026), "civic-holiday")?.name === "Civic Holiday"
  );
  check(
    "Boxing Day is statutory in ON and merely common in BC",
    byId(cat.suggestedHolidays("ON", 2026), "boxing-day")?.kind === "statutory" &&
      byId(bc2026, "boxing-day")?.kind === "common"
  );
  check(
    "Nunavut Day is offered to NU and to nobody else",
    !!byId(cat.suggestedHolidays("NU", 2026), "nunavut-day") &&
      !byId(bc2026, "nunavut-day")
  );
  check(
    "an unknown province still gets the days that are statutory everywhere",
    (() => {
      const unknown = cat.suggestedHolidays(null, 2026);
      return (
        unknown.length > 0 &&
        unknown.every((h) => h.kind === "statutory") &&
        !!byId(unknown, "christmas-day") &&
        !byId(unknown, "family-day")
      );
    })()
  );

  // --- the resolver -----------------------------------------------------
  // Mon-Fri 06:00-21:00, weekend closed.
  const hourRows = [1, 2, 3, 4, 5].map((d) => ({
    department_id: "d1",
    day_of_week: d,
    opens_at: "06:00:00",
    closes_at: "21:00:00",
  }));

  const grouped = oh.groupHoursByDepartment(hourRows, [
    { department_id: "d1", holiday_date: FRI, observance: "closed" },
    {
      department_id: "d1",
      holiday_date: THU,
      observance: "custom_hours",
      windows: [{ opens_at: "09:00:00", closes_at: "13:00:00" }],
    },
    { department_id: "d1", holiday_date: MON, observance: "normal_hours" },
  ]);
  const hours = grouped.get("d1");

  check("a 'closed' holiday resolves to no windows", oh.resolveOperatingWindows(hours, FRI, 5).length === 0);
  check(
    "a 'custom_hours' holiday resolves to its own windows, not the weekday's",
    JSON.stringify(oh.resolveOperatingWindows(hours, THU, 4)) ===
      JSON.stringify([{ opens: 540, closes: 780 }])
  );
  check(
    "a 'normal_hours' holiday writes NO override and falls through to the week",
    JSON.stringify(oh.resolveOperatingWindows(hours, MON, 1)) ===
      JSON.stringify([{ opens: 360, closes: 1260 }])
  );
  check(
    "an ordinary date with no holiday row uses the weekly pattern",
    JSON.stringify(oh.resolveOperatingWindows(hours, "2026-12-22", 2)) ===
      JSON.stringify([{ opens: 360, closes: 1260 }])
  );
  check(
    "a closed WEEKDAY is still closed on a date with no holiday row",
    oh.resolveOperatingWindows(hours, "2026-12-27", 0).length === 0
  );
  check(
    "'custom_hours' with no usable windows closes rather than opening all day",
    (() => {
      const g = oh.groupHoursByDepartment(hourRows, [
        { department_id: "d1", holiday_date: FRI, observance: "custom_hours", windows: [] },
      ]);
      return oh.resolveOperatingWindows(g.get("d1"), FRI, 5).length === 0;
    })()
  );
  check(
    "hasAnyWindow ignores holidays — a department whose only config is a closure has no hours",
    (() => {
      const g = oh.groupHoursByDepartment([], [
        { department_id: "d1", holiday_date: FRI, observance: "closed" },
      ]);
      return oh.hasAnyWindow(g.get("d1")) === false;
    })()
  );
  check(
    "overlapping holiday windows merge, like weekly ones",
    (() => {
      const g = oh.groupHoursByDepartment(hourRows, [
        {
          department_id: "d1",
          holiday_date: FRI,
          observance: "custom_hours",
          windows: [
            { opens_at: "09:00:00", closes_at: "13:00:00" },
            { opens_at: "12:00:00", closes_at: "16:00:00" },
          ],
        },
      ]);
      return JSON.stringify(oh.resolveOperatingWindows(g.get("d1"), FRI, 5)) ===
        JSON.stringify([{ opens: 540, closes: 960 }]);
    })()
  );

  // --- expansion --------------------------------------------------------
  const session = {
    id: "s1",
    rrule: "FREQ=DAILY",
    dtstart: `${MON}T09:00:00Z`,
    dtend_time: "10:00",
    valid_from: MON,
    valid_until: null,
    follows_operating_hours: true,
  };
  const range = {
    rangeStart: new Date(`${MON}T00:00:00Z`),
    rangeEnd: new Date("2026-12-27T23:59:59Z"),
  };
  const show = (occ) =>
    occ.map(
      (o) =>
        `${o.start.toISOString().slice(0, 10)} ${o.start.toISOString().slice(11, 16)}–${o.end
          .toISOString()
          .slice(11, 16)}`
    );

  const withHolidays = show(expandOccurrenceTimes(session, [], range, hours));
  check(
    `Christmas Day produces no occurrence (got ${JSON.stringify(withHolidays)})`,
    !withHolidays.some((o) => o.startsWith(FRI))
  );
  check(
    "Christmas Eve produces its reduced hours",
    withHolidays.includes(`${THU} 09:00–13:00`)
  );
  check(
    "the Monday marked 'open as usual' keeps the full weekday hours",
    withHolidays.includes(`${MON} 06:00–21:00`)
  );

  // POSITIVE CONTROL: the same session and week with NO holidays configured.
  // Without this, "Christmas is missing" could equally mean the fixture week,
  // the rrule or the range was wrong.
  const noHolidays = show(
    expandOccurrenceTimes(session, [], range, oh.groupHoursByDepartment(hourRows).get("d1"))
  );
  check(
    `CONTROL: with no holidays the SAME week runs Christmas Day normally (got ${JSON.stringify(noHolidays)})`,
    noHolidays.includes(`${FRI} 06:00–21:00`)
  );
  check(
    "CONTROL: and the weekend is closed either way, because that is the weekly pattern",
    !noHolidays.some((o) => o.startsWith(SAT)) && !withHolidays.some((o) => o.startsWith(SAT))
  );
  check(
    "a fixed-time session ignores holidays entirely — they only bind what follows the hours",
    show(
      expandOccurrenceTimes({ ...session, follows_operating_hours: false }, [], range, hours)
    ).filter((o) => o.startsWith(FRI)).length === 1
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
  const probeHolidays = await admin.from("department_holidays").select("id").limit(1);
  const probeWindows = await admin.from("department_holiday_windows").select("id").limit(1);
  if (probeHolidays.error || probeWindows.error) {
    console.log("\nMigration 059 is not applied to this database.\n");
    console.log(`  department_holidays        : ${probeHolidays.error?.message ?? "ok"}`);
    console.log(`  department_holiday_windows : ${probeWindows.error?.message ?? "ok"}`);
    console.log("\nApply supabase/migrations/059_department_holidays.sql, then re-run.");
    process.exit(1);
  }

  // ------------------------------------------------------------- fixtures
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-at ${stamp}`, slug: `zz-verify-at-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-at-${stamp}@example.invalid`;
  const password = `Zt!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  ids.users.push(userData.user.id);
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

  const [department, sibling] = await Promise.all(
    ["Aquatics", "Fitness"].map(async (name) =>
      (
        await admin
          .from("departments")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            name,
            slug: `${name.toLowerCase()}-${stamp}`,
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
        ends_on: "2027-12-31",
      })
      .select("id")
      .single()
  ).data;

  // Mon-Fri 06:00-21:00 through the real hours route.
  const week = [[], [], [], [], [], [], []];
  for (const d of [1, 2, 3, 4, 5]) week[d] = [{ opens: "06:00", closes: "21:00" }];
  await api(`/api/departments/${department.id}/hours`, cookie, {
    method: "PUT",
    body: JSON.stringify({ days: week }),
  });

  // =====================================================================
  console.log("\n1. Saving a year of holidays through the real route");
  // =====================================================================
  const put = await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [
        { date: FRI, name: "Christmas Day", observance: "closed" },
        {
          date: THU,
          name: "Christmas Eve",
          observance: "custom_hours",
          windows: [{ opens: "09:00", closes: "13:00" }],
        },
        { date: MON, name: "Winter Monday", observance: "normal_hours" },
      ],
    }),
  });
  check("PUT holidays succeeds", put.status === 200, JSON.stringify(put.body));
  check("it reports what it saved", put.body.saved === 3, JSON.stringify(put.body));
  check(
    "and counts only the two that actually change anything",
    put.body.closures === 2,
    JSON.stringify(put.body)
  );

  const { data: storedRows } = await admin
    .from("department_holidays")
    .select("holiday_date, observance, department_holiday_windows (opens_at, closes_at)")
    .eq("department_id", department.id)
    .order("holiday_date");
  check("three rows stored", (storedRows ?? []).length === 3, JSON.stringify(storedRows));
  check(
    "'closed' stored with zero window rows",
    storedRows.find((r) => r.holiday_date === FRI)?.department_holiday_windows.length === 0
  );
  check(
    "'normal_hours' ALSO stored with zero windows — only observance separates them",
    storedRows.find((r) => r.holiday_date === MON)?.observance === "normal_hours" &&
      storedRows.find((r) => r.holiday_date === MON)?.department_holiday_windows.length === 0
  );
  check(
    "'custom_hours' kept its window",
    storedRows.find((r) => r.holiday_date === THU)?.department_holiday_windows[0]?.opens_at.slice(0, 5) ===
      "09:00"
  );

  const getBack = await api(`/api/departments/${department.id}/holidays?year=2026`, cookie);
  check("GET returns the year", getBack.body.holidays?.length === 3, JSON.stringify(getBack.body));
  check(
    "a round trip preserves the three observances exactly",
    JSON.stringify((getBack.body.holidays ?? []).map((h) => h.observance).sort()) ===
      JSON.stringify(["closed", "custom_hours", "normal_hours"])
  );

  const badWindow = await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [{ date: FRI, name: "Bad", observance: "custom_hours", windows: [] }],
    }),
  });
  check(
    "'custom_hours' with no windows is refused rather than silently closing the day",
    badWindow.status === 400,
    JSON.stringify(badWindow.body)
  );

  const wrongYear = await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [{ date: "2027-12-25", name: "Next year", observance: "closed" }],
    }),
  });
  check(
    "a date outside the year being replaced is refused — it would outlive every future save",
    wrongYear.status === 400,
    JSON.stringify(wrongYear.body)
  );

  const { count: survived } = await admin
    .from("department_holidays")
    .select("id", { count: "exact", head: true })
    .eq("department_id", department.id);
  check("the two rejected PUTs left the stored year intact", survived === 3, `count=${survived}`);

  // =====================================================================
  console.log("\n2. A following session honours them");
  // =====================================================================
  const following = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=DAILY",
      dtstart: `${MON}T09:00:00Z`,
      dtend_time: "10:00",
      follows_operating_hours: true,
      valid_from: MON,
      space_ids: [],
    }),
  });
  check("following session creates", following.status < 300, JSON.stringify(following.body));
  const followingId = following.body.sessionId;

  // POSITIVE CONTROL: same days, fixed times. Proves the week, the rrule and
  // the range are all fine, so a missing Christmas is about the holiday.
  const fixed = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=DAILY",
      dtstart: `${MON}T14:00:00Z`,
      dtend_time: "15:00",
      valid_from: MON,
      space_ids: [],
    }),
  });
  check("fixed-time control session creates", fixed.status < 300, JSON.stringify(fixed.body));
  const fixedId = fixed.body.sessionId;

  const expanded = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, cookie);
  const got = occurrencesOf(expanded.body, followingId);
  check(
    `Christmas Day is gone from the schedule (got ${JSON.stringify(got)})`,
    !got.some((o) => o.startsWith(FRI))
  );
  check("Christmas Eve runs the reduced 09:00–13:00", got.includes(`${THU} 09:00–13:00`));
  check("the 'open as usual' Monday runs 06:00–21:00", got.includes(`${MON} 06:00–21:00`));
  check(
    "POSITIVE CONTROL: the fixed-time session still runs on Christmas Day",
    occurrencesOf(expanded.body, fixedId).includes(`${FRI} 14:00–15:00`),
    JSON.stringify(occurrencesOf(expanded.body, fixedId))
  );

  // =====================================================================
  console.log("\n3. Removing a holiday puts the day back");
  // =====================================================================
  const cleared = await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({ year: 2026, holidays: [] }),
  });
  check("clearing the year succeeds", cleared.status === 200, JSON.stringify(cleared.body));
  check("nothing saved", cleared.body.saved === 0, JSON.stringify(cleared.body));

  const { count: afterClear } = await admin
    .from("department_holidays")
    .select("id", { count: "exact", head: true })
    .eq("department_id", department.id);
  check("and the rows are gone", afterClear === 0, `count=${afterClear}`);

  const { count: orphanWindows } = await admin
    .from("department_holiday_windows")
    .select("id", { count: "exact", head: true })
    .eq("org_id", org.id);
  check("the windows cascaded with them, leaving no orphans", orphanWindows === 0);

  const reopened = await api(`/api/sessions/expand?facilityId=${facility.id}&${RANGE}`, cookie);
  check(
    "Christmas Day is back on the schedule at the ordinary weekday hours",
    occurrencesOf(reopened.body, followingId).includes(`${FRI} 06:00–21:00`),
    JSON.stringify(occurrencesOf(reopened.body, followingId))
  );

  // =====================================================================
  console.log("\n4. Copying to another department, and scoping");
  // =====================================================================
  await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [{ date: FRI, name: "Christmas Day", observance: "closed" }],
    }),
  });
  const copied = await api(`/api/departments/${sibling.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [{ date: FRI, name: "Christmas Day", observance: "closed" }],
    }),
  });
  check("the sibling department accepts the same payload", copied.status === 200);

  const siblingGet = await api(`/api/departments/${sibling.id}/holidays?year=2026`, cookie);
  check("and stores its own independent row", siblingGet.body.holidays?.length === 1);

  // Scoping: removing the sibling's holiday must not touch this one. Two
  // departments sharing a date is the normal case, so a delete that keyed on
  // the date alone would be invisible until someone lost a closure.
  await api(`/api/departments/${sibling.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({ year: 2026, holidays: [] }),
  });
  const stillThere = await api(`/api/departments/${department.id}/holidays?year=2026`, cookie);
  check(
    "clearing one department leaves the other's identical date alone",
    stillThere.body.holidays?.length === 1,
    JSON.stringify(stillThere.body)
  );

  // Year scoping, the same trap one level up.
  await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2027,
      holidays: [{ date: "2027-12-25", name: "Christmas Day", observance: "closed" }],
    }),
  });
  await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({ year: 2026, holidays: [] }),
  });
  const y2027 = await api(`/api/departments/${department.id}/holidays?year=2027`, cookie);
  check(
    "clearing 2026 leaves 2027 alone — the replace is scoped to its year",
    y2027.body.holidays?.length === 1,
    JSON.stringify(y2027.body)
  );

  // =====================================================================
  console.log("\n5. Permissions and anonymous reads");
  // =====================================================================
  await api(`/api/departments/${department.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [{ date: FRI, name: "Christmas Day", observance: "closed" }],
    }),
  });

  const anonWrite = await api(`/api/departments/${department.id}/holidays`, null, {
    method: "PUT",
    body: JSON.stringify({ year: 2026, holidays: [] }),
  });
  check(
    "an anonymous caller cannot write holidays",
    anonWrite.status === 401 || anonWrite.status === 403,
    `status=${anonWrite.status}`
  );
  const { count: untouched } = await admin
    .from("department_holidays")
    .select("id", { count: "exact", head: true })
    .eq("department_id", department.id)
    .gte("holiday_date", "2026-01-01")
    .lte("holiday_date", "2026-12-31");
  check("and nothing was deleted by the attempt", untouched === 1, `count=${untouched}`);

  // Anonymous READ is allowed on purpose (059): a patron needs to know the
  // building is shut. Asserted against PostgREST directly, not the route.
  const { data: anonRead } = await publicAnon
    .from("department_holidays")
    .select("holiday_date, observance")
    .eq("department_id", department.id)
    .gte("holiday_date", "2026-01-01")
    .lte("holiday_date", "2026-12-31");
  check(
    "an anonymous caller CAN read a published department's closures",
    (anonRead ?? []).length === 1,
    JSON.stringify(anonRead)
  );

  await admin.from("departments").update({ is_published: false }).eq("id", department.id);
  const { data: anonDraft } = await publicAnon
    .from("department_holidays")
    .select("holiday_date")
    .eq("department_id", department.id);
  check(
    "…and cannot once the department goes back to draft (read follows the parent)",
    (anonDraft ?? []).length === 0,
    JSON.stringify(anonDraft)
  );
  await admin.from("departments").update({ is_published: true }).eq("id", department.id);

  // =====================================================================
  console.log("\n6. Deleting the department takes its holidays with it");
  // =====================================================================
  const { data: doomed } = await admin
    .from("departments")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: "Doomed",
      slug: `doomed-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();
  await api(`/api/departments/${doomed.id}/holidays`, cookie, {
    method: "PUT",
    body: JSON.stringify({
      year: 2026,
      holidays: [
        {
          date: FRI,
          name: "Christmas Day",
          observance: "custom_hours",
          windows: [{ opens: "10:00", closes: "14:00" }],
        },
      ],
    }),
  });
  const { count: beforeDelete } = await admin
    .from("department_holidays")
    .select("id", { count: "exact", head: true })
    .eq("department_id", doomed.id);
  check("POSITIVE CONTROL: the doomed department really had a holiday", beforeDelete === 1);

  await admin.from("departments").delete().eq("id", doomed.id);
  const { count: afterDelete } = await admin
    .from("department_holidays")
    .select("id", { count: "exact", head: true })
    .eq("department_id", doomed.id);
  check("deleting the department cascades its holidays away", afterDelete === 0);
} catch (err) {
  // Without this the `finally` calls process.exit(), which DISCARDS a thrown
  // error — the run stops partway and still prints "0 failed".
  fail++;
  console.log(`\n  THREW  ${err?.stack ?? err}`);
} finally {
  console.log("\nCleaning up…");
  for (const orgId of ids.orgs) await admin.from("organizations").delete().eq("id", orgId);
  for (const userId of ids.users) await admin.auth.admin.deleteUser(userId);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
