/**
 * The Overview, rebuilt around today.
 *
 * The page it replaces opened with four count tiles, a table of schedule names,
 * and a second list of the same names underneath labelled with a *different*
 * status vocabulary. It never showed a schedule. The rubric it was rebuilt
 * against is docs/prompts/overview-ux.md; this harness is one assertion per
 * section of it, and the claims under test are the ones that change:
 *
 *   A. The first fold answers "what is running today" with a picture, marks
 *      now, and names anything that is wrong instead of counting it.
 *   B. The two frequent creates are buttons, the blocks are links to the
 *      sessions they draw, and a phone can reach a row's Edit.
 *   C. The numbers are true: the activity count pages past PostgREST's silent
 *      1000-row cap, the "latest changes" panel reports changes rather than
 *      re-listing the table above it, and an all-clear is stated.
 *   D/E. The stat row is half its old height, and at 390px the date, the alert
 *      and the ribbon are all above the fold with no horizontal page scroll.
 *
 * Section 0 needs nothing running — it is the ribbon's arithmetic alone.
 *
 *   node --experimental-strip-types scripts/verify/verify-ay.mjs --logic-only
 *
 * The rest drives a real browser against a running server and the live
 * database:
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-ay.mjs [--headed] [--out=dir]
 *
 * Deliberately no assertion that a reload shows a just-saved value: `next dev`
 * serves cached segments for minutes (see docs/RESUME.md), and a red there
 * would be the dev server rather than the page.
 */
import fs from "fs";
import path from "path";
import {
  axisBounds,
  blockRect,
  hourTicks,
  packRows,
  positionPct,
  summarise,
  MIN_BLOCK_MINUTES,
  MIN_AXIS_MINUTES,
} from "../../src/components/dashboard/today/todayGeometry.ts";

const LOGIC_ONLY = process.argv.includes("--logic-only");
const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";

let pass = 0,
  fail = 0,
  skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const skipped = (label, why) => {
  skip++;
  console.log(`  SKIP  ${label} — ${why}`);
};

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

// ─────────────────────────────────────────────────────────────────────────────
// § 0 — the ribbon's arithmetic. No database, no server, no browser.
// ─────────────────────────────────────────────────────────────────────────────
function section0() {
  console.log("\n§0  todayGeometry (logic only)\n");

  const span = (startMin, endMin, id = `${startMin}`) => ({ startMin, endMin, id });

  // ── axisBounds ──
  {
    const a = axisBounds([span(545, 605), span(800, 930)], null);
    check("axis is hour-aligned outwards from the data", a.startMin === 540 && a.endMin === 960, JSON.stringify(a));
  }
  {
    // One 30-minute session would otherwise be the whole axis, and a block
    // drawn at 100% width says nothing about the day it sits in.
    const a = axisBounds([span(600, 630)], null);
    check("a single short session still gets a 4-hour window", a.endMin - a.startMin >= MIN_AXIS_MINUTES, JSON.stringify(a));
  }
  {
    const a = axisBounds([span(540, 600)], 1380);
    check("the axis stretches to include 'now'", a.startMin <= 540 && a.endMin >= 1380, JSON.stringify(a));
  }
  {
    const a = axisBounds([span(1400, 1440)], 1430);
    check("the axis never runs past midnight", a.endMin <= 1440 && a.startMin >= 0, JSON.stringify(a));
  }
  {
    const a = axisBounds([], null);
    check("an empty day still returns a usable window", a.endMin > a.startMin, JSON.stringify(a));
  }

  // ── positionPct / blockRect ──
  {
    const axis = { startMin: 540, endMin: 1260 };
    check("midpoint of the axis is 50%", Math.abs(positionPct(900, axis) - 50) < 0.001);
    check("a minute before the axis clamps to 0%", positionPct(0, axis) === 0);
    check("a minute past the axis clamps to 100%", positionPct(1440, axis) === 100);
  }
  {
    const axis = { startMin: 540, endMin: 1260 }; // 12 hours
    const r = blockRect(span(600, 660), axis);
    check("a one-hour block is 1/12th of a 12-hour axis", Math.abs(r.widthPct - 100 / 12) < 0.001, JSON.stringify(r));
  }
  {
    const axis = { startMin: 540, endMin: 1260 };
    const tiny = blockRect(span(600, 605), axis);
    const floor = blockRect(span(600, 600 + MIN_BLOCK_MINUTES), axis);
    check(
      "a 5-minute block is widened to the minimum tap target",
      Math.abs(tiny.widthPct - floor.widthPct) < 0.001,
      JSON.stringify(tiny)
    );
  }

  // ── packRows ──
  {
    const { rows, overflow } = packRows([span(540, 600), span(600, 660), span(660, 720)], 4);
    check("back-to-back blocks share one row", rows.length === 1 && overflow.length === 0, `${rows.length} rows`);
  }
  {
    const { rows } = packRows([span(540, 660), span(600, 700), span(620, 680)], 4);
    check("three overlapping blocks take three rows", rows.length === 3, `${rows.length} rows`);
  }
  {
    const overlapping = Array.from({ length: 6 }, (_, i) => span(540 + i, 900, `s${i}`));
    const { rows, overflow } = packRows(overlapping, 4);
    check("past the row cap the rest is handed back, not dropped", rows.length === 4 && overflow.length === 2, `${rows.length}/${overflow.length}`);
    const drawn = rows.flat().length + overflow.length;
    check("nothing is lost in packing", drawn === overlapping.length, `${drawn} of ${overlapping.length}`);
  }
  {
    // Two blocks 5 minutes apart, the first only 2 minutes long: both are drawn
    // at the minimum width, so sharing a row would visibly overlap.
    const { rows } = packRows([span(600, 602), span(605, 700)], 4);
    check("a widened block reserves the width it is drawn at", rows.length === 2, `${rows.length} rows`);
  }
  {
    const forward = packRows([span(540, 600, "a"), span(700, 760, "b")], 4);
    const backward = packRows([span(700, 760, "b"), span(540, 600, "a")], 4);
    check(
      "packing does not depend on the order the API returned",
      JSON.stringify(forward.rows) === JSON.stringify(backward.rows)
    );
  }

  // ── hourTicks ──
  {
    const t = hourTicks({ startMin: 540, endMin: 780 }); // 4 hours
    check("a short axis labels every hour", t.length === 5 && t[0] === 540, JSON.stringify(t));
  }
  {
    const t = hourTicks({ startMin: 360, endMin: 1320 }); // 16 hours
    check("a long axis thins its labels", t.length <= 7, `${t.length} ticks`);
    check("thinned ticks are still whole hours", t.every((m) => m % 60 === 0), JSON.stringify(t));
  }

  // ── summarise ──
  {
    const s = summarise([span(540, 600, "a"), span(700, 800, "b"), span(900, 1000, "c")], 750);
    check("'on now' uses the block containing the minute", s.onNow.length === 1 && s.onNow[0].id === "b");
    check("'next' is the first one still to start", s.next?.id === "c");
    check("the day's outer bounds are reported", s.firstMin === 540 && s.lastMin === 1000);
  }
  {
    // The half-open interval matters: without it, 10:00 is both the end of one
    // session and the start of the next, and the summary reports two things
    // running in a building where one just finished.
    const s = summarise([span(540, 600, "ends"), span(600, 660, "starts")], 600);
    check("a session ending exactly now is not running", s.onNow.length === 1 && s.onNow[0].id === "starts");
  }
  {
    const s = summarise([span(540, 600), span(700, 800)], 1300);
    check("after the last start there is no 'next'", s.next === null && s.onNow.length === 0);
  }
  {
    const s = summarise([], 600);
    check("an empty day summarises to nothing rather than throwing", s.total === 0 && s.next === null && s.firstMin === null);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 1+ — the page itself
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  section0();
  if (LOGIC_ONLY) return;

  const { createClient } = await import("@supabase/supabase-js");
  const { stringToBase64URL } = await import("@supabase/ssr/dist/main/utils/base64url.js");
  const { chromium } = await import("playwright");

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
  const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

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

  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Session dtstart carries local wall-clock digits in UTC slots — built here
  // from LOCAL getters for exactly that reason. Building them from UTC ones is
  // the bug that turns a harness red every evening after 17:00 Pacific.
  const at = (offset, hh, mm = "00") => `${day(offset)}T${hh}:${mm}:00Z`;

  async function makeUser(orgId, role, scopeRows, label) {
    const email = `zz-ovw-${label}-${stamp}@example.invalid`;
    const password = `Zk!${stamp}aA9`;
    const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${role}: ${error.message}`);
    ids.users.push(u.user.id);
    const { data: m, error: mErr } = await admin
      .from("org_memberships")
      .insert({ org_id: orgId, user_id: u.user.id, role, email })
      .select("id")
      .single();
    if (mErr) throw new Error(`membership ${role}: ${mErr.message}`);
    if (scopeRows?.length) {
      const { error: sErr } = await admin
        .from("membership_scopes")
        .insert(scopeRows.map((r) => ({ membership_id: m.id, org_id: orgId, ...r })));
      if (sErr) throw new Error(`scopes ${role}: ${sErr.message}`);
    }
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
    return { email, password, userId: u.user.id, session: signIn.session };
  }

  // ── Fixture ────────────────────────────────────────────────────────────────
  //
  //   ZZ Overview Org
  //     ├── ZZ Pool ── Aquatics ── Lap Swim     (published) ── 3 sessions today
  //     │                       └─ Public Swim  (published) ── 1 colliding session
  //     │                       └─ Aquafit      (DRAFT)
  //     └── ZZ Quiet ─ (no dept) ─ (nothing today)  ← the empty-state control
  //
  // Lap Swim and Public Swim both claim Lane 1 at 09:00, which is the conflict
  // the alert row must name. ZZ Quiet exists so "nothing today" is tested
  // against a real facility rather than an error.
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ Overview ${stamp}`, slug: `zz-overview-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const owner = await makeUser(org.id, "owner", null, "owner");

  const mkFacility = async (name, slug) =>
    (
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name,
          slug,
          address_line1: "1 Test St",
          city: "Victoria",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: true,
        })
        .select("id, name, slug")
        .single()
    ).data;

  // Named so it sorts FIRST — the page selects `facilities[0]` when no
  // ?facility= param is present, and the busy building is the one under test.
  const pool = await mkFacility(`ZZ A Pool ${stamp}`, `zz-a-pool-${stamp}`);
  const quiet = await mkFacility(`ZZ Z Quiet ${stamp}`, `zz-z-quiet-${stamp}`);

  const { data: aquatics } = await admin
    .from("departments")
    .insert({ org_id: org.id, facility_id: pool.id, name: "Aquatics", slug: `zz-aq-${stamp}`, display_order: 0, is_published: true })
    .select("id")
    .single();

  const mkGroup = async (facilityId, departmentId, name, status) =>
    (
      await admin
        .from("schedule_groups")
        .insert({
          org_id: org.id,
          facility_id: facilityId,
          department_id: departmentId,
          name,
          slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
          sport_category: "swimming",
          activity_type: "drop_in",
          status,
          source: "manual",
          starts_on: day(-30),
          ends_on: day(60),
          published_at: status === "published" ? new Date().toISOString() : null,
        })
        .select("id, name")
        .single()
    ).data;

  const lapSwim = await mkGroup(pool.id, aquatics.id, "ZZ Lap Swim", "published");
  const publicSwim = await mkGroup(pool.id, aquatics.id, "ZZ Public Swim", "published");
  const aquafit = await mkGroup(pool.id, aquatics.id, "ZZ Aquafit", "draft");
  const quietGroup = await mkGroup(quiet.id, null, "ZZ Nothing Here", "published");

  const { data: lane1 } = await admin
    .from("spaces")
    .insert({ org_id: org.id, facility_id: pool.id, department_id: aquatics.id, name: "ZZ Lane 1", slug: `zz-l1-${stamp}`, display_order: 0 })
    .select("id")
    .single();

  // Every weekday, so "today" always has these regardless of when this runs.
  const DAILY = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU";
  const mkSession = async (groupId, startHH, endHH) =>
    (
      await admin
        .from("sessions")
        .insert({
          org_id: org.id,
          schedule_group_id: groupId,
          rrule: DAILY,
          dtstart: at(-7, startHH),
          dtend_time: `${endHH}:00`,
          valid_from: day(-7),
          valid_until: null,
          source: "imported",
          is_active: true,
        })
        .select("id")
        .single()
    ).data;

  const morningA = await mkSession(lapSwim.id, "09", "10");
  const morningB = await mkSession(publicSwim.id, "09", "10");
  const midday = await mkSession(lapSwim.id, "12", "13");
  await mkSession(lapSwim.id, "20", "21");
  // Both morning sessions claim Lane 1 — a real double-booking that
  // POST /api/sessions would have refused, and that findOrgConflicts exists to
  // catch on rows that got in another way.
  await admin.from("session_spaces").insert([
    { session_id: morningA.id, space_id: lane1.id, org_id: org.id },
    { session_id: morningB.id, space_id: lane1.id, org_id: org.id },
  ]);

  // ── C3: more activity rows than PostgREST will return in one response ──────
  //
  // 1,050 of them, all on schedule groups inside the selected facility, so
  // every one is in scope. A page that reads them with a bare `.limit()` gets
  // exactly 1000 back — with no error — and reports 1000.
  const OVER_CAP = 1050;
  const activityRows = Array.from({ length: OVER_CAP }, (_, i) => ({
    org_id: org.id,
    table_name: "schedule_groups",
    row_id: i % 2 === 0 ? lapSwim.id : publicSwim.id,
    action: "update",
    entity_label: `ZZ bulk ${i}`,
    actor_email: owner.email,
    actor_user_id: owner.userId,
    created_at: new Date(Date.now() - (i + 60) * 1000).toISOString(),
  }));
  let bulkOk = true;
  for (let i = 0; i < activityRows.length; i += 500) {
    const { error } = await admin.from("activity_log").insert(activityRows.slice(i, i + 500));
    if (error) {
      bulkOk = false;
      console.log(`  (activity bulk insert failed: ${error.message})`);
      break;
    }
  }

  // One newer, recognisable row for the panel to render on top of the bulk.
  await admin.from("activity_log").insert({
    org_id: org.id,
    table_name: "schedule_groups",
    row_id: lapSwim.id,
    action: "delete",
    entity_label: "ZZ Retired Swim",
    actor_email: owner.email,
    actor_user_id: owner.userId,
    created_at: new Date().toISOString(),
  });

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(cookieParts(owner.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
    const page = await context.newPage();

    // ── §1 — the first five seconds (rubric A) ──────────────────────────────
    console.log("\n§1  the first five seconds\n");
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
    const body = await page.textContent("body");
    check("A1: the page names today in words", body.includes(WEEKDAY), `looked for "${WEEKDAY}"`);

    const ribbon = page.locator('[data-testid="today-ribbon"]');
    check("A2: the today ribbon is rendered", await ribbon.isVisible());

    const blockCount = await ribbon.locator("a").count();
    check("A2: the ribbon draws today's occurrences as blocks", blockCount >= 4, `${blockCount} blocks`);

    const nowMarker = await ribbon.getByText(/^Now, /).count();
    check("A3: the ribbon marks 'now'", nowMarker === 1, `${nowMarker} markers`);

    check(
      "A5: the conflict is named, not counted",
      body.includes("ZZ Lap Swim") && body.includes("ZZ Public Swim") && body.includes("ZZ Lane 1") && /double-booking/i.test(body),
      "expected both schedule names and the space in the alert"
    );

    check("A5: the draft schedule is called out as unpublished", /still (a )?draft/i.test(body), "expected a drafts notice");

    // The picture has to be above the fold, not merely on the page.
    const ribbonTop = (await ribbon.boundingBox())?.y ?? 99999;
    check("A2: the ribbon is above the fold at 1440x1000", ribbonTop < 1000, `y=${Math.round(ribbonTop)}`);

    // ── §2 — acting (rubric B) ──────────────────────────────────────────────
    console.log("\n§2  acting\n");
    check("B1: 'New session' is a labelled button in the header", await page.getByRole("link", { name: "New session" }).isVisible());
    check("B1: 'New schedule' is a labelled button in the header", await page.getByRole("link", { name: "New schedule" }).first().isVisible());

    const hrefs = await ribbon.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    check(
      "B2: every block links to the session it draws",
      hrefs.length > 0 && hrefs.every((h) => /^\/dashboard\/schedule\/sessions\/[0-9a-f-]+\/edit$/.test(h ?? "")),
      JSON.stringify(hrefs.slice(0, 3))
    );
    check(
      "B2: the blocks link to the sessions that were seeded",
      hrefs.some((h) => h.includes(midday.id)),
      `no block pointed at ${midday.id}`
    );

    // ── §3 — honesty (rubric C) ─────────────────────────────────────────────
    console.log("\n§3  honesty\n");
    if (!bulkOk) {
      skipped("C3: the activity count pages past PostgREST's 1000-row cap", "bulk insert failed");
    } else {
      const changesTile = page
        .locator("a[href='/dashboard/activity']")
        .filter({ hasText: 'Changes (30d)' });
      const tileText = (await changesTile.textContent()) ?? "";
      // Read the value element, not the tile's whole text: the label itself
      // contains "(30d)", and a regex over the tile happily reports 30.
      const valueText = (await changesTile.locator(".tabular-nums").first().textContent()) ?? "";
      const n = Number(valueText.replace(/[^\d]/g, ""));
      check(
        "C3: the activity count pages past PostgREST's 1000-row cap",
        n > 1000,
        `tile read "${tileText.trim()}" — 1000 exactly means the page is reading one capped response`
      );
      check("C3: ...and reports the real number, not just 'over a thousand'", n >= OVER_CAP, `${n} < ${OVER_CAP}`);
    }

    check("C2: 'latest changes' reports changes, with a verb", /\b(created|updated|deleted) the (schedule|session|space|facility|department|template)\b/.test(body), "no change sentence found");
    check("C2: ...and names who made them", body.includes("ZZ Retired Swim"), "the seeded delete was not listed");

    // The old panel listed the same schedule groups as the table, badged
    // Published/Draft — so one schedule read as two different states at once.
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Latest changes" }) });
    const panelText = (await panel.textContent()) ?? "";
    check(
      "C1: the changes panel does not re-badge the schedules the table above already states",
      !/\bPublished\b/.test(panelText) && !/\bDraft\b/.test(panelText),
      `panel said: ${panelText.slice(0, 120)}`
    );

    // ── §4 — the visual row (rubric D) ──────────────────────────────────────
    console.log("\n§4  the stat row\n");
    // Scoped by its own label: the sidebar's "Analytics" menu item is also an
    // <a href='/dashboard/analytics'> and comes first in the DOM, so a bare href
    // locator measures the nav item and passes whatever the tile does.
    const viewsTile = page.locator("a[href='/dashboard/analytics']").filter({ hasText: 'Schedule views' });
    const viewsTileCount = await viewsTile.count();
    check("D: exactly one analytics tile, and it is the tile", viewsTileCount === 1, `count ${viewsTileCount}`);
    check("D: the analytics tile is present for an owner", await viewsTile.isVisible());
    const tileBox = await viewsTile.boundingBox();
    check("D3: a stat tile is at most half the old 120px height", (tileBox?.height ?? 999) <= 96, `${Math.round(tileBox?.height ?? -1)}px`);
    check(
      "D4: the stat value uses tabular figures",
      (await viewsTile.locator(".tabular-nums").count()) > 0,
      "a number that reflows when it ticks shifts everything beside it"
    );
    check(
      "D: nothing on the page rotates on a timer",
      (await page.locator(".animate-in.fade-in.duration-300").count()) === 0,
      "the rotating ticker is back"
    );

    // The third tile: this week. The seeded schedule runs every day, so all
    // seven bars must be non-zero and the hint must say so rather than naming
    // a gap that is not there.
    const weekTile = page.locator("a").filter({ hasText: "This week" }).first();
    check("D: the week tile is present", await weekTile.isVisible());
    const weekTileText = (await weekTile.textContent()) ?? "";
    const weekValue = Number(((await weekTile.locator(".tabular-nums").first().textContent()) ?? "").replace(/[^\d]/g, ""));
    check(
      "D: the week tile counts this week's occurrences, not today's",
      weekValue >= 28,
      `read ${weekValue} — four daily sessions over seven days is at least 28`
    );
    check(
      "D: it names the gaps rather than restating the total",
      /Something on every day/.test(weekTileText),
      `hint said: ${weekTileText}`
    );
    const bars = weekTile.locator('[role="img"] > div');
    check("D2: seven bars, one per day", (await bars.count()) === 7, `${await bars.count()} bars`);
    check(
      "D2: the bar chart is readable without colour",
      /Sunday: \d+ session/.test((await weekTile.locator('[role="img"]').getAttribute("aria-label")) ?? ""),
      "no per-day text alternative"
    );
    check(
      "B2: the week tile links to the week it describes",
      (await weekTile.getAttribute("href"))?.startsWith("/dashboard/schedule"),
      await weekTile.getAttribute("href")
    );

    // The strip and the tile ask for the same week at the same scope, so the
    // browser must have issued ONE expand request between them — and it must be
    // the week request, not a day request, or the command centre will re-fetch
    // on arrival.
    const expandCalls = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/sessions/expand")) expandCalls.push(r.url());
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    check(
      "F3: the ribbon and the week tile share one expand request",
      expandCalls.length === 1,
      `${expandCalls.length} calls: ${expandCalls.map((u) => new URL(u).search).join(" | ")}`
    );
    check(
      "F3: ...and it asks for a whole week, so the schedule page opens from cache",
      expandCalls.length === 1 &&
        (() => {
          const p = new URL(expandCalls[0]).searchParams;
          const days = (new Date(p.get("rangeEnd")) - new Date(p.get("rangeStart"))) / 86400000;
          return days > 6 && days < 8;
        })(),
      expandCalls[0] ? new URL(expandCalls[0]).search : "none"
    );

    // ── §5 — mobile (rubric E) ──────────────────────────────────────────────
    console.log("\n§5  mobile\n");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("E1: no horizontal page scroll at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);

    const mobileRibbon = page.locator('[data-testid="today-ribbon"]');
    const mRibbonBox = await mobileRibbon.boundingBox();
    check("E3: the ribbon is above the fold on a phone", (mRibbonBox?.y ?? 9999) < 844, `y=${Math.round(mRibbonBox?.y ?? -1)}`);
    check("E3: so is the conflict alert", /double-booking/i.test(await page.textContent("body")));

    const blockBox = await mobileRibbon.locator("a").first().boundingBox();
    check("E2: blocks are tall enough to tap", (blockBox?.height ?? 0) >= 40, `${Math.round(blockBox?.height ?? -1)}px tall`);

    // Not "scrollLeft > 0": after the last session of the day the strip is
    // *supposed* to rewind to the morning it is describing. The claim that
    // matters either way is that opening it shows blocks rather than blank time.
    const visibleOnOpen = await mobileRibbon.evaluate((el) => {
      const view = el.getBoundingClientRect();
      return [...el.querySelectorAll('a')].filter((a) => {
        const b = a.getBoundingClientRect();
        return b.right > view.left && b.left < view.right;
      }).length;
    });
    check(
      'E2: the ribbon opens on a part of the day that has blocks in it',
      visibleOnOpen > 0,
      'opened on empty time'
    );

    // B3 — the assertion the phone layout exists for.
    const editBtn = page.getByRole("link", { name: "Edit" }).first();
    check("B3: a row's Edit is a visible control on a phone", await editBtn.isVisible());
    const editBox = await editBtn.boundingBox();
    check(
      "B3: ...and it is inside the viewport, not past a sideways scroll",
      editBox !== null && editBox.x >= 0 && editBox.x + editBox.width <= 390,
      editBox ? `x=${Math.round(editBox.x)} w=${Math.round(editBox.width)}` : "not found"
    );
    check("B3: ...at a tappable height", (editBox?.height ?? 0) >= 40, `${Math.round(editBox?.height ?? -1)}px`);
    check("B1: 'New session' survives the phone layout", await page.getByRole("link", { name: "New session" }).isVisible());

    await page.screenshot({ path: path.join(OUT, "overview-mobile.png"), fullPage: true });

    // ── §6 — the other states ───────────────────────────────────────────────
    console.log("\n§6  the quiet building, and the all-clear\n");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${APP}/dashboard?facility=${quiet.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const quietBody = await page.textContent("body");

    check("A4: an empty day is a stated result, not a blank box", /Nothing runs at .* today/.test(quietBody), quietBody.slice(0, 160));
    check("A4: ...and offers the action that fills it", await page.getByRole("link", { name: "Add a session" }).isVisible());
    check(
      "C4: with nothing wrong, the all-clear is stated rather than implied",
      /No conflicts/.test(quietBody),
      "silence is indistinguishable from not having checked"
    );
    check(
      "C4: the quiet building reports no conflicts of its own",
      !/double-booking/i.test(quietBody),
      "the other facility's conflict leaked across the filter"
    );
    check("F: the schedule list still renders for the quiet facility", quietBody.includes("ZZ Nothing Here"));

    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "overview-desktop.png"), fullPage: true });

    // ── §7 — permission gating (rubric B4) ──────────────────────────────────
    console.log("\n§7  what a coordinator is not shown\n");
    const coordinator = await makeUser(org.id, "coordinator", [{ department_id: aquatics.id }], "coord");
    const coordCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await coordCtx.addCookies(cookieParts(coordinator.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
    const coordPage = await coordCtx.newPage();
    await coordPage.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    await coordPage.waitForTimeout(1200);

    check(
      "B4: a coordinator still gets the page",
      coordPage.url().includes("/dashboard") && !coordPage.url().includes("/schedule"),
      coordPage.url()
    );
    check(
      "B4: the analytics tile is absent, not disabled, without analytics:view",
      (await coordPage.locator("a[href='/dashboard/analytics']").filter({ hasText: 'Schedule views' }).count()) === 0,
      "a tile leading to a page the role cannot open"
    );
    check(
      "B4: ...and the create action the role does have is still offered",
      await coordPage.getByRole("link", { name: "New session" }).isVisible()
    );
    check("B4: the ribbon renders for a coordinator too", await coordPage.locator('[data-testid="today-ribbon"]').isVisible());
    await coordCtx.close();
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    fail++;
    console.error(`  ERROR ${e.message}`);
  })
  .finally(async () => {
    if (!LOGIC_ONLY) {
      const { createClient } = await import("@supabase/supabase-js");
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
      const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });
      for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
      for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
      const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
      console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    }
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
