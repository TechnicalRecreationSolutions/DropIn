/**
 * Departments, rebuilt: a card grid to land on, and an edit page that is a
 * summary + three sections.
 *
 * The page it replaces was one column of three tall cards — name, seven days
 * of time inputs, a dozen holidays each with three radios — with three Save
 * buttons scattered down it. The claims under test are the ones that change:
 *
 *   1. The page answers "what does this department say?" before it asks
 *      anything: the name in the heading, the week in one line, the holidays
 *      counted — all above the fold.
 *   2. Sections are switched, not scrolled, and the open one is in the URL.
 *   3. Unsaved work is visible from the other sections and survives the switch
 *      (the panels are hidden, not unmounted).
 *   4. The new controls WRITE. A day's open/closed switch is the one to prove:
 *      it replaced "delete every window with the little x", so if it only
 *      changed the screen a department would stay open on a day that reads
 *      closed.
 *   5. The landing page's cards carry that department's own numbers — and say
 *      when its hours are missing, which is the one setup gap nothing else
 *      surfaces.
 *
 * Deliberately no assertion that a reload shows a just-saved value: `next dev`
 * serves cached segments for minutes (see docs/RESUME.md), and a red there
 * would be the dev server, not the page. The database is asked instead.
 *
 *   npm run dev
 *   node scripts/verify/verify-au.mjs [--headed] [--out=dir]
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
const YEAR = new Date().getUTCFullYear();

async function main() {
  const { error: hoursProbe } = await admin.from("department_hours").select("id").limit(1);
  const { error: holidayProbe } = await admin.from("department_holidays").select("id").limit(1);
  if (hoursProbe) {
    console.log("  migration 058: NOT applied — this page has nothing to edit. Apply it and re-run.");
    return;
  }
  const hasHolidays = !holidayProbe;
  console.log(`  migration 058: applied\n  migration 059: ${hasHolidays ? "applied" : "NOT applied — holiday assertions will skip"}\n`);

  const { data: org } = await admin.from("organizations")
    .insert({ name: `ZZ dept-edit ${stamp}`, slug: `zz-dept-edit-${stamp}`, status: "active" }).select("id").single();
  ids.orgs.push(org.id);

  const email = `zz-dept-edit-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });

  const { data: facility } = await admin.from("facilities").insert({
    org_id: org.id, name: `ZZ Crystal Pool ${stamp}`, slug: `zz-crystal-${stamp}`,
    address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id").single();

  const { data: department } = await admin.from("departments").insert({
    org_id: org.id, facility_id: facility.id, name: "Aquatics",
    slug: `zz-aq-${stamp}`, display_order: 0, is_published: true,
  }).select("id, name").single();

  // A sibling, so the holidays "Copy to…" has somewhere to go — and so the
  // landing page has a second card whose numbers must differ from the first's.
  const { data: fitness } = await admin.from("departments").insert({
    org_id: org.id, facility_id: facility.id, name: "Fitness",
    slug: `zz-fit-${stamp}`, display_order: 1, is_published: false,
  }).select("id").single();

  // Something to count. Inserted before the page is ever visited, so a card
  // showing zero cannot be blamed on a stale dev-server render.
  for (const name of ["ZZ Lap Swim", "ZZ Lessons"]) {
    await admin.from("schedule_groups").insert({
      org_id: org.id, facility_id: facility.id, department_id: department.id,
      name: `${name} ${stamp}`, slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      sport_category: "swimming", activity_type: "drop_in", status: "published", source: "manual",
    });
  }
  for (const name of ["Lane 1", "Lane 2", "Hot Tub"]) {
    await admin.from("spaces").insert({
      org_id: org.id, facility_id: facility.id, department_id: department.id,
      name, slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      display_order: 0, is_published: true,
    });
  }

  // A real week: weekdays 06:00-21:00, Saturday 08:00-18:00, Sunday closed.
  const hourRows = [];
  for (const day of [1, 2, 3, 4, 5]) {
    hourRows.push({ org_id: org.id, department_id: department.id, day_of_week: day, opens_at: "06:00", closes_at: "21:00" });
  }
  hourRows.push({ org_id: org.id, department_id: department.id, day_of_week: 6, opens_at: "08:00", closes_at: "18:00" });
  await admin.from("department_hours").insert(hourRows);

  // One holiday already answered, so the page opens with something to read and
  // nothing unsaved.
  if (hasHolidays) {
    await admin.from("department_holidays").insert({
      org_id: org.id, department_id: department.id,
      holiday_date: `${YEAR}-12-25`, name: "Christmas Day", observance: "closed",
    });
  }

  const editUrl = `${APP}/dashboard/facilities/${facility.id}/departments/${department.id}/edit`;

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addCookies(cookieParts(signIn.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
  const page = await context.newPage();

  try {
    // ── 1. It says what the department is, before asking anything ───────────
    console.log("\n1. The page reads before it edits");
    await page.goto(editUrl, { waitUntil: "networkidle" });

    const h1 = (await page.locator("h1").first().innerText()).trim();
    check("the heading is the department's name, not “Edit department”", h1 === department.name, h1);
    check(
      "the subtitle says which building it is in",
      (await page.locator("main").innerText()).includes(`Department in ZZ Crystal Pool ${stamp}`)
    );

    const tiles = page.locator("[data-summary-tile]");
    const summaryText = await page.locator("#panel-details").locator("xpath=../..").innerText();
    check("the week is summarised above the editors", /Mon–Fri\s*6:00 AM–9:00 PM/.test(summaryText), firstLines(summaryText));
    check("Saturday's different hours are in the same line", /Sat\s*8:00 AM–6:00 PM/.test(summaryText));
    check("Sunday reads as closed", /Sun closed/.test(summaryText));
    check("the published state is shown", summaryText.includes("Published"));
    if (hasHolidays) {
      check("the year's confirmed holidays are counted", /1 observed/.test(summaryText), firstLines(summaryText));
    } else {
      skipped("the year's confirmed holidays are counted", "059 not applied");
    }
    check("status, hours and holidays each get a tile", (await tiles.count()) === 3, `${await tiles.count()} tiles`);

    const detailsPanel = page.locator("#panel-details");
    const hoursPanel = page.locator("#panel-hours");
    const holidaysPanel = page.locator("#panel-holidays");
    check("the page opens on Details", await detailsPanel.isVisible());
    check("the other two sections are not in the way", !(await hoursPanel.isVisible()) && !(await holidaysPanel.isVisible()));

    // ── 2. Switching sections ───────────────────────────────────────────────
    console.log("\n2. Moving between sections");
    await page.getByRole("tab", { name: "Operating hours" }).click();
    check("the Operating hours tab opens that section", await hoursPanel.isVisible());
    check("and closes Details", !(await detailsPanel.isVisible()));
    check("the open section is in the URL", page.url().endsWith("#hours"), page.url());

    await page.reload({ waitUntil: "networkidle" });
    check("a reload lands back on the same section", await hoursPanel.isVisible());

    // The tile, not just the tab — the summary is meant to be the way in.
    await page.getByRole("tab", { name: "Details" }).click();
    await page.locator(`[data-summary-tile="Holidays ${YEAR}"]`).click();
    check("clicking the holidays tile opens the holidays section", await holidaysPanel.isVisible());

    // ── 3. Unsaved work is visible and survives a switch ────────────────────
    console.log("\n3. Unsaved work");
    await page.getByRole("tab", { name: "Operating hours" }).click();
    const saveHours = hoursPanel.getByRole("button", { name: /Save operating hours|^Saved$/ });
    check("Save is inert until something changes", await saveHours.isDisabled());

    const mondayOpens = hoursPanel.getByLabel("Monday window 1 opens");
    check("POSITIVE CONTROL: Monday opens at 06:00 to begin with", (await mondayOpens.inputValue()) === "06:00");
    await mondayOpens.fill("07:30");
    check("an edit enables Save", await saveHours.isEnabled());
    const hoursTabDot = page.getByRole("tab", { name: "Operating hours" }).locator('[aria-label="unsaved changes"]');
    check("the tab marks the section as unsaved", await hoursTabDot.isVisible());

    await page.getByRole("tab", { name: "Details" }).click();
    check(
      "another section says where the unsaved work is",
      (await page.locator("body").innerText()).includes("Unsaved changes in Operating hours")
    );
    await page.getByRole("tab", { name: "Operating hours" }).click();
    check("the edit survived the switch (panels are hidden, not unmounted)", (await mondayOpens.inputValue()) === "07:30");

    await hoursPanel.getByRole("button", { name: "Discard changes" }).click();
    check("Discard puts the saved value back", (await mondayOpens.inputValue()) === "06:00");
    // Polled, not sampled: the dot is cleared by an effect one render after
    // the click, and a single read can land in between.
    check("and clears the unsaved mark", await gone(hoursTabDot));

    // ── 4. The open/closed switch writes ────────────────────────────────────
    console.log("\n4. Closing a day, end to end");
    const before = await admin.from("department_hours").select("day_of_week").eq("department_id", department.id).eq("day_of_week", 6);
    check("POSITIVE CONTROL: Saturday has hours in the database", (before.data ?? []).length === 1);

    const saturday = hoursPanel.getByRole("switch", { name: "Saturday open" });
    await saturday.click();
    check("the switch closes the day", (await hoursPanel.getByLabel("Saturday window 1 opens").count()) === 0);
    await saturday.click();
    check(
      "re-opening it remembers the hours rather than inventing a default",
      (await hoursPanel.getByLabel("Saturday window 1 opens").inputValue()) === "08:00"
    );

    await saturday.click();
    await saveHours.click();
    await hoursPanel.getByText(/^Saved\.?$/).first().waitFor({ timeout: 15000 });

    const after = await admin.from("department_hours").select("day_of_week").eq("department_id", department.id).eq("day_of_week", 6);
    check("saving a closed day removes its rows", (after.data ?? []).length === 0, JSON.stringify(after.data));
    const untouched = await admin.from("department_hours").select("day_of_week, opens_at").eq("department_id", department.id).order("day_of_week");
    check("the rest of the week is untouched", (untouched.data ?? []).length === 5 && untouched.data.every((r) => r.opens_at.startsWith("06:00")), JSON.stringify(untouched.data));
    check("Save goes inert again once there is nothing to save", await saveHours.isDisabled());

    // ── 5. Holidays as one-line answers ─────────────────────────────────────
    console.log("\n5. Holidays");
    if (!hasHolidays) {
      skipped("the whole holidays section", "059 not applied");
    } else {
      await page.getByRole("tab", { name: "Holidays" }).click();
      const radios = await holidaysPanel.locator('input[type="radio"]').count();
      check("a decision is one control, not three radios per date", radios === 0, `${radios} radios`);

      const christmas = holidaysPanel.getByLabel(`What happens on Christmas Day`);
      check("the saved holiday comes back as it was left", (await christmas.inputValue()) === "closed");

      await christmas.selectOption("custom_hours");
      check(
        "choosing different hours reveals the times, in place",
        (await holidaysPanel.getByLabel("Christmas Day window 1 opens").count()) === 1
      );
      await christmas.selectOption("closed");

      const tickedBefore = await holidaysPanel.locator('input[type="checkbox"]:checked').count();
      await holidaysPanel.getByRole("button", { name: /Observe all \d+ statutory dates/ }).click();
      const tickedAfter = await holidaysPanel.locator('input[type="checkbox"]:checked').count();
      check("one click answers every statutory date", tickedAfter > tickedBefore, `${tickedBefore} → ${tickedAfter}`);

      const saveHolidays = holidaysPanel.getByRole("button", { name: /Save \d+ holidays? for \d{4}|^Saved$/ });
      await saveHolidays.click();
      await holidaysPanel.getByText(/^Saved \d+ for \d{4}\./).first().waitFor({ timeout: 15000 });

      const stored = await admin.from("department_holidays").select("holiday_date, observance").eq("department_id", department.id);
      check("every ticked date is stored", (stored.data ?? []).length === tickedAfter, `${stored.data?.length} rows for ${tickedAfter} ticks`);
      check("Christmas is still closed, not overwritten by the bulk tick",
        stored.data?.find((r) => r.holiday_date === `${YEAR}-12-25`)?.observance === "closed");
      check("the holidays section reads clean after saving", await saveHolidays.isDisabled());

      // Nothing about the week changed while answering a year of dates.
      const weekAfter = await admin.from("department_hours").select("id").eq("department_id", department.id);
      check("saving holidays does not touch the weekly hours", (weekAfter.data ?? []).length === 5);
    }

    // ── 6. The landing page the cards replaced a list on ────────────────────
    console.log("\n6. The Departments page");
    await page.screenshot({ path: path.join(OUT, "dept-edit-desktop.png"), fullPage: true });

    const listUrl = `${APP}/dashboard/departments?facility=${facility.id}`;
    await page.goto(listUrl, { waitUntil: "networkidle" });

    const card = (name) => page.locator(`[data-department-card="${name}"]`);
    const aquatics = card("Aquatics");
    const fitnessCard = card("Fitness");
    check("every department gets a card", (await aquatics.count()) === 1 && (await fitnessCard.count()) === 1);

    const aquaticsText = await aquatics.innerText();
    const fitnessText = await fitnessCard.innerText();
    check("a card says how many schedules are in it", /2 schedules/.test(aquaticsText), firstLines(aquaticsText, 6));
    check("and how many spaces", /3 spaces/.test(aquaticsText), firstLines(aquaticsText, 6));
    check(
      "POSITIVE CONTROL: the numbers are the department's own, not the page's",
      /0 schedules/.test(fitnessText) && /0 spaces/.test(fitnessText),
      firstLines(fitnessText, 6)
    );
    check("publish state is on the card", /Published/.test(aquaticsText) && /Draft/.test(fitnessText));

    // The footer is the call to action: a department with no hours says so, and
    // one with hours prints the same line the edit page does.
    check("a department with hours shows its week", /Mon–Fri\s*6:00 AM–9:00 PM/.test(aquaticsText), firstLines(aquaticsText, 6));
    check("a department with none is asked for them", /Set operating hours/.test(fitnessText), firstLines(fitnessText, 6));
    const setHours = fitnessCard.getByRole("link", { name: /Set operating hours/ });
    check(
      "and that CTA opens the hours section directly",
      (await setHours.getAttribute("href")) === `/dashboard/facilities/${facility.id}/departments/${fitness.id}/edit#hours`,
      await setHours.getAttribute("href")
    );

    check(
      "the card body opens the department's schedule",
      (await aquatics.getByRole("link").first().getAttribute("href")) ===
        `/dashboard/schedule?facility=${facility.id}&department=${department.id}`,
      await aquatics.getByRole("link").first().getAttribute("href")
    );
    check(
      "editing is still one click from the card",
      (await aquatics.getByRole("link", { name: "Edit Aquatics" }).getAttribute("href")) ===
        `/dashboard/facilities/${facility.id}/departments/${department.id}/edit`
    );
    check("deleting is still one click from the card", await aquatics.getByRole("button", { name: "Delete Aquatics" }).isVisible());
    check("the grid ends with an add tile", await page.getByRole("link", { name: "Add department" }).last().isVisible());

    // ── 7. On a phone ───────────────────────────────────────────────────────
    console.log("\n7. Phone width");
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    const listScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("the cards do not overflow at 390px", listScrollW <= 390, `scrollWidth ${listScrollW}`);
    await page.screenshot({ path: path.join(OUT, "departments-mobile.png"), fullPage: true });

    await page.goto(`${editUrl}#hours`, { waitUntil: "networkidle" });
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
    check("the day switches are reachable on a phone", await page.getByRole("switch", { name: "Monday open" }).isVisible());
    await page.screenshot({ path: path.join(OUT, "dept-edit-mobile.png"), fullPage: true });
  } finally {
    await browser.close();
  }
}

/** True once a locator matches nothing, within a second. */
async function gone(locator, timeout = 2000) {
  try {
    await locator.waitFor({ state: "detached", timeout });
    return true;
  } catch {
    return (await locator.count()) === 0;
  }
}

/** The first few lines of a panel's text, for a failure message that fits. */
function firstLines(text, n = 4) {
  return text.split("\n").slice(0, n).join(" / ");
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
