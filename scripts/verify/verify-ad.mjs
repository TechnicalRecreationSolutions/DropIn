/**
 * Visitor print button (migration 051) — driven in a real browser.
 *
 * The printout is a separate, print-only rendering (PrintableSchedule.tsx)
 * fed the *filtered* week, so nothing here is visible to a `fetch()`: the
 * filters run after hydration and the sheet only shows under print media.
 *
 * What it asserts, and why each half matters:
 *
 *   - **Off unless the org turns it on.** A real embed with allow_print unset
 *     renders no button — and still renders at all when the column has not
 *     been applied yet (`select("*")` in the widget route).
 *   - **Screen and paper are separate.** The sheet is hidden on screen; under
 *     print media it shows and the interactive header does not.
 *   - **The printout is what the visitor filtered.** A day filter and a search
 *     each narrow the sheet, and the excluded activity is asserted *absent* —
 *     "the right ones show" means nothing without "the wrong ones do not".
 *   - **The disclaimers.** Always "subject to change" and a printed-at time;
 *     the "filtered view" notice only when a filter is on, naming it, with the
 *     N-of-M count. The unfiltered print is the negative control for that.
 *
 * Until 051 is applied, the button is exercised through the preview-only
 * `?preview=1&print=1` override (what the studio's preview window uses), and
 * the API / saved-setting / facility-page checks SKIP rather than fail.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, the real
 * routes, teardown in a `finally`. The fixture is verify-r's.
 *
 *   npm run dev
 *   node scripts/verify/verify-ad.mjs [--headed] [--app=http://localhost:3000] [--out=dir]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";

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
  // LOCAL calendar date, parked at UTC midnight so isoDate() reads the same
  // digits back. Reading `date` with UTC getters here is the bug that turned
  // this harness red every day after 17:00 Pacific: the app decides which week
  // to render with local getters (getWeekStart in src/lib/utils/dates.ts), so
  // once UTC has crossed midnight the fixture writes its sessions into a week
  // the page is not showing — a whole week off, on a Saturday evening. See the
  // note in README.md.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
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
    .insert({ name: `ZZ verify-ad ${stamp}`, slug: `zz-verify-ad-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-ad-${stamp}@example.invalid`;
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
      slug: `zz-verify-ad-${stamp}`,
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
      slug: `zz-verify-ad-dept-${stamp}`,
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
      slug: `zz-verify-ad-space-${stamp}`,
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
        slug: `zz-verify-ad-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
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

  const { data: printProbe } = await admin.from("widget_configs").select("*").limit(1);
  const hasColumn = !!printProbe?.[0] && "allow_print" in printProbe[0];
  console.log(
    `   (widget_configs.allow_print ${hasColumn ? "exists" : "is MISSING: migration 051 not applied, using the preview override"})`
  );

  async function patchConfig(body) {
    const res = await fetch(`${APP}/api/widget-config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        // Grid, not list: the list view folds away days already past, so on any
        // day after Monday the Monday fixtures would be off screen (verify-r has
        // exactly that date dependence). The print sheet ignores it either way.
        allowedTemplates: ["grid"],
        enabledFilters: ["search", "activity", "day", "time"],
        ...body,
      }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  const baseSave = await patchConfig({});
  check("config saved (grid view, filters on)", baseSave.status === 200, JSON.stringify(baseSave.body));

  // ---------------------------------------------------------------
  console.log("\n1. The setting");
  // ---------------------------------------------------------------
  if (hasColumn) {
    check(
      "a fresh config defaults to print off",
      baseSave.body?.config?.allow_print === false,
      JSON.stringify(baseSave.body?.config?.allow_print)
    );
    const bad = await patchConfig({ allowPrint: "yes" });
    check("a non-boolean allowPrint is rejected", bad.status === 400, `status=${bad.status}`);
  } else {
    console.log("  SKIP  API checks (column missing)");
  }

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    const page = await context.newPage();
    const printBtn = page.getByRole("button", { name: "Print this schedule" });
    const sheet = page.locator(".printable-schedule");
    const board = page.getByRole("region", { name: "Schedule" });

    async function load(url) {
      await page.emulateMedia({ media: "screen" });
      // "load", not "networkidle": the dev server keeps an HMR socket open,
      // and networkidle timed out intermittently on it.
      await page.goto(url, { waitUntil: "load" });
      await board.getByText(waterWalking).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    }
    /** The sheet's text under print media, then back to screen so the controls stay clickable. */
    async function printed() {
      await page.emulateMedia({ media: "print" });
      const visible = await sheet.isVisible();
      const text = visible ? await sheet.innerText() : "";
      const headerHidden = !(await printBtn.isVisible().catch(() => false));
      await page.emulateMedia({ media: "screen" });
      return { visible, text, headerHidden };
    }

    const realUrl = `${APP}/widget/${org.id}?facilityId=${facility.id}`;
    const previewUrl = (on) =>
      `${realUrl}&preview=1&templates=grid&filters=search,activity,day,time&print=${on ? 1 : 0}`;

    // ---------------------------------------------------------------
    console.log("\n2. Off by default");
    // ---------------------------------------------------------------
    await load(realUrl);
    check("control: the real embed renders its sessions", await board.getByText(waterWalking).first().isVisible());
    check("the real embed has no Print button while allow_print is unset", (await printBtn.count()) === 0);
    await load(previewUrl(false));
    check("preview with print=0 has no Print button", (await printBtn.count()) === 0);
    check("…and no print sheet in the page at all", (await sheet.count()) === 0);

    // ---------------------------------------------------------------
    console.log("\n3. On: the button, and an unfiltered printout");
    // ---------------------------------------------------------------
    await load(previewUrl(true));
    check("preview with print=1 shows the Print button", await printBtn.isVisible());
    check("the sheet is hidden on screen", !(await sheet.isVisible()));
    const all = await printed();
    check("under print media the sheet shows", all.visible);
    check("…and the interactive header is hidden", all.headerHidden);
    check("says the schedule is subject to change", /subject to change/i.test(all.text), all.text.slice(0, 200));
    check("says when it was printed", /Printed [A-Z][a-z]+ \d+, \d{4} at/.test(all.text));
    check("lists all three activities", [waterWalking, laneSwim, aquaFit].every((n) => all.text.includes(n)));
    check("negative control: no 'filtered view' notice when nothing is filtered", !/filtered view/i.test(all.text));
    check("an empty day still prints when unfiltered", /No drop-in sessions\./.test(all.text));
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${OUT}/verify-ad-unfiltered.pdf`, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });

    // ---------------------------------------------------------------
    console.log("\n4. A day filter carries into the printout");
    // ---------------------------------------------------------------
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("group", { name: "Day" }).getByRole("button", { name: "Mon", exact: true }).click();
    await board.getByText(aquaFit).first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    const mon = await printed();
    check("Monday's two activities print", mon.text.includes(waterWalking) && mon.text.includes(laneSwim));
    check("Wednesday's activity does not", !mon.text.includes(aquaFit));
    check("the notice says the view is filtered", /filtered view — some sessions are not shown/i.test(mon.text));
    check("…names the filter", /Day: Mon/.test(mon.text), mon.text.slice(0, 400));
    check("…and counts what is left", /\(2 of 3 this week\)/.test(mon.text));
    check("days the filter emptied are left off the sheet", !/No drop-in sessions\./.test(mon.text));

    // ---------------------------------------------------------------
    console.log("\n5. A search carries into the printout");
    // ---------------------------------------------------------------
    await page.getByRole("button", { name: "Clear all" }).click();
    // "fit", not "aqua": search also matches facility and department names,
    // and the fixture facility is "ZZ Aquatic Centre", so "aqua" matches all three.
    await page.getByRole("searchbox", { name: "Search the schedule" }).fill("fit");
    await board.getByText(waterWalking).first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    const aq = await printed();
    check("the matching activity prints", aq.text.includes(aquaFit));
    check("the others do not", !aq.text.includes(waterWalking) && !aq.text.includes(laneSwim));
    check("the notice names the search", /Search: “fit”/.test(aq.text), aq.text.slice(0, 400));
    check("…and counts 1 of 3", /\(1 of 3 this week\)/.test(aq.text));
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${OUT}/verify-ad-filtered.pdf`, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });

    // ---------------------------------------------------------------
    console.log("\n6. The saved setting (needs migration 051)");
    // ---------------------------------------------------------------
    if (hasColumn) {
      const on = await patchConfig({ allowPrint: true });
      check(
        "PATCH saves allowPrint",
        on.status === 200 && on.body?.config?.allow_print === true,
        JSON.stringify(on.body?.config)
      );
      await load(realUrl);
      check("the real embed now shows the Print button", await printBtn.isVisible());

      const { data: fac } = await admin.from("facilities").select("slug").eq("id", facility.id).single();
      await page.goto(`${APP}/facility/${fac.slug}`, { waitUntil: "load" });
      // Scoped to the schedule card: the page's "Schedules offered" sidebar
      // prints the same names server-side, so a page-wide match passes while
      // the schedule itself is still loading — which is how this check first
      // passed on a page that had not rendered a single session yet.
      const facilityBoard = page.locator(".org-theme");
      const facilityShown = await facilityBoard
        .getByText(waterWalking)
        .first()
        .waitFor({ state: "visible", timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check("control: the facility page's schedule renders its sessions", facilityShown);
      check(
        "the public facility page shows it too",
        await printBtn.isVisible(),
        `buttons=${await printBtn.count()} sheets=${await sheet.count()}`
      );
      await page.emulateMedia({ media: "print" });
      check(
        "…and prints the sheet without the site nav",
        (await sheet.isVisible()) && !(await page.locator("header.sticky").isVisible())
      );
      await page.emulateMedia({ media: "screen" });

      const off = await patchConfig({ allowPrint: false });
      await load(realUrl);
      check("turning it off removes the button again", off.status === 200 && (await printBtn.count()) === 0);

      // The facility page's data is `"use cache"` for hours, and it was cached
      // with print ON a moment ago. Without the PATCH expiring its tag, this
      // visit gets the stale entry and still shows the button.
      await page.goto(`${APP}/facility/${fac.slug}`, { waitUntil: "load" });
      await facilityBoard.getByText(waterWalking).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      check(
        "…on the (cached) facility page too — a publish expires its cache",
        (await facilityBoard.getByText(waterWalking).first().isVisible()) && (await printBtn.count()) === 0,
        `buttons=${await printBtn.count()}`
      );
    } else {
      console.log("  SKIP  column missing: apply supabase/migrations/051_widget_allow_print.sql and re-run");
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
