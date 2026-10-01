/**
 * Widget Facility / Department / Schedule menus as tick boxes, and the
 * "let visitors pick several" setting (migration 065).
 *
 * What a pick means lives in src/lib/schedule/scopeSelection.ts: the org's
 * filter entries become a tree of schedules, every menu is "nothing ticked =
 * All …", and the embed asks /api/sessions/expand for exactly the schedules a
 * selection covers (`scheduleGroupId=a,b,c`). This drives that end to end:
 *
 *   1. The endpoint takes a list — and only a list of UUIDs, at most 250. The
 *      single-id request is the positive control for the list one.
 *   2. The setting saves (or, before 065 is applied, a publish still succeeds
 *      without it — the trap the first run of verify-q found).
 *   3. One at a time (the default), signed out: ticks replace, unticking goes
 *      back to All, and "All" never reaches a building the org did not
 *      configure — the reason picks resolve to schedule ids at all.
 *   4. Several at once, through the preview's `multi` override (so it runs
 *      before 065 too): ticks add up, the union is on screen and nothing else
 *      is, and the floorplan asks for one building when two are ticked.
 *   5. With 065 applied, the same from the *saved* setting on a real embed.
 *   6. The studio's Visitor tools section sets it; the preview shows it before publishing.
 *   7. The landing hero builds its menus the same way: a building with one
 *      department lists it unticked under "All departments" — the
 *      inconsistency this work started from.
 *
 * The fixture: building A (Aquatics: Lane swim, Aquafit) and building B
 * (Courts: Pickleball) are configured facility-wide; building C (Outside) is
 * published, live and approved but NOT in the widget's filters. Each schedule
 * has a daily session, so its name is on screen whenever it is in view.
 *
 *   npm run dev
 *   node scripts/verify/verify-bh.mjs [--app=http://localhost:3000] [--headed]
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
let shotPage = null;
let shotN = 0;
function check(label, ok, detail = "") {
  if (!ok && shotPage && process.env.BH_SHOTS) shotPage.screenshot({ path: `${process.env.BH_SHOTS}/fail-${++shotN}.png`, fullPage: true }).catch(() => {});
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

try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture: buildings A and B in the widget, C published but left out");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-bh ${stamp}`, slug: `zz-verify-bh-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-bh-${stamp}@example.invalid`;
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

  const slug = (s) => `zz-bh-${s.toLowerCase().replace(/[^a-z]+/g, "-")}-${stamp}`;
  async function building(label) {
    const { data, error } = await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ ${label} ${stamp}`,
        slug: slug(label),
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(`facility ${label}: ${error.message}`);
    return data;
  }
  async function department(facility, label) {
    const { data, error } = await admin
      .from("departments")
      .insert({ org_id: org.id, facility_id: facility.id, name: `ZZ ${label} ${stamp}`, slug: slug(label), is_published: true })
      .select("id, name")
      .single();
    if (error) throw new Error(`department ${label}: ${error.message}`);
    return data;
  }
  /** A live, published schedule with one daily session and approved weeks. */
  async function schedule(facility, dept, label, hour) {
    const name = `ZZ ${label} ${stamp}`;
    const { data: group, error } = await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: dept.id,
        name,
        slug: slug(label),
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        source: "manual",
      })
      .select("id")
      .single();
    if (error) throw new Error(`schedule ${label}: ${error.message}`);
    const { data: space } = await admin
      .from("spaces")
      .insert({ org_id: org.id, facility_id: facility.id, department_id: dept.id, name: `ZZ ${label} Space ${stamp}`, slug: slug(`${label} space`), is_published: true })
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
        dtstart: `${isoDate(from)}T${String(hour).padStart(2, "0")}:00:00Z`,
        dtend_time: `${String(hour + 1).padStart(2, "0")}:00`,
        space_ids: [space.id],
      }),
    });
    if (created.status >= 300) throw new Error(`${label} session: ${created.status} ${JSON.stringify(created.body)}`);
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
    return { id: group.id, name };
  }

  const A = await building("Pool Building");
  const aquatics = await department(A, "Aquatics");
  const laneSwim = await schedule(A, aquatics, "Lane Swim", 7);
  const aquafit = await schedule(A, aquatics, "Aquafit", 9);
  const B = await building("Gym Building");
  const courts = await department(B, "Courts");
  const pickleball = await schedule(B, courts, "Pickleball", 11);
  const C = await building("Outside Building");
  const outsideDept = await department(C, "Outside Dept");
  const outside = await schedule(C, outsideDept, "Outside Schedule", 13);
  check("fixture built: 3 buildings, 4 live schedules", !!(laneSwim && aquafit && pickleball && outside));

  // ---------------------------------------------------------------
  console.log("\n1. /api/sessions/expand takes a list of schedules");
  // ---------------------------------------------------------------
  const ws = weekStartOf(new Date());
  const range = `rangeStart=${ws.toISOString()}&rangeEnd=${new Date(ws.getTime() + 7 * 86400000 - 1).toISOString()}`;
  const namesIn = (body) => [...new Set((body?.data ?? []).map((s) => s.scheduleGroupName))];
  const one = await api(`/api/sessions/expand?${range}&scheduleGroupId=${laneSwim.id}`);
  check(
    "control: one id returns that schedule only",
    one.status === 200 && JSON.stringify(namesIn(one.body)) === JSON.stringify([laneSwim.name]),
    `${one.status} ${JSON.stringify(namesIn(one.body))}`
  );
  const two = await api(`/api/sessions/expand?${range}&scheduleGroupId=${aquafit.id},${pickleball.id}`);
  const twoNames = namesIn(two.body);
  check(
    "two ids return both schedules, across buildings",
    two.status === 200 && twoNames.includes(aquafit.name) && twoNames.includes(pickleball.name) && twoNames.length === 2,
    `${two.status} ${JSON.stringify(twoNames)}`
  );
  const swapped = await api(`/api/sessions/expand?${range}&scheduleGroupId=${pickleball.id},${aquafit.id},${aquafit.id}`);
  check(
    "order and repeats don't matter",
    swapped.status === 200 && (swapped.body?.data ?? []).length === (two.body?.data ?? []).length
  );
  const bad = await api(`/api/sessions/expand?${range}&scheduleGroupId=${laneSwim.id},not-a-uuid`);
  check("a non-UUID in the list is a 400, not a filter", bad.status === 400, String(bad.status));
  const many = Array.from({ length: 251 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
  const tooMany = await api(`/api/sessions/expand?${range}&scheduleGroupId=${many}`);
  check("251 ids is a 400 (cap 250)", tooMany.status === 400, String(tooMany.status));

  // ---------------------------------------------------------------
  console.log("\n2. The setting: widget_configs.multi_select_levels (migration 065)");
  // ---------------------------------------------------------------
  const { error: colErr } = await admin.from("widget_configs").select("multi_select_levels").limit(0);
  const has065 = !colErr;
  console.log(`  (migration 065 ${has065 ? "is" : "is NOT"} applied)`);

  const base = await api("/api/widget-config", cookie, {
    method: "PATCH",
    body: JSON.stringify({
      allowedTemplates: ["list", "floorplan"],
      scopes: [
        { label: "A", facilityId: A.id },
        { label: "B", facilityId: B.id },
      ],
    }),
  });
  check("the widget's filters are A and B, facility-wide", base.status === 200 && base.body?.scopes?.length === 2, JSON.stringify(base.body).slice(0, 300));
  const got = await api(`/api/widget-config?orgId=${org.id}`);
  check(
    "GET carries the setting exactly when the column exists — the studio's 'can I send it' probe",
    has065 === "multi_select_levels" in (got.body?.config ?? {}),
    JSON.stringify(Object.keys(got.body?.config ?? {}))
  );
  const badLevel = await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ multiSelectLevels: ["building"] }) });
  check("an unknown level is a 400", badLevel.status === 400, String(badLevel.status));

  const withTitle = await api("/api/widget-config", cookie, {
    method: "PATCH",
    body: JSON.stringify({ customTitle: `ZZ Title ${stamp}`, multiSelectLevels: ["schedule"] }),
  });
  check(
    "a publish naming the setting succeeds, and the rest of it is saved",
    withTitle.status === 200 && withTitle.body?.config?.custom_title === `ZZ Title ${stamp}`,
    `${withTitle.status} ${JSON.stringify(withTitle.body).slice(0, 200)}`
  );
  if (has065) {
    check(
      "…with the setting saved",
      JSON.stringify(withTitle.body?.config?.multi_select_levels) === JSON.stringify(["schedule"]),
      JSON.stringify(withTitle.body?.config?.multi_select_levels)
    );
  } else {
    skipped("…with the setting saved (needs 065)");
  }
  // Back to one-at-a-time for section 3.
  if (has065) await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ multiSelectLevels: [] }) });

  // ---------------------------------------------------------------
  console.log("\n3. One at a time, signed out");
  // ---------------------------------------------------------------
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    const page = await context.newPage();
    shotPage = page;
    const expands = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/sessions/expand")) expands.push(decodeURIComponent(r.url()));
    });

    const switcher = page.getByRole("group", { name: "Choose a schedule" });
    const menu = (name) => switcher.getByRole("button", { name, exact: true });
    const list = (name) => page.getByRole("group", { name, exact: true }).locator("label");
    const text = async (name) => ((await menu(name).textContent()) ?? "").replace(/\s+/g, " ");
    // Sessions in the schedule itself — not a row in an open menu, which
    // carries the same name.
    const seen = async (s) =>
      page.getByRole("region", { name: "Schedule" }).getByText(s.name).first().isVisible().catch(() => false);
    // Not waitForLoadState("networkidle"): once the page has loaded, that
    // returns at once, and a pick's fetch is still in flight — which read as
    // missing sessions on the first run. Wait for the widget's own loading
    // line to come and go.
    const settle = async () => {
      await page.waitForTimeout(150);
      await page.getByText("Loading schedule…").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(150);
    };
    const tick = async (menuName, optionName) => {
      if (!(await list(menuName).first().isVisible().catch(() => false))) await menu(menuName).click();
      await page.getByRole("group", { name: menuName, exact: true }).getByRole("checkbox", { name: optionName }).locator("..").click();
      await settle();
    };
    const close = async () => {
      if (await list("Facility").first().isVisible().catch(() => false)) await page.keyboard.press("Escape");
      if (await list("Department").first().isVisible().catch(() => false)) await page.keyboard.press("Escape");
      if (await list("Schedule").first().isVisible().catch(() => false)) await page.keyboard.press("Escape");
    };

    await page.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });
    await page.getByText(laneSwim.name).first().waitFor({ timeout: 20000 }).catch(() => {});
    check(
      "opens on the first entry: building A, All departments, All schedules",
      (await text("Facility")).includes(A.name) &&
        (await text("Department")).includes("All departments") &&
        (await text("Schedule")).includes("All schedules"),
      `${await text("Facility")} | ${await text("Department")} | ${await text("Schedule")}`
    );
    check(
      "A's schedules are on screen, B's is not",
      (await seen(laneSwim)) && (await seen(aquafit)) && !(await seen(pickleball))
    );

    await menu("Department").click();
    const depts = await list("Department").allTextContents();
    check(
      "a building with one department lists it unticked — 'All' is the empty menu, not a row",
      depts.length === 1 && depts[0] === aquatics.name,
      JSON.stringify(depts)
    );
    await page.keyboard.press("Escape");

    await tick("Schedule", laneSwim.name);
    check(
      "ticking Lane Swim narrows to it",
      (await text("Schedule")).includes(laneSwim.name) && (await seen(laneSwim)) && !(await seen(aquafit))
    );
    check(
      "…and the menu closes on the pick (one at a time)",
      !(await list("Schedule").first().isVisible().catch(() => false))
    );
    await tick("Schedule", aquafit.name);
    check(
      "ticking Aquafit replaces it",
      (await text("Schedule")).includes(aquafit.name) && !(await text("Schedule")).includes(laneSwim.name) &&
        (await seen(aquafit)) && !(await seen(laneSwim)),
      await text("Schedule")
    );
    await tick("Schedule", aquafit.name);
    check(
      "unticking the ticked one goes back to All schedules",
      (await text("Schedule")).includes("All schedules") && (await seen(laneSwim)) && (await seen(aquafit)),
      await text("Schedule")
    );

    await tick("Facility", B.name);
    check(
      "ticking building B replaces A — B's schedule on, A's off",
      (await text("Facility")).includes(B.name) && (await seen(pickleball)) && !(await seen(laneSwim))
    );
    expands.length = 0;
    await tick("Facility", B.name);
    check(
      "unticking it is All facilities: A and B together",
      (await text("Facility")).includes("All facilities") && (await seen(pickleball)) && (await seen(laneSwim)) && (await seen(aquafit)),
      await text("Facility")
    );
    check(
      "…and never building C, which the org did not put in the widget",
      !(await seen(outside))
    );
    const last = expands.at(-1) ?? "";
    check(
      "the request names exactly A's and B's schedules — 'All' is bounded by the filters, not the org",
      [laneSwim, aquafit, pickleball].every((s) => last.includes(s.id)) && !last.includes(outside.id) && !last.includes("facilityId="),
      last
    );
    await close();

    // ---------------------------------------------------------------
    console.log("\n4. Several at once — the preview's `multi` override");
    // ---------------------------------------------------------------
    await page.goto(`${APP}/widget/${org.id}?preview=1&templates=list,floorplan&print=1&multi=facility,department,schedule`, {
      waitUntil: "networkidle",
    });
    await page.getByText(laneSwim.name).first().waitFor({ timeout: 20000 }).catch(() => {});
    await tick("Facility", B.name);
    check(
      "ticking B adds it to A — the menu stays open for more",
      (await text("Facility")).includes(A.name) && (await text("Facility")).includes(B.name) &&
        (await list("Facility").first().isVisible()),
      await text("Facility")
    );
    check("both buildings' schedules are on screen", (await seen(laneSwim)) && (await seen(pickleball)));
    await page.keyboard.press("Escape");

    await menu("Department").click();
    const deptDetails = await list("Department").allTextContents();
    check(
      "with two buildings in play, each department says which building it is in",
      deptDetails.some((t) => t.includes(aquatics.name) && t.includes(A.name)) &&
        deptDetails.some((t) => t.includes(courts.name) && t.includes(B.name)),
      JSON.stringify(deptDetails)
    );
    await page.keyboard.press("Escape");

    await tick("Schedule", laneSwim.name);
    await tick("Schedule", pickleball.name);
    check(
      "Lane Swim + Pickleball: the union is on screen, and Aquafit is not",
      (await seen(laneSwim)) && (await seen(pickleball)) && !(await seen(aquafit)),
      await text("Schedule")
    );
    check("the button lists both picks", (await text("Schedule")).includes(laneSwim.name) && (await text("Schedule")).includes(pickleball.name));
    await page.keyboard.press("Escape");
    await page.emulateMedia({ media: "print" });
    const paper = (await page.locator("body").innerText()).split(/\r?\n/).find((l) => l.includes("Schedule:")) ?? "";
    await page.emulateMedia({ media: "screen" });
    check(
      "the printout names what was picked: both buildings and both schedules",
      [A.name, B.name, laneSwim.name, pickleball.name].every((n) => paper.includes(n)) && !paper.includes(aquafit.name),
      paper
    );
    await menu("Schedule").click();
    await page.getByRole("button", { name: "Clear schedule" }).click();
    await settle();
    // Already cached from the B tick, so there is no loading line to wait out.
    await page.getByText(aquafit.name).first().waitFor({ timeout: 5000 }).catch(() => {});
    check(
      "'Clear schedule' goes back to All schedules",
      (await text("Schedule")).includes("All schedules") && (await seen(aquafit)),
      `${await text("Schedule")} | aquafit=${await seen(aquafit)} | lists=${JSON.stringify(await page.locator("[role=group] label").allTextContents())}`
    );
    await close();

    await page.getByRole("button", { name: /floor ?plan/i }).first().click();
    await settle();
    check(
      "the floorplan, with two buildings ticked, asks for one",
      await page.getByText("The floorplan shows one building at a time").isVisible().catch(() => false)
    );
    await tick("Facility", B.name); // untick B → A only
    await close();
    check(
      "…and with one building, it doesn't (positive control)",
      !(await page.getByText("The floorplan shows one building at a time").isVisible().catch(() => false))
    );

    // ---------------------------------------------------------------
    console.log("\n5. The saved setting, on a real embed");
    // ---------------------------------------------------------------
    if (has065) {
      await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ multiSelectLevels: ["schedule"] }) });
      await page.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });
      await page.getByText(laneSwim.name).first().waitFor({ timeout: 20000 }).catch(() => {});
      await tick("Schedule", laneSwim.name);
      await tick("Schedule", aquafit.name);
      check(
        "Schedules set to several: two ticks add up",
        (await text("Schedule")).includes(laneSwim.name) && (await text("Schedule")).includes(aquafit.name),
        await text("Schedule")
      );
      await close();
      await tick("Facility", B.name);
      check(
        "…while Facility, left off, still replaces",
        (await text("Facility")).includes(B.name) && !(await text("Facility")).includes(A.name),
        await text("Facility")
      );
    } else {
      skipped("saved multi_select_levels on a real embed (needs 065)");
      skipped("…Facility left off still replaces (needs 065)");
    }

    // ---------------------------------------------------------------
    console.log("\n6. The studio's Visitor tools sets it, and the preview shows it before publishing");
    // ---------------------------------------------------------------
    if (has065) {
      await api("/api/widget-config", cookie, { method: "PATCH", body: JSON.stringify({ multiSelectLevels: [] }) });
      const staff = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
      const levels = studio.getByRole("group", { name: "Let visitors pick several" });
      const tile = (name) => levels.getByRole("checkbox", { name, exact: true });
      check(
        "Visitor tools offers the three levels, all off for this org",
        !(await tile("Facilities").isChecked()) &&
          !(await tile("Departments").isChecked()) &&
          !(await tile("Schedules").isChecked())
      );
      check(
        "…and not the 'migration 065' warning, since it is applied",
        !(await studio.getByText("migration 065").isVisible().catch(() => false))
      );
      await tile("Schedules").click();
      check("ticking Schedules turns it on", await tile("Schedules").isChecked());
      const pending = studio.getByText(/^\d+ unpublished changes?$/).first();
      check("…and counts as an unpublished change", await pending.isVisible());
      if (process.env.BH_SHOTS) {
        await levels.scrollIntoViewIfNeeded();
        await studio.screenshot({ path: `${process.env.BH_SHOTS}/studio-visitor-tools.png` });
      }
      const frame = studio.locator("#widget-preview-frame iframe");
      await frame.waitFor({ state: "attached", timeout: 20000 });
      // The studio debounces the preview's src by 400 ms (typing in the title
      // would otherwise reload it per keystroke), so wait for it to land.
      await studio
        .waitForFunction(() => document.querySelector("#widget-preview-frame iframe")?.getAttribute("src")?.includes("multi=schedule"), null, { timeout: 5000 })
        .catch(() => {});
      check(
        "the preview carries the unsaved choice",
        ((await frame.getAttribute("src")) ?? "").includes("multi=schedule"),
        await frame.getAttribute("src")
      );
      await studio.getByRole("button", { name: /^Publish( changes)?$/ }).click();
      await pending.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
      const after = await api(`/api/widget-config?orgId=${org.id}`);
      check(
        "publishing saves it",
        JSON.stringify(after.body?.config?.multi_select_levels) === JSON.stringify(["schedule"]),
        JSON.stringify(after.body?.config?.multi_select_levels)
      );
      await staff.close();
    } else {
      skipped("the studio's Visitor tools (needs 065)");
    }

    // ---------------------------------------------------------------
    console.log("\n7. The landing hero builds its menus the same way");
    // ---------------------------------------------------------------
    await page.goto(`${APP}/`, { waitUntil: "networkidle" });
    await menu("Department").waitFor({ timeout: 30000 });
    check(
      "hero opens on a building with All departments, like an embed",
      (await text("Department")).includes("All departments") && (await text("Schedule")).includes("All schedules"),
      `${await text("Department")} | ${await text("Schedule")}`
    );
    await menu("Department").click();
    const heroDepts = await list("Department").allTextContents();
    const heroChecked = await page.getByRole("group", { name: "Department", exact: true }).locator("input:checked").count();
    check(
      "its one department is listed unticked, not forced on",
      heroDepts.length === 1 && heroChecked === 0,
      `${JSON.stringify(heroDepts)} checked=${heroChecked}`
    );
    const heroBox = (menuName, name) =>
      page.getByRole("group", { name: menuName, exact: true }).getByRole("checkbox", { name }).locator("..");
    await heroBox("Department", heroDepts[0]).click();
    check("ticking it names it", (await text("Department")).includes(heroDepts[0]));
    await heroBox("Department", heroDepts[0]).click();
    check("unticking it is All departments again", (await text("Department")).includes("All departments"));
    await page.keyboard.press("Escape");
    await menu("Facility").click();
    const heroFacilities = await list("Facility").allTextContents();
    await heroBox("Facility", heroFacilities[1]).click();
    check(
      "the hero lets you tick several buildings",
      (await text("Facility")).includes(heroFacilities[0]) && (await text("Facility")).includes(heroFacilities[1]),
      await text("Facility")
    );
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
