/**
 * The list view starts at today — driven in a real browser.
 *
 * A drop-in schedule is read to answer "when can I next come", so a list that
 * opens on Sunday of the current week buries the answer under days that have
 * already happened. `WeeklyScheduleList` now starts at today and collapses the
 * earlier days behind a toggle.
 *
 * What can go wrong here is mostly invisible to a screenshot:
 *
 *   - **Collapsing the wrong days.** The day index has to be resolved against
 *     the *week in view*, not against `new Date().getDay()` alone: get that
 *     wrong and a future week silently loses its first days, or the current
 *     week keeps them. Asserted on three weeks, not one.
 *   - **Hiding rather than collapsing.** Staff edit this same list mid-week
 *     and still need to reach Monday, so the earlier days must come back.
 *     Asserted by expanding and finding the sessions themselves, not just the
 *     headings — a heading with no rows under it would be a regression that a
 *     heading-only check would pass.
 *   - **A stale mobile day chip.** The chips are a picker over what's
 *     rendered; if the collapsed day stayed selected, the narrow layout would
 *     show an empty list. Asserted at a phone viewport.
 *   - **Today itself getting collapsed.** "Past" must mean strictly before
 *     today, whatever time of day it is.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, the real
 * public widget route (no cookies, so RLS applies as in production), teardown
 * in a `finally`.
 *
 *   npm run dev
 *   node scripts/verify/verify-s.mjs [--headed]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");

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

function sessionCookieHeader(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  }
  return chunks.join("; ");
}

const isoDate = (d) => d.toISOString().slice(0, 10);

/** Sunday-anchored, matching `getWeekStart` in src/lib/utils/dates.ts. */
function weekStartOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The heading `formatDayFull` prints, computed the way the *viewer* sees the
 * week: `WeekNavigator`'s dates are local-getter dates, so this mirrors the
 * component rather than the UTC-labelled session convention.
 */
function headingFor(weekStartLocal, dayIndex) {
  const d = new Date(weekStartLocal);
  d.setDate(d.getDate() + dayIndex);
  return `${DAY_NAMES[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** The given weekday (0=Sun) in the current week, as a UTC calendar date. */
function dayOfThisWeek(weekday) {
  const start = weekStartOf(new Date());
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + weekday);
  return d;
}

const now = new Date();
const todayIndex = now.getDay();
const localWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayIndex);

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  console.log(`\nToday is ${DAY_NAMES[todayIndex]} (index ${todayIndex}) — ${todayIndex} earlier day(s) to collapse`);

  // ---------------------------------------------------------------
  console.log("\n0. Fixture: one differently-named activity on every day of the week");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-s ${stamp}`, slug: `zz-verify-s-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-s-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);
  ids.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookieHeader(signIn.session);

  const { data: facility } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ Aquatic Centre ${stamp}`,
      slug: `zz-verify-s-${stamp}`,
      address_line1: "1 Test St",
      city: "Vancouver",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id, name")
    .single();

  const { data: department } = await admin
    .from("departments")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: `ZZ Aquatics ${stamp}`,
      slug: `zz-verify-s-dept-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: space } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: department.id,
      name: `ZZ Main Pool ${stamp}`,
      slug: `zz-verify-s-space-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  /**
   * One schedule group per weekday, each with the weekday in its name: a
   * session with no template renders its group's name, so "is Tuesday on
   * screen" becomes a text assertion that cannot be satisfied by any other
   * day's row.
   */
  async function makeDay(weekday) {
    const label = `ZZ ${DAY_NAMES[weekday]} Swim ${stamp}`;
    const { data: scheduleGroup } = await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: label,
        slug: `zz-verify-s-${DAY_NAMES[weekday].toLowerCase()}-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        source: "manual",
      })
      .select("id, name")
      .single();

    // DTSTART is two weeks back, not this week: the recurrence has no
    // occurrences before its own anchor, and paging back a week is one of the
    // cases under test.
    const day = dayOfThisWeek(weekday);
    const anchorDay = new Date(day);
    anchorDay.setUTCDate(anchorDay.getUTCDate() - 14);
    const validFrom = new Date(anchorDay);
    validFrom.setUTCDate(validFrom.getUTCDate() - 7);
    const res = await fetch(`${APP}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        schedule_group_id: scheduleGroup.id,
        rrule: `FREQ=WEEKLY;BYDAY=${DAY_CODES[weekday]}`,
        valid_from: isoDate(validFrom),
        valid_until: null,
        dtstart: `${isoDate(anchorDay)}T10:00:00Z`,
        dtend_time: "11:00",
        space_ids: [space.id],
      }),
    });
    if (res.status >= 300) throw new Error(`${label}: ${res.status} ${await res.text()}`);

    for (const offset of [-7, 0, 7]) {
      const anchor = new Date(now.getTime() + offset * 86400000);
      await admin.from("schedule_week_reviews").insert({
        org_id: org.id,
        schedule_group_id: scheduleGroup.id,
        week_start: isoDate(weekStartOf(anchor)),
        status: "approved",
        reviewed_by: userData.user.id,
        reviewed_at: new Date().toISOString(),
      });
    }
    return label;
  }

  const dayLabels = [];
  for (let d = 0; d < 7; d++) dayLabels.push(await makeDay(d));
  check("seven days of sessions built", dayLabels.every(Boolean));

  // List template, no visitor filters: this is about the list itself, and a
  // filter bar would give the assertions a second place to find day names.
  const cfg = await fetch(`${APP}/api/widget-config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ facilityId: facility.id, enabledFilters: [], allowedTemplates: ["list"] }),
  });
  check("widget pinned to the list template", cfg.status === 200, `status=${cfg.status}`);

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    const page = await context.newPage();
    const widgetUrl = `${APP}/widget/${org.id}?facilityId=${facility.id}`;

    // Scoped to the schedule region: the toggle's own label counts days too,
    // and a page-wide match would let it stand in for a rendered day.
    const board = page.getByRole("region", { name: "Schedule" });
    const heading = (weekStartLocal, i) =>
      board.getByRole("heading", { name: headingFor(weekStartLocal, i), exact: true });
    const rowFor = (i) => board.getByText(dayLabels[i]).first();
    const visible = (loc) => loc.isVisible().catch(() => false);

    async function headingsShown(weekStartLocal) {
      const out = [];
      for (let i = 0; i < 7; i++) out.push(await visible(heading(weekStartLocal, i)));
      return out;
    }

    await page.goto(widgetUrl, { waitUntil: "networkidle" });
    await board.waitFor({ state: "visible", timeout: 20000 });
    await rowFor(todayIndex).waitFor({ state: "visible", timeout: 20000 }).catch(() => {});

    // ---------------------------------------------------------------
    console.log("\n1. The current week opens on today");
    // ---------------------------------------------------------------
    const control = await headingsShown(localWeekStart);
    check(
      "control: today's own heading is on screen",
      control[todayIndex],
      `headings=${JSON.stringify(control)}`
    );
    check(
      "control: today's session row is on screen, so the week really loaded",
      await visible(rowFor(todayIndex))
    );
    check(
      "every day from today onward is rendered",
      control.slice(todayIndex).every(Boolean),
      `from today=${JSON.stringify(control.slice(todayIndex))}`
    );

    if (todayIndex === 0) {
      console.log("  SKIP  it is Sunday — the current week has no earlier days to collapse");
    } else {
      check(
        "…and every day before today is collapsed away",
        control.slice(0, todayIndex).every((v) => v === false),
        `before today=${JSON.stringify(control.slice(0, todayIndex))}`
      );
      check(
        "positive control: a past day's session is gone with it, not merely its heading",
        (await visible(rowFor(todayIndex - 1))) === false
      );

      // ---------------------------------------------------------------
      console.log("\n2. The earlier days come back on request");
      // ---------------------------------------------------------------
      const toggle = board.getByRole("button", {
        name: `Show ${todayIndex} earlier day${todayIndex === 1 ? "" : "s"}`,
      });
      check("the toggle names how many days it is holding back", await visible(toggle));

      await toggle.click();
      await page.waitForTimeout(300);
      const expanded = await headingsShown(localWeekStart);
      check(
        "expanding brings back every earlier day",
        expanded.every(Boolean),
        `headings=${JSON.stringify(expanded)}`
      );
      check(
        "…with their sessions, not just their headings",
        await visible(rowFor(todayIndex - 1))
      );

      const collapse = board.getByRole("button", { name: "Hide earlier days" });
      check("…and the toggle now offers the way back", await visible(collapse));
      await collapse.click();
      await page.waitForTimeout(300);
      const recollapsed = await headingsShown(localWeekStart);
      check(
        "collapsing again returns to today at the top",
        recollapsed[todayIndex] && recollapsed.slice(0, todayIndex).every((v) => v === false),
        `headings=${JSON.stringify(recollapsed)}`
      );
    }

    // ---------------------------------------------------------------
    console.log("\n3. Other weeks are shown in full — nothing there has 'passed' relative to a day in view");
    // ---------------------------------------------------------------
    const nextWeekStart = new Date(localWeekStart);
    nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    await board.getByRole("button", { name: "Next week" }).click();
    await page.waitForTimeout(600);
    const next = await headingsShown(nextWeekStart);
    check("next week renders all seven days", next.every(Boolean), `headings=${JSON.stringify(next)}`);
    check(
      "…and offers no 'earlier days' toggle",
      (await board.getByRole("button", { name: /earlier day/ }).count()) === 0
    );

    const prevWeekStart = new Date(localWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    await board.getByRole("button", { name: "Previous week" }).click();
    await page.waitForTimeout(600);
    await board.getByRole("button", { name: "Previous week" }).click();
    await page.waitForTimeout(600);
    const prev = await headingsShown(prevWeekStart);
    check(
      "a week the visitor paged back to renders all seven days",
      prev.every(Boolean),
      `headings=${JSON.stringify(prev)}`
    );
    check(
      "…and likewise offers no toggle",
      (await board.getByRole("button", { name: /earlier day/ }).count()) === 0
    );

    // ---------------------------------------------------------------
    console.log("\n4. On a phone, the day chips agree with what is rendered");
    // ---------------------------------------------------------------
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const small = await phone.newPage();
    try {
      await small.goto(widgetUrl, { waitUntil: "networkidle" });
      const phoneBoard = small.getByRole("region", { name: "Schedule" });
      await phoneBoard.waitFor({ state: "visible", timeout: 20000 });
      await small
        .getByText(dayLabels[todayIndex])
        .first()
        .waitFor({ state: "visible", timeout: 20000 })
        .catch(() => {});

      check(
        "the narrow layout lands on today rather than a collapsed day",
        await small.getByText(dayLabels[todayIndex]).first().isVisible().catch(() => false),
        "today's sessions were not on screen — a stale day chip would look exactly like this"
      );
      if (todayIndex > 0) {
        check(
          "…and no chip is offered for a day that isn't rendered",
          (await phoneBoard
            .getByRole("button", { name: new RegExp(`^${DAY_NAMES[0].slice(0, 3)}`) })
            .count()) === 0
        );
      }
    } finally {
      await phone.close();
    }
  } finally {
    await browser.close();
  }
} catch (err) {
  fail++;
  console.error("\n  ERROR  the harness threw before finishing:\n", err);
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

  const { data: orgsLeft } = await admin.from("organizations").select("id, name").like("name", `%${stamp}%`);
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const usersLeft = (userList?.users ?? []).filter((u) => u.email?.includes(String(stamp)));

  console.log(
    `\nTeardown: ${orgsLeft?.length ?? 0} org(s), ${usersLeft.length} user(s) left over` +
      (orgsLeft?.length || usersLeft.length
        ? ` — LEAKED: ${[...(orgsLeft ?? []).map((o) => o.name), ...usersLeft.map((u) => u.email)].join(", ")}`
        : "")
  );
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
