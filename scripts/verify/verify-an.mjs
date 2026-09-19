/**
 * Floorplan: the map editor's spaces sidebar and the live map's transition
 * alerts + legend.
 *
 * Three parts:
 *   A. The status rules (lib/floorplan/spaceStatus.ts) against a fixed clock —
 *      no server needed. Every threshold has a case just inside AND just
 *      outside it, so a passing run cannot come from a threshold that never
 *      fires.
 *   B. The map editor at /dashboard/map, in a real browser: spaces grouped by
 *      department and zone exactly as the Spaces page groups them, placed vs
 *      unplaced, "Place" targeting a specific space, and sidebar ↔ canvas
 *      selection.
 *   C. The public floorplan, in a real browser, with sessions seeded around
 *      the real current time: the legend's sections and the on-map tags.
 *
 *   npm run dev
 *   node scripts/verify/verify-an.mjs [--headed] [--logic-only] [--out=dir]
 */
import fs from "fs";
import path from "path";
import { createJiti } from "jiti";

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

// ---------------------------------------------------------------------------
// A. Status rules
// ---------------------------------------------------------------------------

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") } });
const { computeFloorplanStatus, ALERT_MINUTES, SOON_MINUTES } = await jiti.import("../../src/lib/floorplan/spaceStatus.ts");

/** Session-convention Date: wall-clock digits in the UTC slots, today = 2026-09-18. */
const at = (hhmm) => new Date(`2026-09-18T${hhmm}:00Z`);
let seq = 0;
function session(name, start, end, spaceIds) {
  seq++;
  return {
    key: `s${seq}_2026-09-18`, sessionId: `s${seq}`, orgId: "o",
    start: at(start), end: at(end),
    scheduleGroupId: "g", scheduleGroupName: name, sportCategory: "swimming", activityType: "drop_in",
    costCents: 0, costNotes: null, ageGroup: null, skillLevel: null, maxParticipants: null,
    spaceIds, holderName: null, templateName: null,
  };
}

function logic() {
  console.log("\nA. Status rules (fixed clock)");
  const mapped = new Set(["L1", "L2", "L3", "L4", "C1", "C2", "R1"]);

  const sessions = [
    // Lanes 1-2: Lap Swim ends 7:10, Aquafit takes over 7:15 → changeover at 7:00.
    session("Lap Swim", "06:00", "07:10", ["L1", "L2"]),
    session("Aquafit", "07:15", "08:00", ["L1", "L2"]),
    // Lane 3: ends 7:12, nothing after → ending.
    session("Lane Swim", "06:30", "07:12", ["L3"]),
    // Lane 4: ends 7:16 — one minute outside ALERT_MINUTES (15) → live, no alert.
    session("Long Swim", "06:30", "07:16", ["L4"]),
    // Court 1: starts 7:14 → soon + starting alert.
    session("Pickleball", "07:14", "08:00", ["C1"]),
    // Court 2: starts 7:16 → soon, NO alert (just outside).
    session("Tennis", "07:16", "08:00", ["C2"]),
    // Room: starts 8:05 → outside SOON_MINUTES (60) → free.
    session("Yoga", "08:05", "09:00", ["R1"]),
    // Unmapped space: must not appear anywhere.
    session("Hidden", "06:00", "07:05", ["UNMAPPED"]),
  ];
  const s = computeFloorplanStatus(sessions, at("07:00"), mapped);
  const st = (id) => s.statusBySpaceId.get(id);

  check(`thresholds are ALERT=15, SOON=60`, ALERT_MINUTES === 15 && SOON_MINUTES === 60, `${ALERT_MINUTES}/${SOON_MINUTES}`);
  check("lane 1 is a changeover", st("L1")?.alert?.kind === "changeover", JSON.stringify(st("L1")));
  check("changeover tag names what comes next", st("L1")?.alert?.tag === "→ Aquafit 7:15 AM", st("L1")?.alert?.tag);
  check("…with a short form for narrow maps", st("L1")?.alert?.shortTag === "→ 7:15 AM", st("L1")?.alert?.shortTag);
  check("lane 3 is ending, counted in minutes", st("L3")?.alert?.tag === "Ends in 12 min", st("L3")?.alert?.tag);
  check("lane 4 (16 min left) is live with no alert", st("L4")?.status === "live" && !st("L4")?.alert, JSON.stringify(st("L4")));
  check("court 1 (14 min away) is soon + starting alert", st("C1")?.status === "soon" && st("C1")?.alert?.tag === "Starts in 14 min", JSON.stringify(st("C1")));
  check("court 2 (16 min away) is soon with no alert", st("C2")?.status === "soon" && !st("C2")?.alert, JSON.stringify(st("C2")));
  check("room (65 min away) is free", !s.statusBySpaceId.has("R1"));
  check("unmapped space is ignored", !s.statusBySpaceId.has("UNMAPPED") && !s.live.some((l) => l.spaceIds.includes("UNMAPPED")));

  check("a two-lane changeover is ONE alert, not two", s.alerts.filter((a) => a.alert.kind === "changeover").length === 1
    && s.alerts.find((a) => a.alert.kind === "changeover").spaceIds.length === 2);
  check("alerts sorted soonest first", s.alerts.map((a) => a.minutesAway).join(",") === "10,12,14", s.alerts.map((a) => a.minutesAway).join(","));
  check("live list is per session, soonest ending first",
    s.live.map((l) => l.session.scheduleGroupName).join(",") === "Lap Swim,Lane Swim,Long Swim",
    s.live.map((l) => l.session.scheduleGroupName).join(","));
  check("up next lists later sessions soonest first",
    s.upcoming.map((u) => u.session.scheduleGroupName).join(",") === "Pickleball,Aquafit,Tennis,Yoga",
    s.upcoming.map((u) => u.session.scheduleGroupName).join(","));

  // A changeover needs the next session to follow closely: 20 minutes of gap is just "ending".
  const gap = computeFloorplanStatus(
    [session("Swim", "06:00", "07:10", ["L1"]), session("Later", "07:30", "08:00", ["L1"])],
    at("07:00"), mapped);
  check("a 20-minute gap is 'ending', not a changeover", gap.statusBySpaceId.get("L1")?.alert?.kind === "ending");

  // Rounding: 30 seconds left must not read "in 0 min".
  const edge = computeFloorplanStatus([session("Swim", "06:00", "07:01", ["L1"])], new Date(at("07:00").getTime() + 30_000), mapped);
  check("30 seconds left reads 'in 1 min'", edge.statusBySpaceId.get("L1")?.alert?.tag === "Ends in 1 min", edge.statusBySpaceId.get("L1")?.alert?.tag);

  // Scrubbing: the same sessions viewed at 6:00 have no alerts at all.
  const early = computeFloorplanStatus(sessions, at("06:00"), mapped);
  check("viewed earlier (6:00), nothing is alerting", early.alerts.length === 0, early.alerts.map((a) => a.alert.tag).join(" | "));
}

logic();

if (process.argv.includes("--logic-only")) {
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
}


// ---------------------------------------------------------------------------
// B + C. Browser
// ---------------------------------------------------------------------------

const { createClient } = await import("@supabase/supabase-js");
const { stringToBase64URL } = await import("@supabase/ssr/dist/main/utils/base64url.js");
const { chromium } = await import("playwright");

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

function cookieValue(session) {
  return "base64-" + stringToBase64URL(JSON.stringify(session));
}
function cookieParts(session) {
  const value = cookieValue(session);
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) out.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  return out;
}
const cookieHeader = (session) => cookieParts(session).map((c) => `${c.name}=${c.value}`).join("; ");

const pad = (n) => String(n).padStart(2, "0");
/** LOCAL calendar date — the app reads session times with local getters (see README's week note). */
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function weekStartIso(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function browserParts() {
  const { data: org, error: orgErr } = await admin.from("organizations")
    .insert({ name: `ZZ floorplan ${stamp}`, slug: `zz-floorplan-${stamp}`, status: "active" }).select("id").single();
  if (orgErr) throw new Error(`org: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-floorplan-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(userData.user.id);
  // "owner", not "admin": 055 replaced the role set.
  const { error: memErr } = await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });
  if (memErr) throw new Error(`membership: ${memErr.message}`);
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });

  const { data: facility } = await admin.from("facilities").insert({
    org_id: org.id, name: `ZZ Floorplan Centre ${stamp}`, slug: `zz-floorplan-${stamp}`,
    address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id").single();

  const dept = async (name, order) => (await admin.from("departments").insert({
    org_id: org.id, facility_id: facility.id, name, slug: `zz-${name.toLowerCase()}-${stamp}`,
    display_order: order, is_published: true,
  }).select("id").single()).data;
  // Inserted Tennis-first so the section order must come from display_order.
  const tennis = await dept("Tennis", 1);
  const aquatics = await dept("Aquatics", 0);

  let order = 0;
  const space = async (name, departmentId, zone) => (await admin.from("spaces").insert({
    org_id: org.id, facility_id: facility.id, department_id: departmentId, zone_name: zone,
    name, slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`, display_order: ++order, is_published: true,
  }).select("id, name").single()).data;
  const lane1 = await space("Lane 1", aquatics.id, "Main Pool");
  const lane2 = await space("Lane 2", aquatics.id, "Main Pool");
  const hotTub = await space("Hot Tub", aquatics.id, null);
  const courtA = await space("Court A", tennis.id, null);
  const lobby = await space("Lobby Room", null, null);

  const { data: map } = await admin.from("facility_maps").insert({
    org_id: org.id, facility_id: facility.id, canvas_width: 40, canvas_height: 25, is_published: true,
  }).select("id").single();
  const groupId = crypto.randomUUID();
  const poolRect = { x: 0.02, y: 0.02, width: 0.5, height: 0.4, rotation: 0 };
  const { error: hotspotErr } = await admin.from("space_hotspots").insert([
    { org_id: org.id, facility_map_id: map.id, space_id: lane1.id, ...poolRect, preset_key: "pool-4lane-25m", group_id: groupId, lane_index: 0, label: null },
    { org_id: org.id, facility_map_id: map.id, space_id: lane2.id, ...poolRect, preset_key: "pool-4lane-25m", group_id: groupId, lane_index: 1, label: null },
    { org_id: org.id, facility_map_id: map.id, space_id: hotTub.id, x: 0.62, y: 0.05, width: 0.2, height: 0.25, rotation: 0, preset_key: "generic-small", label: null },
  ]);
  if (hotspotErr) throw new Error(`hotspots: ${hotspotErr.message}`);

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  try {
    await editorPart({ browser, signIn, facility, courtA, lobby });
    await publicPart({ browser, signIn, org, facility, aquatics, lane1, lane2, userId: userData.user.id });
  } finally {
    await browser.close();
  }
}

async function editorPart({ browser, signIn, facility, courtA }) {
  console.log("\nB. Map editor sidebar (/dashboard/map)");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies(cookieParts(signIn.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
  const page = await context.newPage();
  await page.goto(`${APP}/dashboard/map?facility=${facility.id}`, { waitUntil: "load" });

  const spacesTab = page.getByRole("tab", { name: /^Spaces/ });
  await spacesTab.waitFor({ timeout: 30000 });
  // Shapes load after the page: wait for the count to reflect them.
  await page.getByRole("tab", { name: "Spaces · 3/5" }).waitFor({ timeout: 15000 }).catch(() => {});
  check("Spaces tab counts 3 of 5 placed", (await spacesTab.innerText()).includes("3/5"), await spacesTab.innerText());

  const aside = page.getByRole("complementary", { name: "Map spaces" });
  const sections = (await aside.locator("section h3").allInnerTexts()).map((t) => t.trim().toUpperCase());
  check("sections follow department display order, whole building last",
    sections.slice(0, 3).join(",") === "AQUATICS,TENNIS,WHOLE BUILDING", sections.join(","));
  check("zone label groups the lanes", (await aside.innerText()).includes("Main Pool"));

  const placeButtons = aside.getByRole("button", { name: /^Place$/ });
  check("exactly the two unplaced spaces offer Place", (await placeButtons.count()) === 2, String(await placeButtons.count()));
  check("a placed space is a selectable row", (await aside.locator('button[aria-pressed]', { hasText: "Lane 1" }).count()) === 1);

  // Sidebar → canvas selection.
  await aside.locator('button[aria-pressed]', { hasText: "Lane 1" }).click();
  check("clicking a pool lane selects the whole pool", await aside.getByText("Selected · Pool · 2 lanes").isVisible());
  check("the canvas shows the same selection (handles appear)",
    (await page.locator('[data-shape-canvas] [aria-label^="Rotate"]').count()) === 1);
  const optgroups = await aside.locator("select").first().locator("optgroup").evaluateAll((els) => els.map((e) => e.label));
  check("the space picker is grouped like the Spaces page", optgroups.join(",") === "Aquatics,Tennis,Whole building", optgroups.join(","));

  // Place a specific unplaced space.
  const courtRow = aside.locator("div", { hasText: "Court A" }).filter({ has: page.getByRole("button", { name: "Place" }) }).last();
  await courtRow.getByRole("button", { name: "Place" }).click();
  check("Place switches to the shape picker", (await page.getByRole("tab", { name: "Add shape" }).getAttribute("aria-selected")) === "true");
  check("the picker says which space is being placed", await page.getByText(/Placing\s+Court A/).isVisible());

  await page.getByRole("button", { name: /Tennis Court/ }).first().click();
  const canvas = page.locator("[data-shape-canvas]");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
  await page.getByRole("tab", { name: "Spaces · 4/5" }).waitFor({ timeout: 10000 }).catch(() => {});

  check("after placing, the sidebar is back on Spaces with 4/5", (await spacesTab.innerText()).includes("4/5"), await spacesTab.innerText());
  check("the placed space is the one chosen (Court A), and it is selected",
    await aside.getByText("Selected · Court A").isVisible());
  check("placement is one-shot: nothing is still armed", (await page.locator('[data-shape-canvas].cursor-crosshair').count()) === 0);

  await page.screenshot({ path: path.join(OUT, "verify-an-editor.png") });

  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.getByText("All changes saved").waitFor({ timeout: 10000 }).catch(() => {});
  const { data: saved } = await admin.from("space_hotspots").select("space_id, preset_key, label").eq("space_id", courtA.id);
  check("saved: Court A has a tennis hotspot", saved?.length === 1 && saved[0].preset_key === "court-tennis", JSON.stringify(saved));
  check("saved label is null, so the map shows the space's own name", saved?.[0]?.label === null, JSON.stringify(saved));
  await context.close();
}

async function publicPart({ browser, signIn, org, facility, aquatics, lane1, lane2, userId }) {
  console.log("\nC. Public floorplan: tags + legend");
  const now = new Date();
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  if (minutesOfDay < 90 || minutesOfDay > 22 * 60) {
    skipped("public floorplan", "sessions would cross midnight — run between 01:30 and 22:00 local");
    return;
  }

  const cookie = cookieHeader(signIn.session);
  const at = (offsetMin) => new Date(now.getTime() + offsetMin * 60_000);
  const today = localIso(now);
  const names = {};

  async function makeSession(label, start, end, spaceIds) {
    const { data: group } = await admin.from("schedule_groups").insert({
      org_id: org.id, facility_id: facility.id, department_id: aquatics.id,
      name: `ZZ ${label} ${stamp}`, slug: `zz-${label.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      sport_category: "swimming", activity_type: "drop_in", status: "published", source: "manual",
    }).select("id, name").single();
    names[label] = group.name;
    const res = await fetch(`${APP}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        schedule_group_id: group.id,
        rrule: `FREQ=WEEKLY;BYDAY=${BYDAY[now.getDay()]}`,
        valid_from: today, valid_until: null,
        dtstart: `${today}T${localHm(start)}:00Z`,
        dtend_time: localHm(end),
        space_ids: spaceIds,
      }),
    });
    if (res.status >= 300) throw new Error(`${label}: ${res.status} ${await res.text()}`);
    await admin.from("schedule_week_reviews").insert({
      org_id: org.id, schedule_group_id: group.id, week_start: weekStartIso(now),
      status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString(),
    });
  }
  // Lane 1: Lap Swim ends in ~8 min, Aquafit follows 5 min later → changeover.
  const lapEnd = at(9);
  await makeSession("Lap Swim", at(-60), lapEnd, [lane1.id]);
  await makeSession("Aquafit", new Date(lapEnd.getTime() + 5 * 60_000), at(60), [lane1.id]);
  // Lane 2: Lessons start in ~12 min → starting.
  await makeSession("Lessons", at(13), at(55), [lane2.id]);

  const url = `${APP}/widget/${org.id}?facilityId=${facility.id}&preview=1&templates=floorplan`;

  for (const [label, viewport] of [["desktop", { width: 1400, height: 1000 }], ["phone", { width: 390, height: 900 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const svg = page.locator('svg[aria-label="Facility map"]');
    await svg.waitFor({ timeout: 30000 }).catch(() => {});
    await page.getByText("Heads up").waitFor({ timeout: 20000 }).catch(() => {});

    const legend = page.locator("div", { has: page.getByText("Heads up") }).filter({ hasText: "Up next" }).last();
    const legendText = (await legend.innerText().catch(() => "")) || "";

    if (label === "desktop") {
      check("legend has a Heads up section", legendText.includes("HEADS UP") || legendText.includes("Heads up"), legendText.slice(0, 200));
      check("changeover row names both sessions", legendText.includes(`${names["Lap Swim"]} → ${names["Aquafit"]}`), legendText);
      check("starting row counts down", /Starts in \d+ min/.test(legendText), legendText);
      check("On now lists Lap Swim", /On now[\s\S]*ZZ Lap Swim/i.test(legendText));
      check("Up next lists Lessons before Aquafit",
        legendText.indexOf(names["Lessons"], legendText.search(/Up next/i)) > -1 &&
        legendText.indexOf(names["Lessons"], legendText.search(/Up next/i)) < legendText.indexOf(names["Aquafit"], legendText.search(/Up next/i)));

      const svgText = await svg.innerHTML();
      check("the map carries a changeover tag", svgText.includes(`→ ${names["Aquafit"]}`));
      check("the map carries a starting tag", /Starts in \d+ min/.test(svgText));
      check("alert tags use the alert colour", (svgText.match(/fill="#C2410C"/g) ?? []).length >= 2);

      const mapBox = await svg.boundingBox();
      const legendBox = await legend.boundingBox();
      check("wide: legend sits beside the map", legendBox && mapBox && legendBox.x >= mapBox.x + mapBox.width - 1,
        JSON.stringify({ mapBox, legendBox }));
      await page.screenshot({ path: path.join(OUT, "verify-an-floorplan-desktop.png") });

      // Positive control: scrub back to the start of the day — the same data
      // must then have nothing alerting, or the tags are not time-driven.
      await page.getByRole("slider").focus();
      await page.keyboard.press("Home");
      await page.waitForTimeout(300);
      const earlySvg = await svg.innerHTML();
      check("scrubbed to the day's start, the tags are gone", !earlySvg.includes("#C2410C"));
      check("…and the legend says so", !(await page.getByText("Heads up").isVisible().catch(() => false)));
    } else {
      const mapBox = await svg.boundingBox();
      const legendBox = await legend.boundingBox();
      check("phone: legend stacks under the map", legendBox && mapBox && legendBox.y >= mapBox.y + mapBox.height - 1,
        JSON.stringify({ mapBox, legendBox }));
      // Test session names are long (they carry a stamp), which is exactly
      // the case the short tag exists for: at phone width the pool lane gets
      // "→ 9:40 PM", and every pill stays inside the map.
      const phoneSvg = await svg.innerHTML();
      check("phone: long changeover tag falls back to the short form",
        phoneSvg.includes("→ ") && !phoneSvg.includes(`→ ${names["Aquafit"]}`));
      const pills = await svg.locator('rect[fill="#C2410C"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
      check("phone: every alert pill is inside the map",
        pills.length >= 2 && pills.every((r) => r.left >= mapBox.x - 1 && r.right <= mapBox.x + mapBox.width + 1),
        JSON.stringify({ pills, mapBox }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check("phone: no horizontal scroll", overflow <= 0, `overflow ${overflow}px`);
      await page.screenshot({ path: path.join(OUT, "verify-an-floorplan-phone.png"), fullPage: true });
    }
    await context.close();
  }
}

try {
  await browserParts();
} catch (e) {
  fail++;
  console.log(`  FAIL  browser parts crashed — ${e?.stack ?? e}`);
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
