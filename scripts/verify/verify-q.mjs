/**
 * Widget studio — the redesigned /dashboard/widget, driven in a real browser.
 *
 * The redesign moved four things from "displayed" to "load-bearing", and every
 * one of them fails silently:
 *
 *   - **The preview window reflects unsaved state.** It works by handing the
 *     real /widget/[orgId] route preview-only `primary` and `title` params. If
 *     the iframe src stops carrying them the preview quietly shows the *saved*
 *     widget instead, which looks like a working preview that simply ignores
 *     you. Asserted from the iframe's actual src, with a before/after control,
 *     plus that the iframe exists only while the window is open (a hidden one
 *     costs every visit a widget render nobody sees).
 *   - **Those params must never apply outside preview mode.** They land in a
 *     style attribute and a heading, so a real embed that could be given
 *     `?primary=…&title=…` by anyone linking to it would be defaceable.
 *     Asserted by requesting the embed with both params and *without*
 *     `preview=1`.
 *   - **`custom_title` was a dead control before this change** — saved to
 *     `widget_configs`, read by nothing, while the header hardcoded
 *     "Schedule". Asserted end to end: the generic title first, the org's own
 *     title after publishing.
 *   - **"Loads first" is a reorder of `allowed_templates`,** not a new column.
 *     A toggle that appends instead of prepending leaves the badge moving and
 *     the widget still booting into the old view. Asserted through the saved
 *     array *and* which view toggle the real embed comes up pressed on.
 *
 * Plus the studio's own safety net: one publish action whose dirty bar appears
 * and clears, and per-page narrowing that stays in the snippet — a facility
 * chosen in step 4 rides in data-facility-id and narrows the switcher, without
 * creating the second saved row that 045 just removed.
 *
 * And step 1 — which is now *only* the schedule list (migration 045), with
 * four failure modes of its own:
 *
 *   - **One configuration per org.** Settings used to be keyed by
 *     facility+department, and the studio pre-selected the sidebar's facility,
 *     so an org ended up with its colour saved under one facility — rendered on
 *     that facility's public page and nowhere else, because /facility/[slug]
 *     looked up its own facility's row with no fallback. Asserted from the
 *     computed background of *both* facilities' public pages.
 *   - **The editor draws no widget of its own.** It used to open with a
 *     rendered `ScheduleScopeSwitcher` in the brand colour — a second, always
 *     partial preview a click away from the real one. The rows are now a
 *     collapsible list instead; asserted by the absence of that component from
 *     the editor and the presence of one line per row.
 *   - **A department-level scope must apply the department.** The fixture puts
 *     two departments in one building precisely so this can fail: with one
 *     department per building, dropping the department id entirely still shows
 *     the right sessions.
 *   - **The publish trap.** Migration 043 hides scopes whose chain isn't fully
 *     published, so a filter on a draft schedule saves with a 200 and is never
 *     seen. Asserted three ways: the editor warns and names the level, the
 *     visitor's embed omits it, and the *signed-in* preview omits it too —
 *     that last one only holds because the route filters publish state itself
 *     rather than leaning on anonymous RLS, since the preview iframe carries
 *     the admin's own session.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, the real
 * routes, signed in as a genuinely authenticated admin, teardown in a
 * `finally`.
 *
 *   npm run dev
 *   node scripts/verify/verify-q.mjs [--headed] [--shots=<dir>]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice(8) ?? null;

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

/** The same chunked cookie @supabase/ssr writes, so the browser is really signed in. */
function sessionCookiePairs(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [[COOKIE_NAME, value]];
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push([`${COOKIE_NAME}.${n}`, value.slice(i, i + MAX)]);
  }
  return chunks;
}

const isoDate = (d) => d.toISOString().slice(0, 10);

/** Sunday-anchored, matching `sessionWeekStart` in src/lib/utils/dates.ts. */
function weekStartOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

async function apiJson(url, cookieHeader) {
  const res = await fetch(url, { headers: cookieHeader ? { Cookie: cookieHeader } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture: an org with two published buildings, each with a running session");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-q ${stamp}`, slug: `zz-verify-q-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-q-${stamp}@example.invalid`;
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
  const cookiePairs = sessionCookiePairs(signIn.session);
  const cookieHeader = cookiePairs.map(([n, v]) => `${n}=${v}`).join("; ");

  async function makeFacility(label) {
    const { data: facility } = await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ ${label} Building ${stamp}`,
        slug: `zz-verify-q-${label.toLowerCase()}-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      // slug too: section 10 visits each facility's own public page, which is
      // the surface the per-facility config split used to leave un-branded.
      .select("id, name, slug")
      .single();
    return facility;
  }

  /**
   * A department + schedule + space + daily session under an existing building.
   *
   * Two of these in one building is what makes a *department-level* filter
   * mean anything: with one department per building, a department scope and a
   * facility scope select exactly the same sessions, and a test of the former
   * passes even if the department id is being dropped entirely.
   */
  async function addSchedule(facility, label, { scheduleStatus = "published" } = {}) {
    const slug = `zz-verify-q-${label.toLowerCase()}-${stamp}`;
    const { data: department } = await admin
      .from("departments")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: `ZZ ${label} Dept ${stamp}`,
        slug: `${slug}-dept`,
        is_published: true,
      })
      .select("id, name")
      .single();

    const scheduleName = `ZZ ${label} Schedule ${stamp}`;
    const { data: scheduleGroup } = await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: scheduleName,
        slug: `${slug}-sched`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: scheduleStatus,
        source: "manual",
      })
      .select("id, name")
      .single();

    const { data: space } = await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: `ZZ ${label} Space ${stamp}`,
        slug: `${slug}-space`,
        is_published: true,
      })
      .select("id")
      .single();

    const from = new Date(Date.now() - 3 * 86400000);
    const res = await fetch(`${APP}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=DAILY",
        valid_from: isoDate(from),
        valid_until: null,
        dtstart: `${isoDate(from)}T09:00:00Z`,
        dtend_time: "10:00",
        space_ids: [space.id],
      }),
    });
    if (res.status >= 300) throw new Error(`${label} session create: ${res.status} ${await res.text()}`);

    // Anonymous visitors only see weeks an admin approved (migration 037).
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

    return { facility, department, scheduleGroup, scheduleName };
  }

  const poolBuilding = await makeFacility("Pool");
  const arenaBuilding = await makeFacility("Arena");
  // Two departments in the Pool building, so a department-level filter has
  // something to actually exclude.
  const pool = await addSchedule(poolBuilding, "Lane");
  const poolDeep = await addSchedule(poolBuilding, "Deep");
  const arena = await addSchedule(arenaBuilding, "Ice");
  // A schedule that is still a draft — the publish trap in section 9.
  const arenaDraft = await addSchedule(arenaBuilding, "Draft", { scheduleStatus: "draft" });
  check(
    "fixture: two buildings, three published schedules (two in one building) and one draft",
    !!pool.department && !!poolDeep.department && !!arena.department && !!arenaDraft.scheduleGroup
  );

  // The widget's heading before anything is configured — the control for
  // section 4, which would otherwise be asserting against an unknown baseline.
  const beforeHtml = await (await fetch(`${APP}/widget/${org.id}`)).text();
  check(
    "baseline: an unconfigured embed's coloured bar reads the generic 'Schedule'",
    beforeHtml.includes(">Schedule<"),
    "generic title not found in the pre-publish embed"
  );

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(
      cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
    );
    const page = await context.newPage();

    // ---------------------------------------------------------------
    console.log("\n1. The studio loads with its four steps and a live preview alongside");
    // ---------------------------------------------------------------
    await page.goto(`${APP}/dashboard/widget`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "What should it show?" }).waitFor({ timeout: 30000 });

    for (const heading of [
      "What should it show?",
      "Make it yours",
      "Let visitors find their session",
      "Put it on your website",
    ]) {
      check(`step visible: ${heading}`, await page.getByRole("heading", { name: heading }).isVisible());
    }

    const previewFrame = page.locator('iframe[title="Widget preview"]');
    /** Dismiss the preview window and wait for its iframe to go away. */
    const closePreview = async () => {
      await page.getByRole("button", { name: "Close" }).click();
      await previewFrame.waitFor({ state: "detached", timeout: 10000 });
    };
    check(
      "no preview iframe is mounted until it is asked for (the page doesn't render a widget nobody is looking at)",
      (await previewFrame.count()) === 0
    );
    check(
      "step 1 opens on the empty list, which states the default rather than showing a blank row",
      await page.getByRole("heading", { name: "Showing everything you run" }).isVisible()
    );

    // ---------------------------------------------------------------
    console.log("\n2. The preview window: opens on demand, carries unsaved edits, unmounts on close");
    // ---------------------------------------------------------------
    await page.getByRole("button", { name: "Preview" }).first().click();
    await previewFrame.waitFor({ state: "attached", timeout: 20000 });
    const srcBefore = await previewFrame.getAttribute("src");
    check(
      "control: with nothing edited the preview src carries no title override",
      !!srcBefore && srcBefore.includes("preview=1") && !srcBefore.includes("title="),
      srcBefore ?? "no src"
    );

    // The window's own quick-tweak strip writes to the same state the steps do,
    // so a colour picked here is the colour the publish bar will publish.
    await page.getByRole("group", { name: "Brand colour" }).getByRole("button", { name: "Teal" }).click();
    // Escape only reaches the dialog while focus is in *this* document, which
    // the swatch click just guaranteed. Once the preview iframe reloads it
    // takes focus and the keystroke goes to the embedded page instead, so
    // every later close in this file goes through the Close button.
    await page.keyboard.press("Escape");
    await previewFrame.waitFor({ state: "detached", timeout: 10000 });
    check("closing the window unmounts the iframe", (await previewFrame.count()) === 0);

    const widgetTitle = `ZZ Pool Times ${stamp}`;
    await page.getByLabel("Widget heading").fill(widgetTitle);

    await page.getByRole("button", { name: "Preview" }).first().click();
    await previewFrame.waitFor({ state: "attached", timeout: 20000 });
    // The iframe src is debounced so typing doesn't reload it per keystroke.
    await page.waitForTimeout(1200);

    const srcAfter = await previewFrame.getAttribute("src");
    // URLSearchParams encodes spaces as "+", which decodeURIComponent leaves alone.
    const decodedSrc = decodeURIComponent((srcAfter ?? "").replace(/\+/g, "%20"));
    check("the preview src now carries the unsaved heading", decodedSrc.includes(widgetTitle), srcAfter ?? "no src");
    check(
      "…and the brand colour chosen inside the window itself",
      decodedSrc.includes("#0F766E"),
      srcAfter ?? "no src"
    );
    await closePreview();

    // ---------------------------------------------------------------
    console.log("\n3. One publish action, with a dirty state that appears and clears");
    // ---------------------------------------------------------------
    const publishBar = page.getByText("Not live yet");
    check("editing raises the publish bar", await publishBar.isVisible());

    await page.getByRole("button", { name: "Publish changes" }).click();
    await publishBar.waitFor({ state: "hidden", timeout: 20000 });
    check("publishing clears it", !(await publishBar.isVisible().catch(() => false)));

    const saved = await apiJson(`${APP}/api/widget-config?orgId=${org.id}`, cookieHeader);
    check("the colour reached widget_configs", saved.body?.config?.primary_color === "#0F766E", JSON.stringify(saved.body?.config));
    check("the heading reached widget_configs", saved.body?.config?.custom_title === widgetTitle, JSON.stringify(saved.body?.config));

    // ---------------------------------------------------------------
    console.log("\n4. custom_title now actually renders on the real embed (it used to be a dead field)");
    // ---------------------------------------------------------------
    const liveHtml = await (await fetch(`${APP}/widget/${org.id}`)).text();
    check("the embed's coloured bar shows the org's own heading", liveHtml.includes(widgetTitle));
    check(
      "…and no longer shows the hardcoded 'Schedule'",
      !liveHtml.includes(">Schedule<"),
      "generic title still present"
    );
    check("the saved brand colour is applied to the header bar", liveHtml.includes("#0F766E"));

    // ---------------------------------------------------------------
    console.log("\n5. Preview-only params are inert outside preview mode");
    // ---------------------------------------------------------------
    // Asserted in a browser, against what is actually rendered: the raw HTML
    // of a dev build echoes the request's search params inside the RSC payload,
    // so a substring check on the response body reports a defacement that
    // isn't there. What matters is the heading element and the header bar's
    // computed background.
    const attacked = await context.newPage();
    await attacked.goto(`${APP}/widget/${org.id}?primary=%23FF0000&title=ZZ%20INJECTED%20${stamp}`, {
      waitUntil: "networkidle",
    });
    const headerBar = attacked.locator("h2").first();
    const headerText = (await headerBar.textContent()) ?? "";
    const barColor = await headerBar.evaluate(
      (el) => getComputedStyle(el.parentElement).backgroundColor
    );
    check("a real embed ignores an injected title", !headerText.includes("ZZ INJECTED"), headerText);
    check("…and still renders the org's saved heading", headerText.includes(widgetTitle), headerText);
    check(
      "a real embed ignores an injected colour — the bar stays the saved teal",
      barColor === "rgb(15, 118, 110)",
      barColor
    );
    await attacked.close();

    // ---------------------------------------------------------------
    console.log("\n6. 'Loads first' is a real reorder of allowed_templates");
    // ---------------------------------------------------------------
    // Grid ships first by default; promote List and confirm the widget boots into it.
    const listToggleTile = page.getByRole("button", { name: "List", exact: true });
    if ((await listToggleTile.getAttribute("aria-pressed")) !== "true") await listToggleTile.click();
    await page.getByRole("button", { name: "Make List load first" }).click();
    await page.getByRole("button", { name: "Publish changes" }).click();
    await page.getByText("Not live yet").waitFor({ state: "hidden", timeout: 20000 });

    const reordered = await apiJson(`${APP}/api/widget-config?orgId=${org.id}`, cookieHeader);
    check(
      "list is now first in the saved allowed_templates array",
      reordered.body?.config?.allowed_templates?.[0] === "list",
      JSON.stringify(reordered.body?.config?.allowed_templates)
    );

    const visitor = await context.newPage();
    await visitor.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });
    const listToggle = visitor.getByRole("button", { name: "List", exact: true });
    check(
      "the real embed comes up on the List view, not the old default",
      (await listToggle.getAttribute("aria-pressed")) === "true",
      await listToggle.getAttribute("aria-pressed")
    );
    await visitor.close();

    // ---------------------------------------------------------------
    console.log("\n7. Step 1 is one list: empty means everything, and one click fills it per facility");
    // ---------------------------------------------------------------
    const filtersSection = page.locator("section").filter({ hasText: "What should it show?" });
    check(
      "the empty list says what the embed does rather than drawing a widget inside the editor",
      (await filtersSection.getByRole("group", { name: "Choose a schedule" }).count()) === 0 &&
        (await filtersSection.getByRole("heading", { name: "Showing everything you run" }).isVisible())
    );
    check(
      "…and step 1 carries no second facility control beside it",
      (await filtersSection.getByRole("group", { name: "Which schedule this embed shows" }).count()) === 0
    );

    await page.getByRole("button", { name: /One per facility/ }).click();
    check("…and one click seeds a row per facility", (await page.getByLabel(/^Label for schedule \d+$/).count()) === 2);
    check(
      "each row is one line naming where it points",
      (await filtersSection.getByRole("listitem").count()) === 2 &&
        ((await filtersSection.textContent()) ?? "").includes(poolBuilding.name),
      await filtersSection.textContent()
    );
    check(
      "…and still no mock switcher once there are rows to draw one from",
      (await filtersSection.getByRole("group", { name: "Choose a schedule" }).count()) === 0
    );

    await page.getByRole("button", { name: "Publish changes" }).click();
    await page.getByText("Not live yet").waitFor({ state: "hidden", timeout: 20000 });
    const seeded = await apiJson(`${APP}/api/widget-config?orgId=${org.id}`, cookieHeader);
    check("both rows saved", seeded.body?.scopes?.length === 2, JSON.stringify(seeded.body?.scopes));

    // ---------------------------------------------------------------
    console.log("\n8. A department-level filter re-scopes to that department, not the whole building");
    // ---------------------------------------------------------------
    // Point both rows at the same building, one per department: the only thing
    // separating them is the department id, so if it were being dropped both
    // would show both schedules.
    const laneLabel = `ZZ Lane Filter ${stamp}`;
    const deepLabel = `ZZ Deep Filter ${stamp}`;
    const rowSelects = filtersSection.locator("select");

    // Publishing collapses the rows back to lines, which is the point of the
    // list — so the pickers have to be asked for before they can be driven.
    check(
      "a published row keeps its pickers put away",
      (await rowSelects.count()) === 0,
      `${await rowSelects.count()} selects still on screen`
    );
    await page.getByRole("button", { name: `Edit ${poolBuilding.name}` }).click();
    await page.getByRole("button", { name: `Edit ${arenaBuilding.name}` }).click();
    check(
      "opening both rows brings back exactly their three pickers each",
      (await rowSelects.count()) === 6,
      `${await rowSelects.count()} selects`
    );

    await page.getByLabel("Label for schedule 1").fill(laneLabel);
    await rowSelects.nth(0).selectOption(poolBuilding.id);
    await rowSelects.nth(1).selectOption(pool.department.id);
    await page.getByLabel("Label for schedule 2").fill(deepLabel);
    await rowSelects.nth(3).selectOption(poolBuilding.id);
    await rowSelects.nth(4).selectOption(poolDeep.department.id);

    check(
      "the row spells out what it will show, department included",
      ((await filtersSection.textContent()) ?? "").includes(`${poolBuilding.name} › ${pool.department.name}`),
      "no breadcrumb naming building › department"
    );

    await page.getByRole("button", { name: "Publish changes" }).click();
    await page.getByText("Not live yet").waitFor({ state: "hidden", timeout: 20000 });

    const deptVisitor = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const deptPage = await deptVisitor.newPage();
    await deptPage.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });
    const laneSession = deptPage.getByText(pool.scheduleName).first();
    const deepSession = deptPage.getByText(poolDeep.scheduleName).first();
    await laneSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});

    check("the first department's sessions are on screen", await laneSession.isVisible());
    check(
      "…and the second department's are not — the department id is really applied",
      !(await deepSession.isVisible().catch(() => false))
    );

    await deptPage.getByRole("button", { name: deepLabel }).click();
    await deepSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    check("picking the second department swaps the sessions", await deepSession.isVisible());
    check(
      "…and hides the first department's",
      !(await laneSession.isVisible().catch(() => false))
    );
    check(
      "the switcher names the department, which the label alone cannot",
      ((await deptPage.getByRole("group", { name: "Choose a schedule" }).textContent()) ?? "").includes(
        poolDeep.department.name
      )
    );
    await deptPage.close();
    await deptVisitor.close();

    // ---------------------------------------------------------------
    console.log("\n9. The publish trap: a filter on a draft schedule is called out, and never reaches anyone");
    // ---------------------------------------------------------------
    await filtersSection.getByRole("button", { name: "Add a schedule" }).click();
    const draftLabel = `ZZ Draft Filter ${stamp}`;
    await page.getByLabel("Label for schedule 3").fill(draftLabel);
    // The two published rows collapsed on save (the widget_config_scopes rows
    // are re-inserted, so they come back as fresh, closed lines), leaving the
    // new row's three pickers as the only ones mounted.
    check(
      "the just-added row is the only one open",
      (await rowSelects.count()) === 3,
      `${await rowSelects.count()} selects`
    );
    await rowSelects.nth(0).selectOption(arenaBuilding.id);
    await rowSelects.nth(2).selectOption(arenaDraft.scheduleGroup.id);

    check(
      "the editor warns that visitors won't see it, naming the level to publish",
      ((await filtersSection.textContent()) ?? "").includes("until you publish") &&
        ((await filtersSection.textContent()) ?? "").includes(arenaDraft.scheduleName),
      await filtersSection.textContent()
    );

    await page.getByRole("button", { name: "Publish changes" }).click();
    await page.getByText("Not live yet").waitFor({ state: "hidden", timeout: 20000 });
    const withDraft = await apiJson(`${APP}/api/widget-config?orgId=${org.id}`, cookieHeader);
    check(
      "control: it really was saved — this is a visibility gate, not a rejected write",
      (withDraft.body?.scopes ?? []).some((s) => s.label === draftLabel),
      JSON.stringify(withDraft.body?.scopes)
    );

    const anonHtml = await (await fetch(`${APP}/widget/${org.id}`)).text();
    check("a visitor never sees the draft filter", !anonHtml.includes(draftLabel));
    check("…while the published ones are there", anonHtml.includes(laneLabel));

    // Same list, signed in. The preview iframe is same-origin and carries the
    // admin's session, so before the route filtered publish state explicitly
    // this showed staff a switcher entry no visitor would ever get.
    await page.getByRole("button", { name: "Preview" }).first().click();
    await previewFrame.waitFor({ state: "attached", timeout: 20000 });
    const previewBody = page.frameLocator('iframe[title="Widget preview"]').locator("body");
    // The studio builds the preview src from NEXT_PUBLIC_APP_URL, not from the
    // origin it is being served on, so under `--app=<another port>` this iframe
    // points at whatever is (or isn't) running on the configured one. Say so
    // rather than spending 20s timing out on an empty document.
    const previewOrigin = new URL((await previewFrame.getAttribute("src")) ?? APP).origin;
    if (previewOrigin !== new URL(APP).origin) {
      console.log(
        `  SKIP  signed-in preview checks — its iframe points at ${previewOrigin} (NEXT_PUBLIC_APP_URL), not ${APP}`
      );
    } else {
      await previewBody.getByRole("group", { name: "Choose a schedule" }).waitFor({ timeout: 20000 });
      const previewSwitcherText =
        (await previewBody.getByRole("group", { name: "Choose a schedule" }).textContent()) ?? "";
      check(
        "the signed-in preview hides it too — the preview shows the visitor's filter list",
        !previewSwitcherText.includes(draftLabel),
        previewSwitcherText
      );
      check(
        "…and still shows the published ones (so this isn't an empty-switcher false pass)",
        previewSwitcherText.includes(laneLabel),
        previewSwitcherText
      );
    }
    await closePreview();

    // ---------------------------------------------------------------
    console.log("\n10. One configuration per org — every public surface inherits it");
    // ---------------------------------------------------------------
    // Migration 045. Settings used to be keyed by facility+department, and
    // /facility/[slug] asked for *its own* facility's row with no fallback, so
    // an org whose only row was scoped to one facility got its real colour on
    // that page and the stock blue everywhere else. The colour published back
    // in section 3 was saved with no facility in play at all.
    const savedColorRgb = "rgb(15, 118, 110)"; // #0F766E
    for (const building of [poolBuilding, arenaBuilding]) {
      const publicPage = await context.newPage();
      await publicPage.goto(`${APP}/facility/${building.slug}`, { waitUntil: "domcontentloaded" });
      // The page's own coloured bar, by its fixed heading — not `h2` by
      // position, which would also match the "Information" panel below it.
      const bar = publicPage.getByRole("heading", { name: "Weekly Schedule" });
      await bar.waitFor({ timeout: 20000 });
      const barColor = await bar.evaluate((el) => getComputedStyle(el.parentElement).backgroundColor);
      check(
        `${building.name.replace(` ${stamp}`, "")}'s public page renders the org's own colour`,
        barColor === savedColorRgb,
        barColor
      );
      await publicPage.close();
    }

    // ---------------------------------------------------------------
    console.log("\n11. Per-page narrowing is a property of the snippet, not a second saved config");
    // ---------------------------------------------------------------
    await page.getByLabel("Show only one facility on this page?").selectOption(poolBuilding.id);
    const snippet = (await page.locator("pre").first().textContent()) ?? "";
    check(
      "choosing a facility puts it in the code rather than changing what is saved",
      snippet.includes(`data-facility-id="${poolBuilding.id}"`),
      snippet
    );
    const stillClean = await apiJson(`${APP}/api/widget-config?orgId=${org.id}`, cookieHeader);
    check(
      "…and the saved row stays the org's one row",
      stillClean.body?.config?.facility_id === null && stillClean.body?.config?.department_id === null,
      JSON.stringify({ f: stillClean.body?.config?.facility_id, d: stillClean.body?.config?.department_id })
    );

    // What that snippet actually serves: the switcher narrows to the entries
    // belonging to that facility instead of ignoring the scope it was given.
    const poolScoped = await (await fetch(`${APP}/widget/${org.id}?facilityId=${poolBuilding.id}`)).text();
    const arenaScoped = await (await fetch(`${APP}/widget/${org.id}?facilityId=${arenaBuilding.id}`)).text();
    check(
      "a facility-scoped embed keeps that facility's entries",
      poolScoped.includes(laneLabel) && poolScoped.includes(deepLabel)
    );
    check(
      "…and drops the others entirely",
      !arenaScoped.includes(laneLabel) && !arenaScoped.includes(deepLabel)
    );
    check(
      "control: the unscoped embed still carries them",
      (await (await fetch(`${APP}/widget/${org.id}`)).text()).includes(laneLabel)
    );
    // Leave the snippet unscoped again so the screenshots below are the default.
    await page.getByLabel("Show only one facility on this page?").selectOption("");

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "What should it show?" }).waitFor({ timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(SHOTS, "studio-desktop.png"), fullPage: true });

      // Step 1 on its own, list closed and open: the two states it has.
      await filtersSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await filtersSection.screenshot({ path: path.join(SHOTS, "step1-schedules.png") });
      await filtersSection.getByRole("button", { name: /^Edit / }).first().click();
      await page.waitForTimeout(400);
      await filtersSection.screenshot({ path: path.join(SHOTS, "step1-schedules-open.png") });

      // The preview at the size it exists to be seen at.
      await page.getByRole("button", { name: "Preview" }).first().click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(SHOTS, "preview-window.png") });
      await closePreview();
      await page.waitForTimeout(500);

      // The unsaved state, which is a designed state rather than an error one.
      await page.getByLabel("Widget heading").fill(`${widgetTitle} (edited)`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, "studio-desktop-dirty.png") });

      const phone = await context.newPage();
      await phone.setViewportSize({ width: 390, height: 844 });
      await phone.goto(`${APP}/dashboard/widget`, { waitUntil: "networkidle" });
      await phone.getByRole("heading", { name: "What should it show?" }).waitFor({ timeout: 30000 });
      await phone.waitForTimeout(2000);
      await phone.screenshot({ path: path.join(SHOTS, "studio-phone.png"), fullPage: true });

      await phone.getByRole("button", { name: "Preview" }).first().click();
      await phone.waitForTimeout(3000);
      await phone.screenshot({ path: path.join(SHOTS, "studio-phone-preview.png") });
      await phone.close();
      console.log(`\n  screenshots written to ${SHOTS}`);
    }
  } finally {
    await browser.close();
  }
} catch (err) {
  // Without this the `finally` below exits on the assertion count alone, so a
  // fixture that throws before the first check reports "0 passed, 0 failed"
  // and looks like a clean run.
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
