/**
 * General schedule filters (migration 044) — driven in a real browser.
 *
 * The org-defined schedule switcher (043) answers "which schedule". These
 * answer the question a visitor actually arrives with: "when can I come, and
 * is Water Walking on?" They filter the week the schedule has already loaded,
 * client-side, so nothing about them is visible to a `fetch()` of the page —
 * the option lists are derived from the sessions in view and the narrowing
 * happens after hydration.
 *
 * What can go wrong here is mostly invisible:
 *
 *   - **Day bucketing.** Session occurrences are UTC-labelled wall-clock
 *     Dates (see docs/RESUME-timezone-removal.md); filtering with the
 *     runtime-local `getDay()` instead of `zonedDayOfWeek` drops an early
 *     session into the day before on any machine west of UTC, and the bug is
 *     invisible in a screenshot. Asserted with a Wednesday-only session.
 *   - **Time bands.** Same trap for `getHours()`, and the boundaries
 *     (noon, 5pm) are a decision, not a fact. Asserted with a 9am and a 7pm
 *     session on the *same day*, so a day filter can't stand in for it.
 *   - **AND across dimensions, OR within one.** "Monday or Wednesday, in the
 *     morning" is the only reading a visitor expects; the alternative
 *     (AND-ing within a dimension) makes any second chip empty the schedule.
 *   - **Empty selection means no opinion.** If it meant "match nothing", a
 *     freshly opened filter bar would show an empty week.
 *   - **Single-option suppression.** A filter is only rendered when the loaded
 *     week has two or more values for it, so an org that turns everything on
 *     doesn't get a bar of dropdowns that can't change anything.
 *   - **The admin's switch really switches it off**, both in the saved config
 *     and in what the embed renders.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, the real
 * routes, teardown in a `finally`.
 *
 *   npm run dev
 *   node scripts/verify/verify-r.mjs [--headed]
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

/** Sunday-anchored, matching `sessionWeekStart` in src/lib/utils/dates.ts. */
function weekStartOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

/** The given weekday (0=Sun) in the current week, as a UTC calendar date. */
function dayOfThisWeek(weekday) {
  const start = weekStartOf(new Date());
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + weekday);
  return d;
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture: three named activities, placed to separate day from time of day");
  // ---------------------------------------------------------------
  const { data: columnProbe } = await admin.from("widget_configs").select("enabled_filters").limit(1);
  if (columnProbe === null) {
    throw new Error(
      "widget_configs.enabled_filters is missing — apply supabase/migrations/044_widget_config_enabled_filters.sql first"
    );
  }

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-r ${stamp}`, slug: `zz-verify-r-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-r-${stamp}@example.invalid`;
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
      slug: `zz-verify-r-${stamp}`,
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
      slug: `zz-verify-r-dept-${stamp}`,
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
      slug: `zz-verify-r-space-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  /**
   * One activity = one schedule group, because a session with no template
   * renders its schedule group's name, which is exactly the string the
   * activity filter groups by.
   */
  async function makeActivity(name, { weekday, hour, byday }) {
    const { data: scheduleGroup } = await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: `ZZ ${name} ${stamp}`,
        slug: `zz-verify-r-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        source: "manual",
      })
      .select("id, name")
      .single();

    // Anchored on this week's occurrence of the weekday, and valid from a week
    // earlier, so the widget's default week always contains exactly one.
    const day = dayOfThisWeek(weekday);
    const validFrom = new Date(day);
    validFrom.setUTCDate(validFrom.getUTCDate() - 7);
    const res = await fetch(`${APP}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        schedule_group_id: scheduleGroup.id,
        rrule: `FREQ=WEEKLY;BYDAY=${byday}`,
        valid_from: isoDate(validFrom),
        valid_until: null,
        dtstart: `${isoDate(day)}T${String(hour).padStart(2, "0")}:00:00Z`,
        dtend_time: `${String(hour + 1).padStart(2, "0")}:00`,
        space_ids: [space.id],
      }),
    });
    if (res.status >= 300) throw new Error(`${name} session: ${res.status} ${await res.text()}`);

    const today = new Date();
    for (const offset of [-7, 0, 7]) {
      const anchor = new Date(today.getTime() + offset * 86400000);
      await admin.from("schedule_week_reviews").insert({
        org_id: org.id,
        schedule_group_id: scheduleGroup.id,
        week_start: isoDate(weekStartOf(anchor)),
        status: "approved",
        reviewed_by: userData.user.id,
        reviewed_at: new Date().toISOString(),
      });
    }
    return scheduleGroup.name;
  }

  // Monday morning, Monday evening, Wednesday afternoon: day and time of day
  // are independent, so neither filter can pass by accidentally standing in
  // for the other.
  const waterWalking = await makeActivity("Water Walking", { weekday: 1, hour: 9, byday: "MO" });
  const laneSwim = await makeActivity("Lane Swim", { weekday: 1, hour: 19, byday: "MO" });
  const aquaFit = await makeActivity("Aqua Fit", { weekday: 3, hour: 13, byday: "WE" });
  check("three activities built", !!waterWalking && !!laneSwim && !!aquaFit);

  async function setFilters(list) {
    const res = await fetch(`${APP}/api/widget-config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ facilityId: facility.id, enabledFilters: list, allowedTemplates: ["list"] }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  const saved = await setFilters(["search", "activity", "day", "time"]);
  check("PATCH saves enabled_filters", saved.status === 200, JSON.stringify(saved.body));
  check(
    "…and stores exactly the keys sent",
    JSON.stringify(saved.body?.config?.enabled_filters) === JSON.stringify(["search", "activity", "day", "time"]),
    JSON.stringify(saved.body?.config?.enabled_filters)
  );

  const badKey = await setFilters(["search", "not-a-filter"]);
  check("an unknown filter key is rejected rather than silently dropped", badKey.status === 400, `status=${badKey.status}`);

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    // A stranger on the org's website: no cookies, so RLS applies as it will
    // in production.
    const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    const page = await context.newPage();
    const widgetUrl = `${APP}/widget/${org.id}?facilityId=${facility.id}`;

    // Scoped to the schedule region, never the whole page: an activity chip
    // and the sessions it filters for carry the same words, so a page-wide
    // text match would report a session as 'still visible' when what it found
    // was the chip that hid it.
    const board = page.getByRole("region", { name: "Schedule" });
    const water = board.getByText(waterWalking).first();
    const lane = board.getByText(laneSwim).first();
    const aqua = board.getByText(aquaFit).first();
    const activityGroup = page.getByRole("group", { name: "Activity" });
    const dayGroup = page.getByRole("group", { name: "Day" });
    const timeGroup = page.getByRole("group", { name: "Time of day" });
    const shown = async () => ({
      water: await water.isVisible().catch(() => false),
      lane: await lane.isVisible().catch(() => false),
      aqua: await aqua.isVisible().catch(() => false),
    });

    async function load() {
      await page.goto(widgetUrl, { waitUntil: "networkidle" });
      await water.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    }

    // ---------------------------------------------------------------
    console.log("\n1. The bar renders the enabled filters, and only those");
    // ---------------------------------------------------------------
    await load();
    const initial = await shown();
    check(
      "control: all three activities are on screen before any filtering",
      initial.water && initial.lane && initial.aqua,
      JSON.stringify(initial)
    );

    const search = page.getByRole("searchbox", { name: "Search the schedule" });
    check("the search box is rendered", await search.isVisible());

    // The panel is a toggle, and it survives filtering — so open it only when
    // it isn't already open, or a second call closes it and every chip lookup
    // below times out looking for something that was there a moment ago.
    async function openPanel() {
      if (await activityGroup.isVisible().catch(() => false)) return;
      await page.getByRole("button", { name: "Filters" }).click();
      await activityGroup.waitFor({ state: "visible", timeout: 10000 });
    }
    await openPanel();
    check("Activity is offered", await activityGroup.getByRole("button", { name: waterWalking, exact: true }).isVisible());
    check("Day is offered", await dayGroup.getByRole("button", { name: "Wed" }).isVisible());
    check("Time of day is offered", await timeGroup.getByRole("button", { name: "Evening" }).isVisible());
    check(
      "…and a filter the org did not enable is absent",
      (await page.getByText("Who it's for").count()) === 0
    );
    check(
      "a single-valued filter stays hidden even so — one space is nothing to choose between",
      (await page.getByText("Where", { exact: true }).count()) === 0
    );

    // ---------------------------------------------------------------
    console.log("\n2. Search narrows to the activity someone typed");
    // ---------------------------------------------------------------
    await search.fill("Water");
    await page.waitForTimeout(400);
    const searched = await shown();
    check("the matching activity stays", searched.water, JSON.stringify(searched));
    check("…and the others are gone", !searched.lane && !searched.aqua, JSON.stringify(searched));

    await page.getByRole("button", { name: "Clear all" }).click();
    const cleared = await shown();
    check("clearing brings everything back", cleared.water && cleared.lane && cleared.aqua);

    // ---------------------------------------------------------------
    console.log("\n3. Activity, day and time each narrow on their own axis");
    // ---------------------------------------------------------------
    await openPanel();
    await activityGroup.getByRole("button", { name: laneSwim, exact: true }).click();
    await page.waitForTimeout(300);
    const byActivity = await shown();
    check("picking one activity shows only it", byActivity.lane && !byActivity.water && !byActivity.aqua, JSON.stringify(byActivity));
    await activityGroup.getByRole("button", { name: laneSwim, exact: true }).click();

    // Wednesday is the discriminating case: it is the only session not on
    // Monday, so a day filter reading the wrong timezone's weekday fails here.
    await dayGroup.getByRole("button", { name: "Wed" }).click();
    await page.waitForTimeout(300);
    const byDay = await shown();
    check(
      "picking Wednesday shows only the Wednesday session",
      byDay.aqua && !byDay.water && !byDay.lane,
      JSON.stringify(byDay)
    );
    await dayGroup.getByRole("button", { name: "Wed" }).click();

    // Both Monday sessions, so only the time band separates them.
    await timeGroup.getByRole("button", { name: "Evening" }).click();
    await page.waitForTimeout(300);
    const byTime = await shown();
    check(
      "picking Evening keeps the 7pm session and drops the 9am one on the same day",
      byTime.lane && !byTime.water,
      JSON.stringify(byTime)
    );
    await timeGroup.getByRole("button", { name: "Evening" }).click();

    // ---------------------------------------------------------------
    console.log("\n4. Dimensions combine as AND, choices within one as OR");
    // ---------------------------------------------------------------
    await dayGroup.getByRole("button", { name: "Mon" }).click();
    await dayGroup.getByRole("button", { name: "Wed" }).click();
    await page.waitForTimeout(300);
    const twoDays = await shown();
    check(
      "two days is a union, not an intersection — everything on either day shows",
      twoDays.water && twoDays.lane && twoDays.aqua,
      JSON.stringify(twoDays)
    );

    await timeGroup.getByRole("button", { name: "Morning" }).click();
    await page.waitForTimeout(300);
    const dayAndTime = await shown();
    check(
      "adding a time band intersects with the days — only the Monday morning session survives",
      dayAndTime.water && !dayAndTime.lane && !dayAndTime.aqua,
      JSON.stringify(dayAndTime)
    );

    // ---------------------------------------------------------------
    console.log("\n5. Filtering everything out says so, and offers the way back");
    // ---------------------------------------------------------------
    await search.fill("Lane");
    await page.waitForTimeout(400);
    check(
      "an impossible combination explains itself rather than looking like an empty week",
      await page.getByText("No sessions match your filters").isVisible()
    );
    check(
      "…and is distinguishable from a genuinely empty week",
      (await page.getByText("No drop-in sessions scheduled this week").count()) === 0
    );
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.waitForTimeout(400);
    const recovered = await shown();
    check("its Clear button restores the week", recovered.water && recovered.lane && recovered.aqua);

    // ---------------------------------------------------------------
    console.log("\n6. The admin's switches really control what visitors get");
    // ---------------------------------------------------------------
    await setFilters(["search"]);
    await load();
    check("search alone leaves the search box", await search.isVisible());
    check(
      "…and removes the Filters button entirely (nothing left to put in it)",
      (await page.getByRole("button", { name: "Filters" }).count()) === 0
    );

    await setFilters([]);
    await load();
    check("turning every filter off removes the bar", (await page.getByRole("searchbox").count()) === 0);
    check(
      "…while the schedule itself is untouched",
      (await shown()).water,
      "the sessions vanished along with the filter bar"
    );

    await setFilters(["age"]);
    await load();
    check(
      "enabling a filter the data can't fill renders nothing rather than an empty control",
      (await page.getByRole("button", { name: "Filters" }).count()) === 0
    );
    check("…and again leaves the schedule alone", (await shown()).water);
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
