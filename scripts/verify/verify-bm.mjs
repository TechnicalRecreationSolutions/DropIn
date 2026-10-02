/**
 * The Facilities page, map first (docs/prompts/facilities-map.md).
 *
 *   node --experimental-strip-types scripts/verify/verify-bm.mjs --logic-only
 *   node --experimental-strip-types scripts/verify/verify-bm.mjs \
 *       [--app=http://localhost:3001] [--grid-app=http://localhost:3000] [--headed]
 *
 * --app must be a server started WITH a Mapbox token — any pk.… string will
 * do, because the harness answers Mapbox's style requests itself; no real
 * token is needed and no map load is billed. --grid-app is one started
 * WITHOUT a token, which must still render the old grid. Two dev servers on
 * one checkout need separate build dirs:
 *
 *   NEXT_DIST_DIR=.next-fm NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1Ijoieno... npx next dev -p 3001
 *
 * Standing in for Mapbox keeps everything real except the tile pixels: the
 * real mapbox-gl CSP build, its worker from /mapbox-gl-csp-worker.js, the
 * browser enforcing the real CSP (it blocks before Playwright's route ever
 * sees a request), real markers and real camera moves. The screenshots show
 * pins over a plain background rather than streets.
 *
 * Section 0 — the "far away" rule, against the real src/lib/geo/mainCluster.ts.
 * The org this was written for has two buildings on the Saanich Peninsula and
 * a test centre in Edmonton; fitting all three would merge the two real pins.
 *
 * Every negative has a positive control: "Edmonton is far" is asserted next to
 * "the second Saanich building is in", a missing pin next to a present one,
 * the coordinator's one row next to the owner's five.
 */
import fs from "fs";
import path from "path";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const LOGIC_ONLY = process.argv.includes("--logic-only");
const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3001";
const GRID_APP = process.argv.find((a) => a.startsWith("--grid-app="))?.slice(11) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const OUT = path.resolve("scripts/verify/out/bm");

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

async function logicChecks() {
  register("./_alias-hooks.mjs", import.meta.url);
  const geo = await import("../../src/lib/geo/mainCluster.ts");

  console.log("\n0. Main cluster (real module, no database)");

  const pool = { id: "pool", lat: 48.5014399, lng: -123.3893249 };
  const panorama = { id: "panorama", lat: 48.6238046, lng: -123.4201995 };
  const edmonton = { id: "edmonton", lat: 53.5461, lng: -113.4938 };
  const calgary = { id: "calgary", lat: 51.0447, lng: -114.0719 };

  const d = geo.distanceKm(pool, panorama);
  check("distanceKm: the two Saanich buildings are ~14 km apart", d > 12 && d < 16, `got ${d}`);
  const de = geo.distanceKm(pool, edmonton);
  check("distanceKm: Saanich → Edmonton is ~900 km", de > 850 && de < 950, `got ${de}`);
  check("distanceKm is symmetric", Math.abs(geo.distanceKm(edmonton, pool) - de) < 1e-9);
  check("the threshold is the named 150 km", geo.MAIN_CLUSTER_RADIUS_KM === 150);

  const three = geo.splitMainCluster([pool, panorama, edmonton]);
  check(
    "real org: both Saanich buildings open the map (positive control)",
    three.main.map((p) => p.id).join() === "pool,panorama",
    JSON.stringify(three)
  );
  check("real org: Edmonton is off the map", three.far.map((p) => p.id).join() === "edmonton");

  const one = geo.splitMainCluster([edmonton]);
  check("a single facility is its own cluster", one.main.length === 1 && one.far.length === 0);

  const none = geo.splitMainCluster([]);
  check("no facilities → nothing in either half", none.main.length === 0 && none.far.length === 0);

  // Even split, far apart: the median sits in the Rockies, near nothing.
  // Edmonton–Calgary is ~280 km, so they are two lone buildings; the two
  // Saanich ones are a real pair. The fallback must open on the pair, not on
  // whichever single building is nearest the empty middle (Calgary).
  const split = geo.splitMainCluster([pool, panorama, edmonton, calgary]);
  check(
    "median in no-man's-land → opens on the densest group (the Saanich pair)",
    split.main.map((p) => p.id).join() === "pool,panorama",
    JSON.stringify(split.main.map((p) => p.id))
  );
  check(
    "…and the halves partition the input (nothing lost, nothing doubled)",
    [...split.main, ...split.far].map((p) => p.id).sort().join() ===
      ["calgary", "edmonton", "panorama", "pool"].join()
  );

  // Edmonton and Calgary are ~280 km apart: a larger radius takes both in.
  check(
    "the radius parameter is honoured",
    geo.splitMainCluster([edmonton, calgary], 400).main.length === 2 &&
      geo.splitMainCluster([edmonton, calgary], 100).main.length === 1
  );

  const b = geo.boundsOf([pool, panorama]);
  check(
    "boundsOf is [[west, south], [east, north]]",
    b[0][0] === panorama.lng && b[0][1] === pool.lat && b[1][0] === pool.lng && b[1][1] === panorama.lat,
    JSON.stringify(b)
  );
}

// ── Browser sections ────────────────────────────────────────────────────────

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPA, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const COOKIE_NAME = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

function cookieParts(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) out.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  return out;
}

async function insert(table, row) {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}

async function makeUser(orgId, role, label, departmentId = null, facilityId = null) {
  const email = `zz-bm-${label}-${stamp}@example.invalid`;
  const password = `Zc!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);
  const membershipId = await insert("org_memberships", { org_id: orgId, user_id: data.user.id, role, email, display_name: `ZZ ${label}` });
  if (departmentId) await insert("membership_scopes", { membership_id: membershipId, org_id: orgId, department_id: departmentId });
  if (facilityId) await insert("membership_scopes", { membership_id: membershipId, org_id: orgId, facility_id: facilityId });
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  return cookieParts(signIn.session);
}

/** A style with no sources: the map initializes, draws a background, loads nothing else. */
const STUB_STYLE = (dark) => ({
  version: 8,
  name: dark ? "stub-dark" : "stub-light",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#1b1b1f" : "#eef1f4" } }],
});

async function newPage(browser, app, cookies, { viewport, reducedMotion = "no-preference", styleStatus = 200 } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "en-US", reducedMotion });
  await ctx.addCookies(cookies.map((c) => ({ ...c, url: app, httpOnly: false, secure: false })));
  const page = await ctx.newPage();
  const log = { csp: [], errors: [], styles: [], worker: null };
  page.on("console", (m) => {
    const t = m.text();
    if (/Content.Security.Policy|violates the following/i.test(t)) log.csp.push(t);
    else if (m.type() === "error") log.errors.push(t);
  });
  page.on("response", (r) => {
    if (r.url().endsWith("/mapbox-gl-csp-worker.js")) log.worker = r.status();
  });
  await page.route(/https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/(light|dark)-v11/, (route) => {
    const dark = route.request().url().includes("dark-v11");
    log.styles.push(dark ? "dark" : "light");
    if (styleStatus !== 200) return route.fulfill({ status: styleStatus, body: '{"message":"Not Authorized"}' });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STUB_STYLE(dark)) });
  });
  await page.route(/https:\/\/(events\.mapbox\.com|api\.mapbox\.com\/(?!styles))/, (route) => route.fulfill({ status: 204, body: "" }));
  return { ctx, page, log };
}

async function go(page, app, url) {
  await page.goto(`${app}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

const pin = (page, name) => page.locator(".mapboxgl-marker").getByRole("button", { name, exact: true });
const row = (page, name) => page.getByRole("complementary", { name: "Facilities" }).getByRole("button", { name: new RegExp(`^${name}`) });
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
};
const inside = (p, box) => !!p && !!box && p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
const settle = (page, ms = 900) => page.waitForTimeout(ms);

async function browserChecks() {
  const { chromium } = await import("playwright");
  fs.mkdirSync(OUT, { recursive: true });

  // ── Fixture ─────────────────────────────────────────────────────────────
  const orgId = await insert("organizations", { name: `ZZ Map ${stamp}`, slug: `zz-map-${stamp}`, status: "active" });
  ids.orgs.push(orgId);
  const fac = (name, city, province, lat, lng, geocoded) =>
    insert("facilities", {
      org_id: orgId,
      name,
      slug: `zz-bm-${name.toLowerCase().replace(/\W+/g, "-")}-${stamp}`,
      address_line1: "1 Test St",
      city,
      province,
      postal_code: "V0V 0V0",
      is_published: name !== "Pending Hall",
      lat,
      lng,
      geocoded_at: geocoded ? new Date().toISOString() : null,
    });
  const pool = await fac("Crystal Bay Pool", "Saanich", "BC", 48.5014399, -123.3893249, true);
  const pan = await fac("Peninsula Centre", "North Saanich", "BC", 48.6238046, -123.4201995, true);
  await fac("Prairie Rec", "Edmonton", "AB", 53.5461, -113.4938, true);
  await fac("Pending Hall", "Sidney", "BC", null, null, false);
  const lost = await fac("Lost Arena", "Nowhere", "BC", null, null, true);
  const aquatics = await insert("departments", { org_id: orgId, facility_id: pool, name: "Aquatics", slug: `zz-bm-aq-${stamp}`, display_order: 0, is_published: true });
  await insert("schedule_groups", { org_id: orgId, facility_id: pool, department_id: aquatics, name: "Swim", slug: `zz-bm-swim-${stamp}`, sport_category: "swimming", activity_type: "drop_in", status: "published", source: "manual", starts_on: "2026-01-01" });
  await insert("facility_notices", { org_id: orgId, facility_id: pan, category: "mechanical", severity: "closure", headline: "Boiler down", is_published: true, starts_at: new Date(Date.now() - 3600e3).toISOString() });

  const owner = await makeUser(orgId, "owner", "owner");
  const coord = await makeUser(orgId, "coordinator", "coord", aquatics);
  const aux = await makeUser(orgId, "aux", "aux", null, pool);

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    // ── 1. Owner, desktop ──────────────────────────────────────────────────
    console.log("\n1. Owner at 1440 — pins, the far-away rule, selection both ways");
    const d = await newPage(browser, APP, owner, { viewport: { width: 1440, height: 900 } });
    await go(d.page, APP, "/dashboard/facilities");
    await pin(d.page, "Crystal Bay Pool").waitFor({ timeout: 30_000 }).catch(async (e) => {
      await d.page.screenshot({ path: `${OUT}/fail-first-load.png` });
      console.log("  first load failed:", await d.page.locator("[data-reason]").getAttribute("data-reason").catch(() => "(no fallback)"), JSON.stringify(d.log, null, 1).slice(0, 3000));
      throw e;
    });
    await settle(d.page);
    const mapBox = await d.page.getByRole("region", { name: "Facilities map", exact: true }).boundingBox();

    // Without this the position checks below can pass on an invisible map:
    // they did once, while mapbox-gl.css had collapsed the container to 0 px.
    const canvasBox = await d.page.locator("canvas.mapboxgl-canvas").boundingBox();
    check("the canvas fills the map area (not collapsed)",
      canvasBox && Math.abs(canvasBox.width - mapBox.width) < 2 && Math.abs(canvasBox.height - mapBox.height) < 2,
      JSON.stringify({ canvasBox, mapBox }));
    check("the map canvas is labelled", (await d.page.locator("canvas.mapboxgl-canvas").getAttribute("aria-label"))?.startsWith("Map of your facilities"));
    check("the worker loads from this origin (CSP build)", d.log.worker === 200, `status ${d.log.worker}`);
    check("one pin per located facility (3)", (await d.page.locator(".mapboxgl-marker").count()) === 3);
    check("no pin for a facility with no coordinates", (await pin(d.page, "Lost Arena").count()) === 0 && (await pin(d.page, "Pending Hall").count()) === 0);
    check("opening view: both Saanich pins on screen (positive control)",
      inside(await centre(pin(d.page, "Crystal Bay Pool")), mapBox) && inside(await centre(pin(d.page, "Peninsula Centre")), mapBox));
    check("opening view: Edmonton is off the map", !inside(await centre(pin(d.page, "Prairie Rec")), mapBox));
    const pPool = await centre(pin(d.page, "Crystal Bay Pool"));
    const pPan = await centre(pin(d.page, "Peninsula Centre"));
    check("the two Saanich pins are well apart, not merged (>100 px)", Math.hypot(pPool.x - pPan.x, pPool.y - pPan.y) > 100,
      JSON.stringify({ pPool, pPan }));
    const chip = d.page.getByRole("button", { name: /^Prairie Rec · Edmonton, AB/ });
    check("an off-map chip names the far facility", (await chip.count()) === 1);
    const footer = await d.page.getByRole("complementary", { name: "Facilities" }).locator("p").last().innerText();
    check("footer: \"5 facilities · 1 off this map\"", footer === "5 facilities · 1 off this map", footer);
    check("the far facility's row says \"off this map\"", (await row(d.page, "Prairie Rec").innerText()).includes("off this map"));
    check("pending row: \"No location yet\"", (await row(d.page, "Pending Hall").innerText()).includes("No location yet"));
    check("not-found row: \"Address not found — check it\"", (await row(d.page, "Lost Arena").innerText()).includes("Address not found — check it"));
    check("the owner has Add facility", (await d.page.getByRole("link", { name: "Add facility" }).count()) === 1);
    await d.page.screenshot({ path: `${OUT}/1440-light.png` });

    // Pin → row
    await pin(d.page, "Peninsula Centre").click();
    check("click a pin → its row is selected", (await row(d.page, "Peninsula Centre").getAttribute("aria-pressed")) === "true");
    check("…and only that row", (await row(d.page, "Crystal Bay Pool").getAttribute("aria-pressed")) === "false");
    await settle(d.page, 300); // the pin's colour transition
    const fills = await d.page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "bg-brand";
      document.body.append(probe);
      const brand = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const drop = (name) => getComputedStyle(document.querySelector(`.mapboxgl-marker button[aria-label="${name}"] > span`)).backgroundColor;
      return { brand, selected: drop("Peninsula Centre"), other: drop("Crystal Bay Pool") };
    });
    check("the selected pin turns brand", fills.selected === fills.brand, JSON.stringify(fills));
    check("…the others stay ink (positive control)", fills.other !== fills.brand, JSON.stringify(fills));
    const card = d.page.getByRole("region", { name: "Peninsula Centre" });
    check("the floating card opens for it", await card.isVisible());
    check("card: Schedule goes to the command centre for this facility",
      (await card.getByRole("link", { name: "Schedule" }).getAttribute("href"))?.includes(pan));
    check("card: the live closure is shown (nothing the grid showed is lost)", (await card.getByRole("link", { name: "1 status is live" }).getAttribute("href")) === `/dashboard/facilities/${pan}/status`);
    check("card: Edit goes to the edit page", (await card.getByRole("link", { name: "Edit" }).getAttribute("href")) === `/dashboard/facilities/${pan}/edit`);
    check("card: counts badge", (await card.innerText()).includes("0 departments · 0 schedules"));
    check("row: the live closure shows as a badge", (await row(d.page, "Peninsula Centre").innerText()).includes("1 live"));
    await d.page.screenshot({ path: `${OUT}/1440-light-selected.png` });
    await d.page.keyboard.press("Escape");
    check("Escape closes the card", (await card.count()) === 0);

    // Row → pin, camera moves to it
    await row(d.page, "Crystal Bay Pool").click();
    await settle(d.page, 1200);
    check("click a row → its pin is selected", (await pin(d.page, "Crystal Bay Pool").getAttribute("aria-pressed")) === "true");
    const expectX = mapBox.x + (340 + (mapBox.width - 80)) / 2;
    const after = await centre(pin(d.page, "Crystal Bay Pool"));
    check("…and the map moves to centre it (inside the padded area)", Math.abs(after.x - expectX) < 40, `pin x ${after.x}, expected ≈${expectX}`);

    // Chip → far facility
    await chip.click();
    await settle(d.page, 1200);
    check("the off-map chip selects the far facility", (await row(d.page, "Prairie Rec").getAttribute("aria-pressed")) === "true");
    check("…and flies to it", inside(await centre(pin(d.page, "Prairie Rec")), mapBox));
    check("…leaving Saanich behind (positive control on the move)", !inside(await centre(pin(d.page, "Crystal Bay Pool")), mapBox));

    // Show all
    await d.page.keyboard.press("Escape");
    await d.page.getByRole("button", { name: "Show all" }).click();
    await settle(d.page, 1200);
    const all = await Promise.all(["Crystal Bay Pool", "Peninsula Centre", "Prairie Rec"].map((n) => centre(pin(d.page, n))));
    check("Show all fits every pin", all.every((p) => inside(p, mapBox)), JSON.stringify(all));

    // Not-found facility: still selectable, card points at the address
    await row(d.page, "Lost Arena").click();
    const lostCard = d.page.getByRole("region", { name: "Lost Arena" });
    check("an unplaced facility still opens a card with its actions",
      (await lostCard.getByRole("link", { name: "Schedule" }).count()) === 1);
    check("…whose location line links to the address field",
      (await lostCard.getByRole("link", { name: "Address not found — check it" }).getAttribute("href")) === `/dashboard/facilities/${lost}/edit#address_line1`);
    await d.page.keyboard.press("Escape");

    // Search filters rows and pins together
    await d.page.getByRole("searchbox", { name: /Search facilities/ }).fill("edmon");
    check("search by city narrows the list", (await d.page.getByRole("complementary", { name: "Facilities" }).getByRole("listitem").count()) === 1);
    check("…and the pins (Edmonton stays)", (await pin(d.page, "Prairie Rec").count()) === 1);
    check("…(Saanich goes)", (await pin(d.page, "Crystal Bay Pool").count()) === 0);
    await d.page.getByRole("searchbox", { name: /Search facilities/ }).fill("");
    await pin(d.page, "Crystal Bay Pool").waitFor();
    check("clearing the search brings the pins back", (await d.page.locator(".mapboxgl-marker").count()) === 3);

    // Keyboard: a pin is a focusable button
    await pin(d.page, "Peninsula Centre").focus();
    await d.page.keyboard.press("Enter");
    check("a pin works from the keyboard", (await row(d.page, "Peninsula Centre").getAttribute("aria-pressed")) === "true");
    await d.page.keyboard.press("Escape");

    // Dark mode reaches the map style
    await d.page.evaluate(() => document.documentElement.classList.add("dark"));
    await settle(d.page, 1200);
    check("flipping .dark loads the dark style", d.log.styles.at(-1) === "dark", d.log.styles.join(","));
    check("…after starting light (positive control)", d.log.styles[0] === "light");
    check("pins survive the style swap", (await d.page.locator(".mapboxgl-marker").count()) === 3);
    await d.page.screenshot({ path: `${OUT}/1440-dark.png` });
    await d.page.evaluate(() => document.documentElement.classList.remove("dark"));

    check("the console has no CSP violations", d.log.csp.length === 0, d.log.csp.join("\n      "));
    check("the console has no errors", d.log.errors.length === 0, d.log.errors.slice(0, 3).join("\n      "));
    await d.ctx.close();

    // ── 2. Reduced motion jumps ───────────────────────────────────────────
    console.log("\n2. prefers-reduced-motion: the camera jumps instead of flying");
    for (const motion of ["reduce", "no-preference"]) {
      const r = await newPage(browser, APP, owner, { viewport: { width: 1440, height: 900 }, reducedMotion: motion });
      await go(r.page, APP, "/dashboard/facilities");
      await pin(r.page, "Prairie Rec").waitFor({ timeout: 30_000 });
      await settle(r.page);
      const box = await r.page.getByRole("region", { name: "Facilities map", exact: true }).boundingBox();
      await row(r.page, "Prairie Rec").click();
      await r.page.waitForTimeout(80);
      const early = inside(await centre(pin(r.page, "Prairie Rec")), box);
      check(motion === "reduce" ? "reduce: already there after 80 ms" : "no preference: still travelling after 80 ms (positive control)",
        motion === "reduce" ? early : !early);
      await r.ctx.close();
    }

    // ── 3. Phone ───────────────────────────────────────────────────────────
    console.log("\n3. Owner at 390 — map over a sheet, actions in the row");
    for (const theme of ["light", "dark"]) {
      const m = await newPage(browser, APP, owner, { viewport: { width: 390, height: 844 } });
      await go(m.page, APP, "/dashboard/facilities");
      if (theme === "dark") await m.page.evaluate(() => document.documentElement.classList.add("dark"));
      await pin(m.page, "Crystal Bay Pool").waitFor({ timeout: 30_000 });
      await settle(m.page);
      if (theme === "light") {
        const mapH = (await m.page.getByRole("region", { name: "Facilities map", exact: true }).boundingBox()).height;
        check("the map is ~45% of the viewport", mapH > 844 * 0.4 && mapH < 844 * 0.5, `${mapH}px`);
        const rowH = (await row(m.page, "Crystal Bay Pool").boundingBox()).height;
        check("rows are at least 64 px tall", rowH >= 64, `${rowH}px`);
        const sheetTop = (await m.page.getByRole("complementary", { name: "Facilities" }).boundingBox()).y;
        const mapBottom = await m.page.getByRole("region", { name: "Facilities map", exact: true }).boundingBox().then((b) => b.y + b.height);
        check("the sheet overlaps the map's bottom edge by 16 px", Math.abs(mapBottom - sheetTop - 16) <= 1, `${mapBottom - sheetTop}`);
        check("Add facility is in the title row on a phone", await m.page.getByRole("link", { name: "Add facility" }).isVisible());
        const logo = await m.page.locator(".mapboxgl-ctrl-logo").boundingBox();
        check("the Mapbox logo sits clear of the sheet", logo && logo.y + logo.height <= sheetTop, JSON.stringify({ logo, sheetTop }));
        const chipBox = await m.page.getByRole("button", { name: /^Prairie Rec · Edmonton/ }).boundingBox();
        const labels = await m.page.locator(".mapboxgl-marker button, .mapboxgl-marker button > span:last-child").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
        const overlaps = labels.filter((l) => l.x < chipBox.x + chipBox.width && chipBox.x < l.x + l.width && l.y < chipBox.y + chipBox.height && chipBox.y < l.y + l.height);
        check("the off-map chip covers no pin or pin label", labels.length === 6 && overlaps.length === 0, JSON.stringify({ chipBox, overlaps }));
        await pin(m.page, "Peninsula Centre").click({ timeout: 10_000 }).catch(async (e) => {
          await m.page.screenshot({ path: `${OUT}/fail-phone-pin.png` });
          throw e;
        });
        check("tap a pin → its row is selected", (await row(m.page, "Peninsula Centre").getAttribute("aria-pressed")) === "true");
        check("no floating card on a phone", (await m.page.getByRole("region", { name: "Peninsula Centre" }).count()) === 0);
        const sheet = m.page.getByRole("complementary", { name: "Facilities" });
        check("the selected row carries Schedule / status / Edit",
          (await sheet.getByRole("link", { name: "Schedule" }).count()) === 1 &&
          (await sheet.getByRole("link", { name: "1 status is live" }).count()) === 1 &&
          (await sheet.getByRole("link", { name: "Edit" }).count()) === 1);
        const scrollW = await m.page.evaluate(() => document.documentElement.scrollWidth);
        check("no horizontal overflow at 390 px", scrollW <= 390, `scrollWidth ${scrollW}`);
        await m.page.keyboard.press("Escape");
      }
      await m.page.screenshot({ path: `${OUT}/390-${theme}.png`, fullPage: false });
      check(`390 ${theme}: no CSP violations`, m.log.csp.length === 0, m.log.csp.join("\n      "));
      await m.ctx.close();
    }

    // ── 4. Coordinator ─────────────────────────────────────────────────────
    console.log("\n4. Coordinator scoped to one building");
    const c = await newPage(browser, APP, coord, { viewport: { width: 1440, height: 900 } });
    await go(c.page, APP, "/dashboard/facilities");
    await pin(c.page, "Crystal Bay Pool").waitFor({ timeout: 30_000 });
    check("sees their building's row", (await row(c.page, "Crystal Bay Pool").count()) === 1);
    check("…and no other building (owner saw 5)", (await c.page.getByRole("complementary", { name: "Facilities" }).getByRole("listitem").count()) === 1);
    check("…and one pin", (await c.page.locator(".mapboxgl-marker").count()) === 1);
    check("no Add facility (no facility:create)", (await c.page.getByRole("link", { name: "Add facility" }).count()) === 0);
    await c.ctx.close();

    const a = await newPage(browser, APP, aux, { viewport: { width: 1440, height: 900 } });
    await go(a.page, APP, "/dashboard/facilities");
    check("aux staff are sent to the schedule (a management page)", new URL(a.page.url()).pathname === "/dashboard/schedule", a.page.url());
    check("…and never loaded mapbox-gl", a.log.worker === null && a.log.styles.length === 0);
    await a.ctx.close();

    // ── 5. A refused token hands over to the list ──────────────────────────
    console.log("\n5. Mapbox refuses the token (401)");
    const f = await newPage(browser, APP, owner, { viewport: { width: 1440, height: 900 }, styleStatus: 401 });
    await go(f.page, APP, "/dashboard/facilities");
    const msg = f.page.getByText("The map couldn’t load here. Every facility is in the list.");
    await msg.waitFor({ timeout: 30_000 }).catch(() => {});
    check("the map area says so instead of sitting grey", await msg.isVisible());
    check("every facility is still in the list", (await f.page.getByRole("complementary", { name: "Facilities" }).getByRole("listitem").count()) === 5);
    check("selecting a row still offers the actions",
      await row(f.page, "Crystal Bay Pool").click().then(() => f.page.getByRole("complementary", { name: "Facilities" }).getByRole("link", { name: "Schedule" }).count()) === 1);
    await f.ctx.close();

    // ── 6. No token: the grid, unchanged ───────────────────────────────────
    console.log(`\n6. No token (${GRID_APP}) — the old grid`);
    const g = await newPage(browser, GRID_APP, owner, { viewport: { width: 1440, height: 900 } });
    await go(g.page, GRID_APP, "/dashboard/facilities");
    await g.page.getByRole("heading", { name: "Crystal Bay Pool" }).waitFor({ timeout: 30_000 }).catch(() => {});
    check("renders the grid cards", (await g.page.getByRole("heading", { level: 3 }).count()) === 5);
    check("no map at all", (await g.page.locator(".mapboxgl-map, canvas").count()) === 0);
    check("the grid still shows the live closure", (await g.page.getByRole("link", { name: "1 status is live" }).count()) === 1);
    check("…and Post a status on the others (shared FacilityStatusLink)", (await g.page.getByRole("link", { name: "Post a status" }).count()) === 4);
    await g.ctx.close();
  } finally {
    await browser.close();
  }
}

try {
  await logicChecks();
  if (!LOGIC_ONLY) await browserChecks();
} catch (e) {
  failed++;
  console.error(e);
} finally {
  if (!LOGIC_ONLY) {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
