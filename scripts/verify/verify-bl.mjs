/**
 * One scope, set in one place (2026-10-01, docs/prompts/scope-navigation.md).
 *
 * The building is chosen ONLY in the sidebar's switcher; department is a
 * filter on the pages that have one; a schedule is opened from the list.
 * Pages show scope as a breadcrumb instead of asking again.
 *
 *   1. Owner, 1440px. The switcher names the building; no page renders its
 *      own facility chips. Switching on Schedules navigates to the new
 *      building's list and remembers it — a BARE /dashboard/spaces and
 *      /dashboard/schedule then open in it (the cookie, resolved server-side).
 *      Switching on a schedule's detail drops ?schedule/?department. Switching
 *      on a legacy detail page goes to that page type's list. On an org-wide
 *      page the switcher says so and switching does not navigate. The inbox
 *      count is fetched for the switched-to building.
 *   2. Department filter: Schedules offers All + both departments + "No
 *      department"; picking one filters the list and the breadcrumb follows.
 *      Sessions offers "Facility-wide" + departments and no "All". Spaces
 *      filters what is shown. A building with one department shows no filter.
 *   3. Analytics: no ?facility shows "All facilities" in the switcher (owner),
 *      the toolbar has lost its own facility menu, and picking a building
 *      keeps ?range.
 *   4. Coordinator (one department, one building): no switcher, no department
 *      filter, and a remembered building they cannot read falls through to
 *      their own.
 *   5. Collapsed sidebar: the switcher is a building icon opening the same list.
 *   6. Phone, 390px: the Menu sheet has the switcher at the top, 44px tall.
 *   7. Palettes stay apart: the app's lists use tokens and no hex; the public
 *      widget's filter list still uses its hexes and no tokens.
 *
 * Screenshots (light + dark, 1440 + 390) land in scripts/verify/out/bl/.
 *
 * FALSIFY: in schedule/page.tsx pass `null` instead of rememberedFacilityId()
 * — "a bare /dashboard/schedule opens the remembered building" goes red. In
 * SidebarNav drop `offerAll` — the analytics "All facilities" check goes red.
 *
 *   npm run dev
 *   node scripts/verify/verify-bl.mjs [--app=http://localhost:3000] [--headed]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const OUT = path.resolve("scripts/verify/out/bl");
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
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
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

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function makeUser(orgId, role, label, departmentId = null) {
  const email = `zz-bl-${label}-${stamp}@example.invalid`;
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
  if (departmentId) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert({ membership_id: membership.id, org_id: orgId, department_id: departmentId });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn ${label}: ${signInErr.message}`);
  return { userId: data.user.id, cookieParts: cookieParts(signIn.session) };
}

async function insert(table, row) {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}

const facilityRow = (orgId, label) => ({
  org_id: orgId,
  name: `ZZ ${label} ${stamp}`,
  slug: `zz-bl-${label.toLowerCase()}-${stamp}`,
  address_line1: "1 Test St",
  city: "Victoria",
  province: "BC",
  postal_code: "V0V 0V0",
  is_published: true,
});

const groupRow = (orgId, facilityId, departmentId, label) => ({
  org_id: orgId,
  facility_id: facilityId,
  department_id: departmentId,
  name: `ZZ ${label} ${stamp}`,
  slug: `zz-bl-${label.toLowerCase()}-${stamp}`,
  sport_category: "swimming",
  activity_type: "drop_in",
  status: "published",
  source: "manual",
  starts_on: "2026-01-01",
});

async function newPage(browser, user, viewport, extraCookies = []) {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
  await ctx.addCookies([
    ...user.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false })),
    ...extraCookies.map((c) => ({ ...c, url: APP })),
  ]);
  const page = await ctx.newPage();
  return { ctx, page };
}

const crumbs = (page) => page.getByRole("navigation", { name: "Breadcrumb" }).first().innerText().then((t) => t.replace(/\s+/g, " ").trim());
const facilityCookie = async (ctx) => (await ctx.cookies(APP)).find((c) => c.name === "dropin-facility")?.value ?? null;
const LIST = (name) => `[role="radiogroup"][aria-label="${name}"], [role="group"][aria-label="${name}"]`;
/** The drawn tick box's shape — everything but its colours. */
const BOX_SHAPE = "flex size-4 shrink-0 items-center justify-center rounded border transition-colors";
const query = (page) => new URL(page.url()).searchParams;

async function go(page, url) {
  await page.goto(`${APP}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function main() {
  // ── Fixtures ──────────────────────────────────────────────────────────────
  const orgId = await insert("organizations", { name: `ZZ Scope ${stamp}`, slug: `zz-scope-${stamp}`, status: "active" });
  ids.orgs.push(orgId);

  const A = await insert("facilities", facilityRow(orgId, "Alpha"));
  const B = await insert("facilities", facilityRow(orgId, "Bravo"));
  const nameA = `ZZ Alpha ${stamp}`;
  const nameB = `ZZ Bravo ${stamp}`;
  const dept = (facilityId, name, order) =>
    insert("departments", { org_id: orgId, facility_id: facilityId, name, slug: `zz-bl-${name.toLowerCase()}-${stamp}`, display_order: order, is_published: true });
  const A1 = await dept(A, "Aquatics", 0);
  const A2 = await dept(A, "Fitness", 1);
  const B1 = await dept(B, "Arena", 0);

  const swim = await insert("schedule_groups", groupRow(orgId, A, A1, "Swim"));
  await insert("schedule_groups", groupRow(orgId, A, A2, "Gym"));
  await insert("schedule_groups", groupRow(orgId, A, null, "Pickle"));
  const skateB = await insert("schedule_groups", groupRow(orgId, B, B1, "Skate"));
  void skateB;
  const space = (departmentId, label) =>
    insert("spaces", { org_id: orgId, facility_id: A, department_id: departmentId, name: `ZZ ${label} ${stamp}`, slug: `zz-bl-${label.toLowerCase()}-${stamp}`, is_published: true });
  await space(A1, "Lane");
  await space(A2, "Weights");
  await space(null, "Lobby");

  const owner = await makeUser(orgId, "owner", "owner");
  const coord = await makeUser(orgId, "coordinator", "coord", A1);

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    // ── 1. Owner, desktop ───────────────────────────────────────────────────
    console.log("\n  1. Owner — switcher, remembering, detail pages, org-wide pages");
    const { ctx, page } = await newPage(browser, owner, { width: 1440, height: 900 });
    const needsRequests = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/overview/needs")) needsRequests.push(r.url());
    });
    const aside = page.locator("aside");
    const switcher = aside.getByRole("button", { name: /^Facility / });

    await go(page, `/dashboard/schedule?facility=${A}`);
    await switcher.waitFor({ timeout: 30_000 });
    check("the sidebar switcher names the building", (await switcher.innerText()).includes(nameA), await switcher.innerText());
    check("no facility chips on the page", (await page.locator("main nav[aria-label='Facility']").count()) === 0);
    check("the breadcrumb names the building", (await crumbs(page)).includes(nameA), await crumbs(page));
    check("the old sidebar Department/Schedule dropdowns are gone", (await aside.getByText("All schedules").count()) === 0);
    await page.screenshot({ path: `${OUT}/schedule-1440-light.png` });

    await switcher.click();
    const list = aside.locator(LIST("Facility"));
    await list.waitFor();
    const listText = (await list.innerText()).replace(/\s+/g, " ");
    check("the list shows each building with its counts", listText.includes(nameB) && listText.includes("2 departments · 3 schedules"), listText);
    check("no 'All facilities' outside Overview/Analytics", !listText.includes("All facilities"));
    await page.screenshot({ path: `${OUT}/switcher-open-1440-light.png` });

    await list.locator("label").filter({ hasText: new RegExp(nameB) }).click();
    await page.waitForURL((u) => u.searchParams.get("facility") === B, { timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    check("switching navigates the page to the new building", query(page).get("facility") === B, page.url());
    check("...and the breadcrumb follows", (await crumbs(page)).includes(nameB), await crumbs(page));
    check("...and it is remembered", (await facilityCookie(ctx)) === B, String(await facilityCookie(ctx)));
    check("a building with one department shows no department filter", (await page.locator("main").getByRole("button", { name: /^Department / }).count()) === 0);
    await page.waitForTimeout(500);
    check("the inbox count is fetched for the new building", needsRequests.some((u) => u.includes(`facility=${B}`)), needsRequests.join(", "));

    await go(page, "/dashboard/spaces");
    check("a bare /dashboard/spaces opens the remembered building", (await crumbs(page)).includes(nameB), await crumbs(page));
    await go(page, "/dashboard/schedule");
    check("a bare /dashboard/schedule opens the remembered building", (await crumbs(page)).includes(nameB), await crumbs(page));

    // ── 2. Department filter ────────────────────────────────────────────────
    console.log("\n  2. Department filter");
    await go(page, `/dashboard/schedule?facility=${A}`);
    const deptButton = page.locator("main").getByRole("button", { name: /^Department / });
    await deptButton.waitFor({ timeout: 15_000 });
    check("Schedules: the filter reads 'All departments'", (await deptButton.innerText()).includes("All departments"));
    await deptButton.click();
    const deptList = page.locator("main").locator(LIST("Department"));
    const deptText = (await deptList.innerText()).replace(/\s+/g, " ");
    check("...offering both departments and 'No department' as tick boxes", ["Aquatics", "Fitness", "No department"].every((t) => deptText.includes(t)) && (await deptList.locator("input[type=checkbox]").count()) === 3, deptText);
    check("...with no 'All' row — nothing ticked is All, as in the widget", !deptText.includes("All departments"));
    await page.screenshot({ path: `${OUT}/department-open-1440-light.png` });
    await deptList.locator("label").filter({ hasText: "Aquatics" }).click();
    await page.waitForURL((u) => u.searchParams.get("department") === A1, { timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const main = page.locator("main");
    check("...and the field names the pick", (await deptButton.innerText()).includes("Aquatics"), await deptButton.innerText());
    check("picking a department filters the list", (await main.getByText(`ZZ Swim ${stamp}`).count()) > 0 && (await main.getByText(`ZZ Gym ${stamp}`).count()) === 0);
    check("...and the breadcrumb reads Facility › Department", (await crumbs(page)).includes(`${nameA} Aquatics`) || /Alpha.*Aquatics/.test(await crumbs(page)), await crumbs(page));

    // Open the schedule, then switch building from its detail.
    await go(page, `/dashboard/schedule?facility=${A}&department=${A1}&schedule=${swim}`);
    const detailCrumbs = await crumbs(page);
    check("an open schedule's breadcrumb is Facility › Department › Schedule", /Alpha.*Aquatics.*Swim/.test(detailCrumbs), detailCrumbs);
    check("no department filter while a schedule is open", (await page.locator("main").getByRole("button", { name: /^Department / }).count()) === 0);
    await switcher.click();
    await aside.locator(LIST("Facility")).locator("label").filter({ hasText: new RegExp(nameB) }).click();
    await page.waitForURL((u) => u.searchParams.get("facility") === B, { timeout: 15_000 }).catch(() => {});
    check("switching on a schedule goes to the new building's list", query(page).get("facility") === B && !query(page).get("schedule") && !query(page).get("department"), page.url());

    await go(page, `/dashboard/sessions?facility=${A}`);
    const sessionsDept = page.locator("main").getByRole("button", { name: /^Department / });
    await sessionsDept.waitFor({ timeout: 15_000 });
    await sessionsDept.click();
    const sessionsText = (await page.locator("main").locator(LIST("Department")).innerText()).replace(/\s+/g, " ");
    check("Sessions: 'Facility-wide' and departments, no 'All'", sessionsText.includes("Facility-wide") && sessionsText.includes("Fitness") && !sessionsText.includes("All departments"), sessionsText);
    await page.keyboard.press("Escape");

    await go(page, `/dashboard/spaces?facility=${A}&department=${A2}`);
    check("Spaces: the filter shows only that department's spaces", (await main.getByText(`ZZ Weights ${stamp}`).count()) > 0 && (await main.getByText(`ZZ Lane ${stamp}`).count()) === 0);

    // A legacy detail page goes to the list of its kind.
    await go(page, `/dashboard/facilities/${A}/departments/${A1}/edit`);
    await switcher.waitFor({ timeout: 15_000 });
    await switcher.click();
    await aside.locator(LIST("Facility")).locator("label").filter({ hasText: new RegExp(nameB) }).click();
    await page.waitForURL((u) => u.pathname === "/dashboard/departments", { timeout: 15_000 }).catch(() => {});
    check("switching on a department's edit page goes to Departments in the new building", new URL(page.url()).pathname === "/dashboard/departments" && query(page).get("facility") === B, page.url());

    // Org-wide page: says so, does not navigate.
    await go(page, "/dashboard/settings");
    await switcher.waitFor({ timeout: 15_000 });
    check("an org-wide page says the switcher does not apply", (await aside.getByText("This page covers every facility.").count()) > 0);
    await switcher.click();
    await aside.locator(LIST("Facility")).locator("label").filter({ hasText: new RegExp(nameA) }).click();
    await page.waitForTimeout(800);
    check("...switching there does not navigate", new URL(page.url()).pathname === "/dashboard/settings", page.url());
    check("...but is remembered", (await facilityCookie(ctx)) === A, String(await facilityCookie(ctx)));

    // ── 3. Analytics ────────────────────────────────────────────────────────
    console.log("\n  3. Analytics");
    await go(page, "/dashboard/analytics?range=30d");
    await switcher.waitFor({ timeout: 15_000 });
    check("no ?facility shows 'All facilities' in the switcher", (await switcher.innerText()).includes("All facilities"), await switcher.innerText());
    check("the toolbar has no facility menu of its own", (await page.locator("main").getByRole("button", { name: /All facilities/ }).count()) === 0);
    await switcher.click();
    await aside.locator(LIST("Facility")).locator("label").filter({ hasText: new RegExp(nameA) }).click();
    await page.waitForURL((u) => u.searchParams.get("facility") === A, { timeout: 15_000 }).catch(() => {});
    check("picking a building keeps the period", query(page).get("facility") === A && query(page).get("range") === "30d", page.url());

    // ── 5. Collapsed sidebar ────────────────────────────────────────────────
    console.log("\n  5. Collapsed sidebar");
    await go(page, `/dashboard/schedule?facility=${A}`);
    await aside.getByRole("button", { name: "Collapse sidebar" }).click();
    const icon = aside.getByRole("button", { name: new RegExp(`^Facility: ${nameA}`) });
    await icon.waitFor({ timeout: 10_000 });
    await icon.click();
    check("the collapsed switcher opens the same list", await aside.locator(LIST("Facility")).isVisible());
    await page.screenshot({ path: `${OUT}/collapsed-open-1440-light.png` });
    await page.keyboard.press("Escape");
    await aside.getByRole("button", { name: "Expand sidebar" }).click();

    // ── 7. Palettes ─────────────────────────────────────────────────────────
    console.log("\n  7. Palettes stay apart");
    await switcher.click();
    const appPanel = await aside.locator(LIST("Facility")).getAttribute("class");
    check("the app's list uses tokens and no hex", appPanel.includes("bg-card") && !/#[0-9a-f]{3,6}/i.test(appPanel), appPanel);
    const appBox = await aside.locator(LIST("Facility")).locator("span[aria-hidden]").first().getAttribute("class");
    check("the app's tick box is the widget's square box", appBox.startsWith(BOX_SHAPE), appBox);
    await page.keyboard.press("Escape");

    // Dark screenshots.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => localStorage.removeItem("dropin-theme"));
    await go(page, `/dashboard/schedule?facility=${A}`);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await switcher.click();
    await page.screenshot({ path: `${OUT}/switcher-open-1440-dark.png` });
    await page.keyboard.press("Escape");
    await ctx.close();

    const pub = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pub.goto(`${APP}/facility/panorama-recreation-centre`, { waitUntil: "networkidle" }).catch(() => {});
    const filters = pub.locator("button:has-text('Filters')").first();
    if (await filters.count()) {
      if ((await filters.getAttribute("aria-expanded")) === "false") await filters.click();
      const dd = pub.locator("button[aria-controls$='-options']").first();
      await dd.click();
      const widgetPanel = await pub.locator("[id$='-options']").first().getAttribute("class");
      const widgetBox = await pub.locator("[id$='-options'] span[aria-hidden]").first().getAttribute("class");
      check("the widget's tick box has the same shape", widgetBox.startsWith(BOX_SHAPE), widgetBox);
      check("the widget's list still uses its hexes and no app tokens", widgetPanel.includes("#e4e4e7") && !/\bbg-card\b|\bborder-input\b/.test(widgetPanel), widgetPanel);
    } else {
      check("the widget's filter bar rendered on the public page", false, "no Filters toggle on /facility/panorama-recreation-centre");
    }
    await pub.close();

    // ── 4. Coordinator ──────────────────────────────────────────────────────
    console.log("\n  4. Coordinator — one department, one building");
    const c = await newPage(browser, coord, { width: 1440, height: 900 }, [{ name: "dropin-facility", value: B }]);
    await go(c.page, "/dashboard/schedule");
    await c.page.waitForTimeout(1500);
    check("no switcher for a one-building coordinator", (await c.page.locator("aside").getByRole("button", { name: /^Facility / }).count()) === 0);
    check("a remembered building they cannot read falls through to their own", (await crumbs(c.page)).includes(nameA), await crumbs(c.page));
    check("no department filter for a one-department coordinator", (await c.page.locator("main").getByRole("button", { name: /^Department / }).count()) === 0);
    await go(c.page, "/dashboard/spaces");
    check("Spaces does the same", (await crumbs(c.page)).includes(nameA), await crumbs(c.page));
    await c.ctx.close();

    // ── 6. Phone ────────────────────────────────────────────────────────────
    console.log("\n  6. Phone, 390px");
    const m = await newPage(browser, owner, { width: 390, height: 844 });
    await go(m.page, `/dashboard/schedule?facility=${A}`);
    await m.page.screenshot({ path: `${OUT}/schedule-390-light.png`, fullPage: false });
    const deptPhone = m.page.locator("main").getByRole("button", { name: /^Department / });
    const deptBox = await deptPhone.boundingBox();
    check("the department filter is at least 44px tall on a phone", (deptBox?.height ?? 0) >= 44, String(deptBox?.height));
    // dispatchEvent: in dev the TanStack devtools badge sits over this tab.
    await m.page.getByRole("button", { name: "Menu" }).dispatchEvent("click");
    const sheet = m.page.getByRole("dialog");
    const phoneSwitcher = sheet.getByRole("button", { name: /^Facility / });
    await phoneSwitcher.waitFor({ timeout: 10_000 });
    const box = await phoneSwitcher.boundingBox();
    check("the Menu sheet has the switcher, at least 44px tall", (box?.height ?? 0) >= 44, String(box?.height));
    await phoneSwitcher.click();
    await m.page.screenshot({ path: `${OUT}/sheet-switcher-390-light.png` });
    const scrollW = await m.page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
    await m.ctx.close();
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    fail++;
    console.error(e);
  })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
