/**
 * The widget studio's locked Floorplan card, in a real browser.
 *
 * The card used to say "pick it in step 4 and publish its map" in every case —
 * and step 4's building picker only renders for orgs with 2+ buildings, so a
 * one-building org could never turn Floorplan on at all. Checks:
 *
 *   1. One building, no map      → "has no map yet" + a link to draw it
 *   2. One building, draft map   → "still a draft" + a link to publish it
 *   3. One building, published   → the card unlocks with no step 4 choice, and
 *                                  the unscoped embed actually renders the map
 *   4. Two buildings             → "choose which in step 4"; the card's button
 *                                  lands focus on step 4's picker; picking the
 *                                  mapped building unlocks it
 *   5. Negative control: a two-building org's unscoped embed with no
 *      switcher still does NOT offer Floorplan (there is no one map to show).
 *   6. Two buildings in the step 1 switcher, one map published and one a
 *      draft → the card unlocks ("1 of 2 building maps ready") and links the
 *      draft; the live embed offers Floorplan and the map follows the
 *      visitor's switcher pick.
 *
 *   npm run dev
 *   node scripts/verify/verify-ao.mjs [--headed] [--out=dir]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
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

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

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

async function makeOrg(tag, buildingCount) {
  const { data: org, error } = await admin.from("organizations")
    .insert({ name: `ZZ ${tag} ${stamp}`, slug: `zz-${tag}-${stamp}`, status: "active" }).select("id").single();
  if (error) throw new Error(`org: ${error.message}`);
  ids.orgs.push(org.id);
  const email = `zz-${tag}-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(u.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: u.user.id, role: "owner" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  const buildings = [];
  for (let i = 1; i <= buildingCount; i++) {
    const { data: f } = await admin.from("facilities").insert({
      org_id: org.id, name: `ZZ Building ${i} ${stamp}`, slug: `zz-${tag}-b${i}-${stamp}`,
      address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
    }).select("id, name").single();
    buildings.push(f);
  }
  return { org, signIn, buildings, userId: u.user.id };
}

const pad = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function weekStartIso(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/**
 * One session today in the given space. Needed because every schedule view —
 * floorplan included — shows "No drop-in sessions scheduled this week" instead
 * of rendering when the week is empty (WidgetScheduleClient), so an embed with
 * no sessions never reaches the map at all.
 */
async function addSessionToday({ org, signIn, userId }, facility, spaceId) {
  const { data: group } = await admin.from("schedule_groups").insert({
    org_id: org.id, facility_id: facility.id, name: `ZZ Open Gym ${stamp}`,
    slug: `zz-open-gym-${facility.id.slice(0, 8)}-${stamp}`,
    sport_category: "basketball", activity_type: "drop_in", status: "published", source: "manual",
  }).select("id").single();
  const today = new Date();
  const res = await fetch(`${APP}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieParts(signIn.session).map((c) => `${c.name}=${c.value}`).join("; "),
    },
    body: JSON.stringify({
      schedule_group_id: group.id,
      rrule: `FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][today.getDay()]}`,
      valid_from: localIso(today), valid_until: null,
      dtstart: `${localIso(today)}T10:00:00Z`, dtend_time: "11:00",
      space_ids: [spaceId],
    }),
  });
  if (res.status >= 300) throw new Error(`session: ${res.status} ${await res.text()}`);
  await admin.from("schedule_week_reviews").insert({
    org_id: org.id, schedule_group_id: group.id, week_start: weekStartIso(today),
    status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString(),
  });
}

async function addMap(org, facility, published) {
  const { data: map } = await admin.from("facility_maps").insert({
    org_id: org.id, facility_id: facility.id, canvas_width: 25, canvas_height: 15, is_published: published,
  }).select("id").single();
  const { data: space } = await admin.from("spaces").insert({
    org_id: org.id, facility_id: facility.id, name: "Main Gym", slug: `zz-gym-${facility.id.slice(0, 8)}`,
    display_order: 1, is_published: true,
  }).select("id").single();
  await admin.from("space_hotspots").insert({
    org_id: org.id, facility_map_id: map.id, space_id: space.id,
    x: 0.1, y: 0.1, width: 0.5, height: 0.5, rotation: 0, preset_key: "gym-floor", label: null,
  });
  return { map, space };
}

async function studio(browser, signIn, expectText = null) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await context.addCookies(cookieParts(signIn.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
  const page = await context.newPage();
  await page.goto(`${APP}/dashboard/widget`, { waitUntil: "load" });
  const card = page.locator("div.relative.flex.flex-col", { has: page.getByText("Floorplan", { exact: true }) }).first();
  await card.waitFor({ timeout: 30000 });
  // The map lookup is async: wait until the card stops saying "Checking".
  // The map lookups and the saved switcher list both load after the page, so
  // wait for the state under test rather than for any one request.
  await page.waitForFunction(
    (t) => !document.body.innerText.includes("Checking maps") && (!t || document.body.innerText.includes(t)),
    expectText,
    { timeout: 20000 }
  ).catch(() => {});
  const toggle = card.locator("button[aria-pressed]");
  return { context, page, card, toggle };
}

async function main() {
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  try {
    // ---- 1-3: one building ------------------------------------------------
    const one = await makeOrg("wf1", 1);
    const [only] = one.buildings;

    console.log("\n1. One building, no map");
    {
      const { context, card, toggle } = await studio(browser, one.signIn, "has no map yet");
      const text = await card.innerText();
      check("says the building has no map", text.includes(`${only.name} has no map yet`), text);
      check("no longer points at a step 4 picker that isn't there", !/step 4/i.test(text), text);
      const href = await card.getByRole("link", { name: /Draw its map/ }).getAttribute("href");
      check("links to that building's map editor", href === `/dashboard/map?facility=${only.id}`, href);
      check("card stays locked", await toggle.isDisabled());
      await context.close();
    }

    console.log("\n2. One building, draft map");
    const { map, space: gym } = await addMap(one.org, only, false);
    {
      const { context, card, toggle } = await studio(browser, one.signIn, "still a draft");
      const text = await card.innerText();
      check("says the map is a draft", text.includes(`${only.name}'s map is still a draft`), text);
      check("offers to publish it", (await card.getByRole("link", { name: /Publish its map/ }).count()) === 1);
      check("card stays locked", await toggle.isDisabled());
      await context.close();
    }

    console.log("\n3. One building, published map");
    await admin.from("facility_maps").update({ is_published: true }).eq("id", map.id);
    {
      const { context, page, card, toggle } = await studio(browser, one.signIn, "A picture of your facility");
      check("card unlocks without any step 4 choice", await toggle.isEnabled(), await card.innerText());
      await toggle.click();
      check("Floorplan can be switched on", (await toggle.getAttribute("aria-pressed")) === "true");
      await page.screenshot({ path: path.join(OUT, "verify-ao-single.png") });
      await context.close();
    }
    await addSessionToday(one, only, gym.id);
    {
      // The unscoped embed — what a one-building org pastes — must render the map.
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${APP}/widget/${one.org.id}?preview=1&templates=floorplan`, { waitUntil: "load" });
      const svg = page.locator('svg[aria-label="Facility map"]');
      await svg.waitFor({ timeout: 30000 }).catch(() => {});
      check("the unscoped embed renders the floorplan", await svg.isVisible());
      check("…drawing that building's space", (await svg.innerHTML()).includes("Main Gym"));
      await context.close();
    }

    // ---- 4-5: two buildings ----------------------------------------------
    console.log("\n4. Two buildings");
    const two = await makeOrg("wf2", 2);
    const [, second] = two.buildings;
    await addMap(two.org, second, true);
    {
      const { context, page, card, toggle } = await studio(browser, two.signIn);
      const text = await card.innerText();
      check("asks for buildings: switcher or step 4", text.includes("add your buildings to the switcher in step 1, or pick one in step 4"), text);
      check("offers to add every building to the switcher", (await card.getByRole("button", { name: /Add each building to the switcher/ }).count()) === 1);
      check("card is locked until a building is known", await toggle.isDisabled());
      await card.getByRole("button", { name: /Or pick one in step 4/ }).click();
      await page.waitForTimeout(600);
      const focused = await page.evaluate(() => document.activeElement?.id);
      check("'Choose a building' lands on step 4's picker", focused === "widget-scope-facility", focused);
      await page.selectOption("#widget-scope-facility", second.id);
      await page.waitForFunction(() => !document.body.innerText.includes("Checking maps"), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(300);
      check("picking the mapped building unlocks the card", await toggle.isEnabled(), await card.innerText());
      await context.close();
    }

    console.log("\n5. Negative control");
    {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${APP}/widget/${two.org.id}?preview=1&templates=grid,floorplan`, { waitUntil: "load" });
      await page.waitForTimeout(3000);
      const svgCount = await page.locator('svg[aria-label="Facility map"]').count();
      const offered = await page.getByRole("button", { name: /^Floorplan$/ }).count();
      check("a two-building unscoped embed does not offer Floorplan", svgCount === 0 && offered === 0, `svg ${svgCount}, button ${offered}`);
      await context.close();
    }

    console.log("\n6. Two buildings in the switcher (one map published, one draft)");
    {
      const [first] = two.buildings;
      const { space: firstGym } = await addMap(two.org, first, false);
      const { data: secondGym } = await admin.from("spaces").select("id").eq("facility_id", second.id).single();
      await addSessionToday(two, first, firstGym.id);
      await addSessionToday(two, second, secondGym.id);

      const { data: config, error: cfgErr } = await admin.from("widget_configs")
        .insert({ org_id: two.org.id, allowed_templates: ["grid", "floorplan"] }).select("id").single();
      if (cfgErr) throw new Error(`widget_configs: ${cfgErr.message}`);
      const { error: scopeErr } = await admin.from("widget_config_scopes").insert([
        { widget_config_id: config.id, org_id: two.org.id, label: "First building", facility_id: first.id, sort_order: 0 },
        { widget_config_id: config.id, org_id: two.org.id, label: "Second building", facility_id: second.id, sort_order: 1 },
      ]);
      if (scopeErr) throw new Error(`scopes: ${scopeErr.message}`);

      const { context, page, card, toggle } = await studio(browser, two.signIn, "Follows the switcher");
      const text = await card.innerText();
      check("card says it follows the switcher, 1 of 2 ready", text.includes("Follows the switcher — 1 of 2 building maps ready"), text);
      check("card is unlocked with no step 4 choice", await toggle.isEnabled());
      check("step 4 is still on everything", (await page.locator("#widget-scope-facility").inputValue()) === "");
      const publishLink = card.getByRole("link", { name: /Publish its map/ });
      check("the draft building gets a Publish link",
        (await publishLink.count()) === 1 && (await publishLink.getAttribute("href")) === `/dashboard/map?facility=${first.id}`,
        await publishLink.getAttribute("href").catch(() => "none"));
      await page.screenshot({ path: path.join(OUT, "verify-ao-switcher.png") });
      await context.close();

      // The live embed, no preview params: the saved config + switcher.
      const embed = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      const ep = await embed.newPage();
      await ep.goto(`${APP}/widget/${two.org.id}`, { waitUntil: "load" });
      const floorplanButton = ep.getByRole("group", { name: "Choose a view" }).getByRole("button", { name: /Floorplan/ });
      await floorplanButton.waitFor({ timeout: 30000 }).catch(() => {});
      check("the switcher embed offers Floorplan", (await floorplanButton.count()) === 1);
      await floorplanButton.click();
      await ep.getByText("No floor map yet").waitFor({ timeout: 20000 }).catch(() => {});
      check("first entry (draft map) explains there is no map", await ep.getByText("No floor map yet").isVisible());
      await ep.getByRole("button", { name: "Second building" }).click();
      const svg = ep.locator('svg[aria-label="Facility map"]');
      await svg.waitFor({ timeout: 20000 }).catch(() => {});
      check("switching to the second building draws its map", await svg.isVisible());
      check("…and it is that building's map", (await svg.innerHTML().catch(() => "")).includes("Main Gym"));
      // Its only session ran 10–11 AM today. After that, the strip above the
      // map must say the day is done, not that nothing was ever scheduled.
      const hour = new Date().getHours();
      if (hour >= 11) {
        const strip = await ep.getByText(/No (more )?sessions/).first().innerText().catch(() => "");
        check("after the day's last session: 'No more sessions today'", strip === "No more sessions today", strip);
      } else {
        console.log("  SKIP  'No more sessions today' — the 10–11 AM session hasn't ended yet; run after 11:00 local");
      }
      await ep.screenshot({ path: path.join(OUT, "verify-ao-switcher-embed.png") });
      await embed.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`  FAIL  crashed — ${e?.stack ?? e}`);
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
