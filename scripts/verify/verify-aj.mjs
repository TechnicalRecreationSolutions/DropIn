/**
 * Space zones + display order (migration 054), driven in a real browser.
 *
 * Two questions:
 *   1. Does reordering on the Spaces page change the order the SESSION EDITOR
 *      shows? That is the actual complaint — lanes arriving scrambled when
 *      building a session.
 *   2. Do zone labels group the page without touching anything bookable?
 *
 * The zone half SKIPS (does not fail) until 054 is applied, since zone_name is
 * the only part that needs DDL.
 *
 *   npm run dev
 *   node scripts/verify/verify-aj.mjs [--headed] [--out=dir]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = "http://localhost:3000";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";

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

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

function cookieParts(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) out.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  return out;
}

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function main() {
  // Is migration 054 applied?
  const { error: probeErr } = await admin.from("spaces").select("zone_name").limit(1);
  const hasZones = !probeErr;
  console.log(hasZones ? "  migration 054: applied\n" : "  migration 054: NOT applied — zone assertions will skip\n");

  const { data: org } = await admin.from("organizations")
    .insert({ name: `ZZ zones ${stamp}`, slug: `zz-zones-${stamp}`, status: "active" }).select("id").single();
  ids.orgs.push(org.id);

  const email = `zz-zones-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });

  const { data: facility } = await admin.from("facilities").insert({
    org_id: org.id, name: `ZZ Commonwealth ${stamp}`, slug: `zz-cw-${stamp}`,
    address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id").single();

  const { data: aquatics } = await admin.from("departments").insert({
    org_id: org.id, facility_id: facility.id, name: "Aquatics",
    slug: `zz-aq-${stamp}`, display_order: 0, is_published: true,
  }).select("id").single();

  /**
   * Every space at display_order 0 — the exact production state the complaint
   * came from (23 rows, all 0). Insert order is deliberately scrambled so a
   * passing "in order" result cannot come from insertion luck.
   */
  const laneNames = ["Lane 1", "Lane 2", "Lane 3", "Lane 4", "Lane 5", "Lane 6", "Lane 7", "Lane 8"];
  const scrambled = ["Lane 5", "Lane 1", "Lane 8", "Lane 3", "Lane 6", "Lane 2", "Lane 7", "Lane 4"];
  for (const name of scrambled) {
    const row = {
      org_id: org.id, facility_id: facility.id, department_id: aquatics.id,
      name, slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      display_order: 0, is_published: true,
    };
    if (hasZones) row.zone_name = "Main Pool";
    await admin.from("spaces").insert(row);
  }
  // A second zone + a zone-less space in the same department.
  for (const [name, zone] of [["Leisure Area", "Leisure Pool"], ["Hot Tub", null]]) {
    const row = {
      org_id: org.id, facility_id: facility.id, department_id: aquatics.id,
      name, slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      display_order: 0, is_published: true,
    };
    if (hasZones) row.zone_name = zone;
    await admin.from("spaces").insert(row);
  }

  const { data: scheduleGroup } = await admin.from("schedule_groups").insert({
    org_id: org.id, facility_id: facility.id, department_id: aquatics.id,
    name: `ZZ Lap Swim ${stamp}`, slug: `zz-lap-${stamp}`,
    sport_category: "swimming", activity_type: "drop_in", status: "published", source: "manual",
  }).select("id").single();

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addCookies(cookieParts(signIn.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
  const page = await context.newPage();

  /** The lane chips in the session editor, in the order it renders them. */
  async function editorLaneOrder() {
    await page.goto(`${APP}/dashboard/schedule/sessions/new?scheduleGroupId=${scheduleGroup.id}`, { waitUntil: "networkidle" });
    const labels = await page.locator("button[aria-pressed]").allInnerTexts();
    return labels.map((t) => t.trim()).filter((t) => laneNames.includes(t));
  }

  /** The lane chips on the Spaces page, in render order. */
  async function pageLaneOrder() {
    const labels = await page.locator('a[href$="/edit"][aria-label^="Edit "]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label").replace(/^Edit /, ""))
    );
    return labels.filter((t) => laneNames.includes(t));
  }

  try {
    // --- Baseline: all display_order 0, so the order is heap order ----------
    const before = await editorLaneOrder();
    check("session editor lists all 8 lanes", before.length === 8, before.join(", "));

    await page.goto(`${APP}/dashboard/spaces?facility=${facility.id}`, { waitUntil: "networkidle" });

    if (hasZones) {
      const body = await page.locator("body").innerText();
      check("zone heading groups the lanes", /Main Pool/.test(body));
      check("a second zone renders separately", /Leisure Pool/.test(body));
      check("a zone-less space is labelled, not hidden", /Not in a zone/.test(body) && /Hot Tub/.test(body));
      check("zones nest inside the department, not beside it",
        (await page.locator("section:has(h2:text-is('Aquatics')) h3").allInnerTexts()).some((t) => t.includes("Main Pool")));
    } else {
      skipped("zone grouping", "migration 054 not applied");
      skipped("second zone renders separately", "migration 054 not applied");
      skipped("zone-less bucket labelled", "migration 054 not applied");
      skipped("zones nest inside the department", "migration 054 not applied");
    }

    // --- Reorder: drive the real buttons ------------------------------------
    const startOrder = await pageLaneOrder();
    check("spaces page shows all 8 lanes", startOrder.length === 8, startOrder.join(", "));

    /**
     * Sort the lanes into 1..8 using only the UI.
     *
     * Each step waits for the DOM to actually show the move rather than
     * sleeping a fixed amount — a fixed pause here is what let an earlier run
     * click into a list that was still being re-rendered, and it hid a real
     * race in the page (a router.refresh() landing on top of the next click).
     * Moves in whichever direction is needed, so a wrong assumption about where
     * a lane starts fails as a timeout on the assertion, not on a disabled
     * button.
     */
    for (let target = 0; target < laneNames.length; target++) {
      for (let guard = 0; guard < 16; guard++) {
        const current = await pageLaneOrder();
        const at = current.indexOf(laneNames[target]);
        if (at === target || at < 0) break;
        const direction = at > target ? "up" : "down";
        const button = page.locator(`button[aria-label="Move ${laneNames[target]} ${direction}"]`).first();
        if (!(await button.isEnabled())) break;
        await button.click();
        const expected = at + (direction === "up" ? -1 : 1);
        await page
          .locator(`a[aria-label="Edit ${laneNames[target]}"]`)
          .first()
          .waitFor({ state: "attached" });
        await page.waitForFunction(
          ([name, index]) => {
            const labels = [...document.querySelectorAll('a[aria-label^="Edit Lane "]')].map((e) =>
              e.getAttribute("aria-label").replace(/^Edit /, "")
            );
            return labels.indexOf(name) === index;
          },
          [laneNames[target], expected],
          { timeout: 5000 }
        );
      }
    }
    const sorted = await pageLaneOrder();
    check("reorder buttons sort the lanes 1-8", sorted.join(",") === laneNames.join(","), sorted.join(", "));

    // The last move is still being written when the sort loop ends — the loop
    // waits on the optimistic DOM, not the request. Reloading through that
    // window is how a user loses their last click, so wait for the page to say
    // it has finished rather than sleeping.
    await page.locator('[data-saving="false"]').first().waitFor({ timeout: 10000 });

    await page.reload({ waitUntil: "networkidle" });
    const afterReload = await pageLaneOrder();
    check("the new order survives a reload", afterReload.join(",") === laneNames.join(","), afterReload.join(", "));

    // THE ASK: does the session editor now agree with the Spaces page?
    const after = await editorLaneOrder();
    check("session editor order matches the Spaces page", after.join(",") === laneNames.join(","), after.join(", "));
    check("positive control: it was NOT already in that order", before.join(",") !== laneNames.join(","), `before: ${before.join(", ")}`);

    // display_order actually written, not just re-sorted client-side.
    const { data: rows } = await admin.from("spaces").select("name, display_order")
      .eq("facility_id", facility.id).order("display_order", { ascending: true });
    const distinct = new Set(rows.map((r) => r.display_order));
    check("display_order is distinct per space, not all 0", distinct.size === rows.length, [...distinct].join(","));

    // Nothing bookable was touched.
    const { data: sessionSpaces } = await admin.from("session_spaces").select("space_id").eq("org_id", org.id);
    check("zones create no session_spaces rows", (sessionSpaces ?? []).length === 0);

    await page.goto(`${APP}/dashboard/spaces?facility=${facility.id}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, "zones-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
    await page.screenshot({ path: path.join(OUT, "zones-mobile.png"), fullPage: true });
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
