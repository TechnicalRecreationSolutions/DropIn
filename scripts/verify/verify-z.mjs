/**
 * The printable deck sheet (stage 4 of docs/PLAN-internal-view.md) — in a real
 * Chromium, because the thing under test is a **print** output and no `fetch()`
 * can see a page break, a repeating table header, or a hidden control.
 *
 * The sheet replaces a hand-built Excel grid that gets printed and posted on a
 * pool deck, so what it has to get right is unusual for this codebase:
 *
 *  1. The right claim in the right lane column, spanning the right number of
 *     rows. Asserting "the holder name is on the page" would pass with every
 *     booking piled into column one.
 *  2. Residual (drop-in) blocks are listed BELOW the grid and drawn in no lane
 *     column at all — they occupy whatever the exclusive claims leave, so a lane
 *     cell claiming one would be false. This is the design's central decision
 *     and section 3 is the assertion that pins it.
 *  3. Nothing is silently dropped: an exclusive booking with no space recorded
 *     cannot be drawn, and so gets its own section rather than vanishing.
 *  4. The print stylesheet actually applies — controls hidden under print media,
 *     `thead` promoted to `table-header-group` so page two has lane names — and
 *     the PDF is one landscape page for a four-space day.
 *  5. Staff-only data reaches it (holder names, setup notes as footnotes) and
 *     another org's admin gets their own building, never this one's names.
 *
 * Same fixture discipline as its siblings: service-role fixtures, real sessions
 * created through `POST /api/sessions`, a genuinely signed-in browser, positive
 * controls, teardown in a finally.
 *
 * Usage: node scripts/verify/verify-z.mjs [--app=http://localhost:3001] [--headed] [--shots=<dir>]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice("--shots=".length) ?? null;

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

async function api(pathname, cookieHeader, init = {}) {
  const res = await fetch(`${APP}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

// Distinctive enough that a substring search over a whole page proves presence
// or absence — "Reserved" or "Island Swimming" would not be.
const HOLDER = `ZZIslandSwimming${stamp}`;
const SETUP = `ZZSoftLaneRopesAndPoloNets${stamp}`;

// Monday. The sheet is one calendar day, so the fixture pins the exact date
// rather than depending on when the harness happens to run.
const DAY = "2026-10-05";

try {
  async function makeOrg(label) {
    const org = (
      await admin
        .from("organizations")
        .insert({ name: `ZZ ${label} ${stamp}`, slug: `zz-${label}-${stamp}`, status: "active" })
        .select("id")
        .single()
    ).data;
    ids.orgs.push(org.id);

    const email = `zz-${label}-${stamp}@example.invalid`;
    const password = `Zz!${stamp}aA9`;
    const { data: userData } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    ids.users.push(userData.user.id);
    await admin
      .from("org_memberships")
      .insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

    const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`${label} signIn: ${error.message}`);
    const pairs = sessionCookiePairs(signIn.session);
    return {
      orgId: org.id,
      cookiePairs: pairs,
      cookieHeader: pairs.map(([n, v]) => `${n}=${v}`).join("; "),
    };
  }

  const org1 = await makeOrg("verify-z");
  const org2 = await makeOrg("verify-z2");

  async function makeFacility(orgId, name, slug) {
    return (
      await admin
        .from("facilities")
        .insert({
          org_id: orgId,
          name,
          slug,
          address_line1: "1 Test St",
          city: "Vancouver",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: true,
        })
        .select("id, name")
        .single()
    ).data;
  }

  const pool = await makeFacility(org1.orgId, `ZZ Verify-Z Pool ${stamp}`, `zz-verify-z-pool-${stamp}`);
  const otherPool = await makeFacility(
    org2.orgId,
    `ZZ Verify-Z2 Arena ${stamp}`,
    `zz-verify-z2-arena-${stamp}`
  );

  const longCourse = (
    await admin
      .from("facility_configurations")
      .insert({ org_id: org1.orgId, facility_id: pool.id, name: "Long Course (50m)", display_order: 0 })
      .select("id, name")
      .single()
  ).data;
  const shortCourse = (
    await admin
      .from("facility_configurations")
      .insert({ org_id: org1.orgId, facility_id: pool.id, name: "Short Course (25m)", display_order: 1 })
      .select("id, name")
      .single()
  ).data;

  async function makeSpace(name, order, configurationId) {
    return (
      await admin
        .from("spaces")
        .insert({
          org_id: org1.orgId,
          facility_id: pool.id,
          name: `${name} ${stamp}`,
          slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${stamp}`,
          display_order: order,
          is_published: true,
          ...(configurationId ? { configuration_id: configurationId } : {}),
        })
        .select("id, name")
        .single()
    ).data;
  }

  const lane1 = await makeSpace("LC Lane 1", 0, longCourse.id);
  const lane2 = await makeSpace("LC Lane 2", 1, longCourse.id);
  const lane3 = await makeSpace("SC Lane 3", 2, shortCourse.id);
  const hotTub = await makeSpace("Hot Tub", 3, null);

  /**
   * TWO schedule groups, which is a fixture requirement and not decoration.
   * A session with no template displays its schedule group's name
   * (`sessionDisplayLabel`), so with everything under one group the drop-in
   * block, the short-course program and the closure all render the *same string*
   * — and section 3's "the drop-in block appears in no lane cell" then fails
   * against correct code, which is exactly how its first run failed. Real
   * facilities separate these too: a Lengths schedule and a Bookings schedule.
   */
  async function makeScheduleGroup(label) {
    return (
      await admin
        .from("schedule_groups")
        .insert({
          org_id: org1.orgId,
          facility_id: pool.id,
          name: `ZZ ${label} ${stamp}`,
          slug: `zz-${label.toLowerCase()}-${stamp}`,
          sport_category: "swimming",
          activity_type: "drop_in",
          status: "published",
          starts_on: "2026-10-01",
          ends_on: "2026-12-31",
          source: "manual",
        })
        .select("id, name")
        .single()
    ).data;
  }

  const lengths = await makeScheduleGroup("Lengths");
  const bookings = await makeScheduleGroup("Bookings");

  const base = {
    schedule_group_id: bookings.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    valid_from: DAY,
    valid_until: null,
  };

  async function createSession(overrides) {
    const res = await api("/api/sessions", org1.cookieHeader, {
      method: "POST",
      body: JSON.stringify({ ...base, ...overrides }),
    });
    if (res.status >= 300) {
      throw new Error(`fixture session failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return res.body.sessionId;
  }

  // Residual: the public drop-in block, on the two long-course lanes the rental
  // below also claims. Legal since migration 046, and the case the grid must NOT
  // draw in a lane column.
  await createSession({
    schedule_group_id: lengths.id,
    dtstart: `${DAY}T06:00:00Z`,
    dtend_time: "08:00",
    space_ids: [lane1.id, lane2.id],
    occupancy_kind: "drop_in",
    disclosure: "public",
  });

  // Exclusive, withheld, 90 minutes — three half-hour rows.
  await createSession({
    dtstart: `${DAY}T10:00:00Z`,
    dtend_time: "11:30",
    space_ids: [lane2.id],
    occupancy_kind: "rental",
    disclosure: "reserved",
    holder_name: HOLDER,
    setup_notes: SETUP,
  });

  // Short course, for the configuration filter.
  await createSession({
    dtstart: `${DAY}T10:00:00Z`,
    dtend_time: "11:00",
    space_ids: [lane3.id],
    occupancy_kind: "program",
    disclosure: "public",
  });

  // A closure on the every-configuration space.
  await createSession({
    dtstart: `${DAY}T13:00:00Z`,
    dtend_time: "14:00",
    space_ids: [hotTub.id],
    occupancy_kind: "closure",
    disclosure: "public",
  });

  // Exclusive with no space at all: undrawable, and must not disappear.
  await createSession({
    dtstart: `${DAY}T15:00:00Z`,
    dtend_time: "16:00",
    space_ids: [],
    occupancy_kind: "program",
    disclosure: "public",
  });

  const DECK = `${APP}/dashboard/schedule/deck?facility=${pool.id}&date=${DAY}`;

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addCookies(
      org1.cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
    );
    const page = await context.newPage();

    console.log("\n1. The sheet renders one day, with every space as a column");
    await page.goto(DECK, { waitUntil: "networkidle" });
    await page.locator(`[data-deck-sheet="${DAY}"]`).waitFor({ timeout: 30000 });
    check("the sheet is on screen for the requested day", await page.locator(`[data-deck-sheet="${DAY}"]`).isVisible());
    check(
      "headed with the building and the date",
      (await page.locator("h1").first().innerText()).includes(pool.name)
    );

    const columnIds = await page.locator("th[data-deck-space]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-deck-space"))
    );
    check(
      "all four spaces are columns, in display order, including the empty one",
      columnIds.join(",") === [lane1.id, lane2.id, lane3.id, hotTub.id].join(","),
      JSON.stringify(columnIds)
    );

    console.log("\n2. The exclusive claim lands in the right column, spanning the right rows");
    const rentalCell = page.locator(`td[data-deck-claim="${lane2.id}"]`, { hasText: HOLDER });
    check("the rental is drawn in its own lane's column", (await rentalCell.count()) === 1);
    check(
      "and in no other lane's column — the assertion that would pass if everything piled into column one",
      (await page.locator(`td[data-deck-claim="${lane1.id}"]`, { hasText: HOLDER }).count()) === 0
    );
    check(
      "a 90-minute booking spans three half-hour rows",
      (await rentalCell.getAttribute("rowspan")) === "3",
      `rowspan=${await rentalCell.getAttribute("rowspan")}`
    );
    check(
      "the holder name reaches the sheet — the staff-only field this whole view exists for",
      (await rentalCell.innerText()).includes(HOLDER)
    );
    check(
      "and the cell says what patrons see instead",
      (await rentalCell.innerText()).includes("Reserved"),
      await rentalCell.innerText()
    );

    console.log("\n3. Residual blocks are listed below the grid and drawn in no lane");
    const residual = page.locator("[data-deck-residual]");
    check(
      "the drop-in block is listed under the grid",
      (await residual.innerText()).includes(lengths.name),
      await residual.innerText()
    );
    const dropInInGrid = await page
      .locator("td[data-deck-claim]", { hasText: lengths.name })
      .count();
    check(
      "and appears in no lane cell — it holds whatever is left, so a cell claiming it would be false",
      dropInInGrid === 0,
      `${dropInInGrid} lane cells contained it`
    );
    check(
      "the closure is drawn, in the every-configuration space's column",
      (await page.locator(`td[data-deck-claim="${hotTub.id}"]`).count()) > 0
    );

    console.log("\n4. Nothing is silently dropped, and setup notes are footnotes");
    check(
      "an exclusive booking with no space recorded gets its own section",
      (await page.locator("[data-deck-unplaced]").count()) === 1
    );
    const notes = page.locator("[data-deck-notes]");
    check("the setup note is printed under the sheet", (await notes.innerText()).includes(SETUP));
    check(
      "numbered, and the claim carries the matching marker",
      (await rentalCell.locator("sup").innerText()).trim() === "1" &&
        (await notes.innerText()).includes("1."),
      `marker=${await rentalCell.locator("sup").innerText()}`
    );

    console.log("\n5. The print stylesheet — the only output that matters here");
    const printButton = page.getByRole("button", { name: "Print" });
    check("the Print control is there on screen", await printButton.isVisible());
    await page.emulateMedia({ media: "print" });
    check("…and gone under print media", !(await printButton.isVisible()));
    check("while the sheet itself stays", await page.locator(`[data-deck-sheet="${DAY}"]`).isVisible());
    const theadDisplay = await page
      .locator("table.deck-grid thead")
      .evaluate((el) => getComputedStyle(el).display);
    check(
      "the header repeats on every printed page (thead is a table-header-group)",
      theadDisplay === "table-header-group",
      `display=${theadDisplay}`
    );
    // Still under print media, deliberately. `page.pdf()` uses print CSS on its
    // own — but an explicit `emulateMedia({ media: "screen" })` anywhere before
    // it *overrides* that, and this harness's first run did exactly that: it
    // reported two pages measured against the screen stylesheet, which is a
    // number that means nothing about the printout. Leave the emulation alone
    // here, and take the measurement below in the same state.
    const pdf = await page.pdf({ printBackground: true });
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, "deck-sheet.pdf"), pdf);
      await page.screenshot({ path: path.join(SHOTS, "deck-sheet.png"), fullPage: true });
    }
    const pdfText = pdf.toString("latin1");
    const pageCount = (pdfText.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    // A failure should say *how far over* the sheet is, not only that it spilled.
    // Landscape Letter at 96dpi is 1056x816px and the @page margin takes ~38px
    // off each edge, so a sheet has ~740px of height to work with. This number is
    // what settled the time window in buildDeckSheet: the nominal 06:00-22:00
    // day measures 1022px here, which is why the sheet spans the scheduled day.
    const printedHeight = await page.evaluate(() => {
      const el = document.querySelector(".deck-sheet");
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    });
    check(
      "a four-space day prints on ONE page — a lane column orphaned onto page two fails the only test that matters",
      pageCount === 1,
      `pages=${pageCount}, sheet height=${printedHeight}px of ~740px usable`
    );
    const mediaBox = pdfText.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    check(
      "and in landscape, from the @page rule rather than a print-dialog setting",
      !!mediaBox && Number(mediaBox[1]) > Number(mediaBox[2]),
      mediaBox ? `${mediaBox[1]}x${mediaBox[2]}` : "no MediaBox found"
    );

    console.log("\n6. One sheet per state of the building (migration 048)");
    await page.goto(`${DECK}&configuration=${shortCourse.id}`, { waitUntil: "networkidle" });
    await page.locator(`[data-deck-sheet="${DAY}"]`).waitFor({ timeout: 30000 });
    check(
      "the short-course sheet keeps its own lane",
      (await page.locator(`th[data-deck-space="${lane3.id}"]`).count()) === 1
    );
    check(
      "drops the long-course lanes",
      (await page.locator(`th[data-deck-space="${lane1.id}"]`).count()) === 0
    );
    check(
      "keeps the every-configuration space, which exists either way",
      (await page.locator(`th[data-deck-space="${hotTub.id}"]`).count()) === 1
    );
    check(
      "and names the configuration in the header",
      (await page.locator(`[data-deck-sheet="${DAY}"] header`).innerText()).includes("Short Course (25m)")
    );

    // A stale link to a deleted (or another building's) configuration must not
    // print an empty sheet with no explanation.
    await page.goto(`${DECK}&configuration=${crypto.randomUUID()}`, { waitUntil: "networkidle" });
    await page.locator(`[data-deck-sheet="${DAY}"]`).waitFor({ timeout: 30000 });
    check(
      "an unknown configuration id falls back to every space rather than an empty sheet",
      (await page.locator("th[data-deck-space]").count()) === 4
    );

    console.log("\n7. It is staff-only, and it is your own building");
    const visitor = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(DECK, { waitUntil: "networkidle" });
    check(
      "a signed-out visitor is sent to /login by the proxy — the reason this route lives under /dashboard",
      new URL(visitorPage.url()).pathname === "/login",
      visitorPage.url()
    );
    const visitorHtml = await visitorPage.content();
    check("and gets no holder name in the response", !visitorHtml.includes(HOLDER));
    await visitor.close();

    const outsider = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await outsider.addCookies(
      org2.cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
    );
    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto(DECK, { waitUntil: "networkidle" });
    const outsiderHtml = await outsiderPage.content();
    check(
      "another org's admin asking for this facility id gets their OWN building, not this one",
      outsiderHtml.includes(otherPool.name) && !outsiderHtml.includes(pool.name),
      `own=${outsiderHtml.includes(otherPool.name)} theirs=${outsiderHtml.includes(pool.name)}`
    );
    check("and never the holder name", !outsiderHtml.includes(HOLDER));
    await outsider.close();
  } finally {
    await browser.close();
  }
} catch (e) {
  console.error("FATAL:", e);
  fail++;
} finally {
  for (const id of ids.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of ids.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const { data: leftover } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftover?.length ?? 0} org(s) left over${
      leftover?.length ? ` — ${leftover.map((o) => o.name).join(", ")}` : ""
    }`
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
