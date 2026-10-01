/**
 * The widget's filter section folds behind a "Filters" toggle, and the org
 * picks whether it starts open or collapsed (migration 066,
 * widget_configs.filters_collapsed).
 *
 *   1. The setting: the API rejects a non-boolean, saves a boolean once 066 is
 *      applied, and before 066 a publish carrying it still succeeds (the trap
 *      verify-q found for allow_print and verify-bh for multi_select_levels).
 *   2. The embed, through the preview override (runs before 066 too):
 *      collapsed=0 starts open, collapsed=1 starts folded, the toggle opens and
 *      closes it, and a folded section still shows the active count and
 *      "Clear filters". `collapsed=1` WITHOUT preview=1 is ignored.
 *   3. With 066 applied, the saved setting on a real embed and on the public
 *      facility page — and flipping it back is the positive control.
 *   4. The studio's Visitor tools section sets it; the preview shows it before publishing.
 *   5. The landing hero: open on a desktop, folded on a phone, and its
 *      "Your own widget" step 3 offers Open / Collapsed.
 *
 * The fixture: one published building with one live schedule and a daily
 * session, so the filter bar (Search is a default filter) always renders.
 *
 *   npm run dev
 *   node scripts/verify/verify-bi.mjs [--app=http://localhost:3000] [--headed]
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
function skipped(label) {
  skip++;
  console.log(`  SKIP  ${label}`);
}

function sessionCookies(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  return chunks.join("; ");
}

async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const isoDate = (d) => d.toISOString().slice(0, 10);
/** Sunday-anchored on the LOCAL date, as the app picks its week (see verify-p). */
function weekStartOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

/** The filter section's toggle and one control inside it. */
const toggleOf = (page) => page.getByRole("button", { name: /^Filters/ }).first();
const searchOf = (page) => page.getByRole("searchbox", { name: "Search" }).first();
async function expanded(page) {
  await toggleOf(page).waitFor({ timeout: 30000 });
  return toggleOf(page).getAttribute("aria-expanded");
}

/**
 * The facility page caches the widget config (facility/[facilitySlug]/page.tsx)
 * and the PATCH expires its tag; under `next dev` that can land a beat late
 * (see feedback_dev_cache_lag). Reload until it shows `want` or 15 s pass, and
 * say how long it took — a page that never changes still fails.
 */
async function settledFacilityState(page, url, want) {
  const started = Date.now();
  let got = null;
  while (Date.now() - started < 15000) {
    await page.goto(url, { waitUntil: "networkidle" });
    got = await expanded(page);
    if (got === want) break;
    await page.waitForTimeout(1000);
  }
  console.log(`        (facility page showed aria-expanded=${got} after ${Date.now() - started} ms)`);
  return got;
}

try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture: one building, one live schedule");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-bi ${stamp}`, slug: `zz-verify-bi-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-bi-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);
  ids.users.push(userData.user.id);
  const { error: memErr } = await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });
  if (memErr) throw new Error(`membership: ${memErr.message}`);
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  const facilitySlug = `zz-bi-pool-${stamp}`;
  const { data: facility, error: facErr } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ Pool ${stamp}`,
      slug: facilitySlug,
      address_line1: "1 Test St",
      city: "Vancouver",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();
  if (facErr) throw new Error(`facility: ${facErr.message}`);
  const { data: dept, error: deptErr } = await admin
    .from("departments")
    .insert({ org_id: org.id, facility_id: facility.id, name: `ZZ Aquatics ${stamp}`, slug: `zz-bi-aq-${stamp}`, is_published: true })
    .select("id")
    .single();
  if (deptErr) throw new Error(`department: ${deptErr.message}`);
  const { data: group, error: groupErr } = await admin
    .from("schedule_groups")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: dept.id,
      name: `ZZ Lane Swim ${stamp}`,
      slug: `zz-bi-lane-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status: "published",
      source: "manual",
    })
    .select("id")
    .single();
  if (groupErr) throw new Error(`schedule: ${groupErr.message}`);
  const { data: space } = await admin
    .from("spaces")
    .insert({ org_id: org.id, facility_id: facility.id, department_id: dept.id, name: `ZZ Lane ${stamp}`, slug: `zz-bi-space-${stamp}`, is_published: true })
    .select("id")
    .single();
  const from = new Date(Date.now() - 3 * 86400000);
  const created = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: "FREQ=DAILY",
      valid_from: isoDate(from),
      valid_until: null,
      dtstart: `${isoDate(from)}T09:00:00Z`,
      dtend_time: "10:00",
      space_ids: [space.id],
    }),
  });
  if (created.status >= 300) throw new Error(`session: ${created.status} ${JSON.stringify(created.body)}`);
  for (const offset of [-7, 0, 7]) {
    await admin.from("schedule_week_reviews").insert({
      org_id: org.id,
      schedule_group_id: group.id,
      week_start: isoDate(weekStartOf(new Date(Date.now() + offset * 86400000))),
      status: "approved",
      reviewed_by: userData.user.id,
      reviewed_at: new Date().toISOString(),
    });
  }
  check("fixture built", true);

  // ---------------------------------------------------------------
  console.log("\n1. The setting: widget_configs.filters_collapsed (migration 066)");
  // ---------------------------------------------------------------
  const { error: colErr } = await admin.from("widget_configs").select("filters_collapsed").limit(0);
  const has066 = !colErr;
  console.log(`  (migration 066 ${has066 ? "is" : "is NOT"} applied)`);

  const fresh = await api(`/api/widget-config?orgId=${org.id}`);
  check(
    "a never-saved config carries the key exactly when the column exists",
    has066 === ("filters_collapsed" in (fresh.body?.config ?? {})),
    JSON.stringify(Object.keys(fresh.body?.config ?? {}))
  );
  if (has066) check("…defaulting to open (false)", fresh.body.config.filters_collapsed === false);

  const badValue = await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ filtersCollapsed: "yes" }) });
  check("a non-boolean is a 400", badValue.status === 400, String(badValue.status));

  const withTitle = await api("/api/widget-config", cookie, {
    method: "PATCH",
    body: JSON.stringify({ customTitle: `ZZ Title ${stamp}`, filtersCollapsed: true }),
  });
  check(
    "a publish carrying it succeeds, title and all",
    withTitle.status === 200 && withTitle.body?.config?.custom_title === `ZZ Title ${stamp}`,
    `${withTitle.status} ${JSON.stringify(withTitle.body)}`
  );
  if (has066) {
    check("…and saves it", withTitle.body?.config?.filters_collapsed === true, JSON.stringify(withTitle.body?.config?.filters_collapsed));
    const back = await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ filtersCollapsed: false }) });
    check("…and false saves too (control)", back.status === 200 && back.body?.config?.filters_collapsed === false);
  } else {
    skipped("…and saves it (needs 066)");
  }

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    // ---------------------------------------------------------------
    console.log("\n2. The embed, through the preview override");
    // ---------------------------------------------------------------
    await page.goto(`${APP}/widget/${org.id}?preview=1&collapsed=0`, { waitUntil: "networkidle" });
    check("collapsed=0: the section starts open", (await expanded(page)) === "true");
    check("…with its controls visible", await searchOf(page).isVisible());

    await page.goto(`${APP}/widget/${org.id}?preview=1&collapsed=1`, { waitUntil: "networkidle" });
    check("collapsed=1: the section starts folded", (await expanded(page)) === "false");
    check("…its controls hidden", !(await searchOf(page).isVisible()));
    check("…and the toggle says it can be opened", (await toggleOf(page).textContent())?.includes("Show"));

    await toggleOf(page).click();
    check("clicking the toggle opens it", (await expanded(page)) === "true" && (await searchOf(page).isVisible()));
    await searchOf(page).fill("Lane");
    await toggleOf(page).click();
    check("clicking again folds it", (await expanded(page)) === "false" && !(await searchOf(page).isVisible()));
    const folded = (await toggleOf(page).textContent()) ?? "";
    check("a folded section still shows the active count", folded.includes("1") && folded.includes("active"), folded);
    check(
      "…and the result count with Clear filters",
      await page.getByRole("button", { name: "Clear filters" }).first().isVisible()
    );
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    check("Clear filters empties the count", !((await toggleOf(page).textContent()) ?? "").includes("active"));

    // Without preview=1 the override is just a query string anyone could add.
    await page.goto(`${APP}/widget/${org.id}?collapsed=1`, { waitUntil: "networkidle" });
    check(
      has066 ? "collapsed=1 without preview=1 is ignored (saved: open)" : "collapsed=1 without preview=1 is ignored",
      (await expanded(page)) === "true"
    );

    // ---------------------------------------------------------------
    console.log("\n3. The saved setting, on a real embed and the facility page");
    // ---------------------------------------------------------------
    if (has066) {
      await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ filtersCollapsed: true }) });
      await page.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });
      check("saved collapsed: the embed starts folded", (await expanded(page)) === "false");
      check(
        "…and so does the public facility page",
        (await settledFacilityState(page, `${APP}/facility/${facilitySlug}`, "false")) === "false"
      );

      await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ filtersCollapsed: false }) });
      await page.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });
      check("saved open (control): the embed starts open", (await expanded(page)) === "true");
      check(
        "…and so does the facility page",
        (await settledFacilityState(page, `${APP}/facility/${facilitySlug}`, "true")) === "true"
      );
    } else {
      skipped("saved setting on the embed (needs 066)");
      skipped("saved setting on the facility page (needs 066)");
    }

    // ---------------------------------------------------------------
    console.log("\n4. The studio's Visitor tools section");
    // ---------------------------------------------------------------
    if (has066) {
      const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await staff.addCookies(
        cookie.split("; ").map((pair) => {
          const at = pair.indexOf("=");
          return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: new URL(APP).hostname, path: "/" };
        })
      );
      const studio = await staff.newPage();
      await studio.goto(`${APP}/dashboard/widget`, { waitUntil: "networkidle" });
      await studio.locator("#widget-tab-tools").waitFor({ timeout: 30000 });
      await studio.locator("#widget-tab-tools").click();
      const startGroup = studio.getByRole("radiogroup", { name: "Filter section starts" });
      const option = (name) => startGroup.getByRole("radio", { name });
      check("Visitor tools offers Open / Collapsed, Open for this org", (await option("Open").getAttribute("aria-checked")) === "true");
      check("…without the 'migration 066' warning", !(await studio.getByText("migration 066").isVisible().catch(() => false)));
      await option("Collapsed").click();
      check("picking Collapsed selects it", (await option("Collapsed").getAttribute("aria-checked")) === "true");
      const pending = studio.getByText(/^\d+ unpublished changes?$/).first();
      check("…and counts as an unpublished change", await pending.isVisible());
      if (process.env.BI_SHOTS) {
        await startGroup.scrollIntoViewIfNeeded();
        await studio.screenshot({ path: `${process.env.BI_SHOTS}/studio-visitor-tools.png` });
      }
      const frame = studio.locator("#widget-preview-frame iframe");
      await frame.waitFor({ state: "attached", timeout: 20000 });
      await studio
        .waitForFunction(() => document.querySelector("#widget-preview-frame iframe")?.getAttribute("src")?.includes("collapsed=1"), null, { timeout: 5000 })
        .catch(() => {});
      check("the preview carries the unsaved choice", ((await frame.getAttribute("src")) ?? "").includes("collapsed=1"), await frame.getAttribute("src"));
      // The panel's iframe is always mounted and navigates in place when its
      // src changes, so the old document can still be on screen here. Wait
      // for the frame's own location (same origin) to carry the change.
      await studio
        .waitForFunction(
          () => document.querySelector("#widget-preview-frame iframe")?.contentWindow?.location.search.includes("collapsed=1"),
          null,
          { timeout: 20000 }
        )
        .catch(() => {});
      const inner = studio.frameLocator("#widget-preview-frame iframe");
      await inner.getByRole("button", { name: /^Filters/ }).first().waitFor({ timeout: 30000 });
      check(
        "…and the preview starts folded",
        (await inner.getByRole("button", { name: /^Filters/ }).first().getAttribute("aria-expanded")) === "false"
      );
      await studio.getByRole("button", { name: /^Publish( changes)?$/ }).click();
      await pending.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
      const after = await api(`/api/widget-config?orgId=${org.id}`);
      check("publishing saves it", after.body?.config?.filters_collapsed === true, JSON.stringify(after.body?.config?.filters_collapsed));

      // Every filter off: there is no section to fold, so the choice is disabled.
      const filterSwitches = ["Search", "Activity", "Day", "Time of day", "Where", "Who it's for", "Jump to a week"].map(
        (name) => studio.getByRole("switch", { name, exact: true })
      );
      if ((await filterSwitches[0].count()) === 1) {
        for (const s of filterSwitches) if ((await s.getAttribute("aria-checked")) === "true") await s.click();
        check("with every filter off, the choice is disabled", await option("Open").isDisabled());
      } else {
        skipped("disabled with no filters (filter switches not found by role)");
      }
      await staff.close();
    } else {
      skipped("the studio's Visitor tools (needs 066)");
    }

    // ---------------------------------------------------------------
    console.log("\n5. The landing page");
    // ---------------------------------------------------------------
    await page.goto(`${APP}/`, { waitUntil: "networkidle" });
    check("desktop hero: the filter section starts open", (await expanded(page)) === "true");
    await toggleOf(page).click();
    check("…and folds when its toggle is clicked", (await expanded(page)) === "false");
    await toggleOf(page).click();
    check("…and opens again", (await expanded(page)) === "true");
    const startLabel = page.getByText("Filter section starts", { exact: true });
    check("'Your own widget' step 3 offers the setting", await startLabel.isVisible().catch(() => false) || (await startLabel.count()) > 0);
    const collapsedChip = page.getByRole("button", { name: "Collapsed", exact: true });
    await collapsedChip.click();
    check("…and its Collapsed chip can be picked", (await collapsedChip.getAttribute("aria-pressed")) === "true");
    if (process.env.BI_SHOTS) {
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      await toggleOf(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.BI_SHOTS}/hero-desktop.png` });
    }

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${APP}/`, { waitUntil: "networkidle" });
    check("phone hero: the filter section starts folded", (await expanded(phonePage)) === "false");
    await toggleOf(phonePage).click();
    check("…and opens on tap", (await expanded(phonePage)) === "true" && (await searchOf(phonePage).isVisible()));
    if (process.env.BI_SHOTS) await phonePage.screenshot({ path: `${process.env.BI_SHOTS}/hero-phone.png` });
    await phone.close();
    await context.close();
  } finally {
    await browser.close();
  }
} catch (err) {
  check("the run completed without throwing", false, err?.stack ?? String(err));
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: orgsLeft } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const usersLeft = (userList?.users ?? []).filter((u) => u.email?.includes(String(stamp)));
  console.log(`\nTeardown: ${orgsLeft?.length ?? 0} org(s), ${usersLeft.length} user(s) left over`);
  console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}\n`);
  process.exit(fail === 0 ? 0 : 1);
}
