/**
 * The /find page, in a real browser (phase 3 of the directory plan in
 * docs/PLAN.md).
 *
 * What has to be proven:
 *
 *  1. **It shows the directory, and only the directory.** Two listed fixtures
 *     appear; an unlisted one from the same org does not.
 *  2. **"Use my location" really re-sorts.** The fixtures are named so that
 *     alphabetical order is the *opposite* of distance order from the mocked
 *     position — the unsorted order is the negative control, so a button that
 *     did nothing cannot pass. A blocked permission shows its message.
 *  3. **Search and sport filter narrow the list and live in the URL**:
 *     accent-insensitive, a reload keeps them, and "no matches" offers a way
 *     out.
 *  4. **Saving a centre survives a reload** and shows in "Your saved centres".
 *  5. **It works on a phone**: at 390 px nothing scrolls sideways, and a card
 *     opens the facility page.
 *  6. The nav links to /find, and the OpenStreetMap credit is on the page.
 *
 * Every fixture name carries the run stamp, and the list is searched by that
 * stamp, so real listed centres cannot change the counts.
 *
 *   node scripts/verify/verify-ag.mjs [--headed] [--app=http://localhost:3000] [--out=dir]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";
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

function sessionCookies(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  }
  return chunks.join("; ");
}

const stamp = Date.now();
const TAG = `ag${stamp}`;
const cleanup = { users: [], orgs: [] };

// Mocked resident position: downtown Victoria, BC.
const HERE = { latitude: 48.4284, longitude: -123.3656 };
// "Aardvark" sorts first by name but is ~60 km away; "Zephyr" is ~1 km away.
const FAR = { lat: 48.9, lng: -123.7 };
const NEAR = { lat: 48.435, lng: -123.37 };

const browser = await chromium.launch({ headless: !HEADED });

try {
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ Verify-AG Rec ${stamp}`, slug: `zz-verify-ag-${stamp}`, status: "active" })
    .select("id")
    .single();
  cleanup.orgs.push(org.id);

  const email = `zz-verify-ag-admin-${stamp}@example.invalid`;
  const password = `Zag!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  cleanup.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  const cookie = sessionCookies(signIn.session);

  const ADDRESS = { address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0" };
  const makeFacility = async (label, extra) => {
    const { data, error } = await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `${label} ${TAG}`,
        slug: `zz-${label.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
        ...ADDRESS,
        geocoded_at: new Date().toISOString(),
        is_published: true,
        ...extra,
      })
      .select("id, name, slug")
      .single();
    if (error) throw new Error(`facility ${label}: ${error.message}`);
    return data;
  };

  const far = await makeFacility("Aardvark Arena", { listed_in_directory: true, ...FAR });
  const near = await makeFacility("Zephyr Pool", {
    listed_in_directory: true,
    ...NEAR,
    city: "Montréal",
    province: "QC",
  });
  const hidden = await makeFacility("Hidden Hall", { listed_in_directory: false, ...NEAR });

  for (const [facilityId, sport] of [[near.id, "swimming"], [far.id, "hockey"]]) {
    const { error } = await admin.from("schedule_groups").insert({
      org_id: org.id,
      facility_id: facilityId,
      name: `ZZ ${sport} ${stamp}`,
      slug: `zz-${sport}-${stamp}`,
      sport_category: sport,
      activity_type: "drop_in",
      source: "manual",
      status: "published",
      starts_on: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    });
    if (error) throw new Error(`group: ${error.message}`);
  }

  // Direct inserts don't expire the directory cache; an app save does.
  const touch = await fetch(`${APP}/api/facilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: hidden.name, ...ADDRESS, is_published: true, listed_in_directory: false, photo_urls: [], facilityId: hidden.id }),
  });
  if (touch.status !== 200) throw new Error(`cache-expiring save failed: ${touch.status}`);
  // `next dev` applies the expiry ~100 ms after the save responds (see
  // verify-ah); a production build serves the new data at once.
  await new Promise((r) => setTimeout(r, 400));

  const names = async (page) =>
    page.locator('section[aria-labelledby="results-heading"] article h3').allInnerTexts().then((t) => t.map((s) => s.trim()));
  const settle = (page) => page.waitForTimeout(250);

  console.log("\n1. The directory, and only the directory");
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    geolocation: HERE,
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${APP}/find?q=${TAG}`, { waitUntil: "networkidle" });
  const listed = await names(page);
  check("both listed fixtures are shown", listed.length === 2, JSON.stringify(listed));
  check("the unlisted fixture is not", !listed.some((n) => n.startsWith("Hidden Hall")));
  check("the search box starts with the query from the URL", (await page.locator('input[type="search"]').inputValue()) === TAG);
  check("the count says 2 centres", await page.getByText("2 centres", { exact: true }).isVisible());

  console.log("\n2. Use my location re-sorts");
  check(
    "control: without location the list is alphabetical (far one first)",
    listed[0]?.startsWith("Aardvark") && listed[1]?.startsWith("Zephyr"),
    JSON.stringify(listed)
  );
  await page.getByRole("button", { name: "Use my location" }).click();
  await page.getByRole("button", { name: "Sorted by distance" }).waitFor({ timeout: 10000 });
  const sorted = await names(page);
  check("with location the near one comes first", sorted[0]?.startsWith("Zephyr"), JSON.stringify(sorted));
  const nearCard = page.locator("article", { hasText: "Zephyr Pool" });
  const farCard = page.locator("article", { hasText: "Aardvark Arena" });
  check("the near card shows a distance under 2 km", /· (\d+ m|1\.\d km)/.test(await nearCard.innerText()), await nearCard.innerText());
  check("the far card shows tens of kilometres", /· \d{2} km/.test(await farCard.innerText()), await farCard.innerText());
  check("the privacy note is shown", await page.getByText("only used on this device").isVisible());
  check("location does not go into the URL", !/lat|lng/.test(page.url()), page.url());
  await page.getByRole("button", { name: "Stop using it" }).click();
  await settle(page);
  check("stopping restores alphabetical order", (await names(page))[0]?.startsWith("Aardvark"));

  const deniedContext = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await deniedContext.clearPermissions();
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(`${APP}/find?q=${TAG}`, { waitUntil: "networkidle" });
  // Headless Chromium denies an ungranted permission without a prompt.
  await deniedPage.getByRole("button", { name: "Use my location" }).click();
  const deniedShown = await deniedPage
    .getByText(/Location is blocked|couldn’t get your location/)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("a blocked location shows a message instead of sorting", deniedShown);
  await deniedContext.close();

  console.log("\n3. Search and sport filter");
  await page.locator('input[type="search"]').fill(`montreal ${TAG}`);
  await settle(page);
  check("search ignores accents (montreal → Montréal)", JSON.stringify(await names(page)) === JSON.stringify([near.name]), JSON.stringify(await names(page)));
  check("the query is written to the URL", new URL(page.url()).searchParams.get("q") === `montreal ${TAG}`, page.url());

  await page.locator('input[type="search"]').fill(TAG);
  await page.getByRole("button", { name: "Hockey", exact: true }).click();
  await settle(page);
  check("the Hockey chip keeps only the hockey centre", JSON.stringify(await names(page)) === JSON.stringify([far.name]), JSON.stringify(await names(page)));
  check("the chip is marked pressed", (await page.getByRole("button", { name: "Hockey", exact: true }).getAttribute("aria-pressed")) === "true");
  check("the sport is written to the URL", new URL(page.url()).searchParams.get("sport") === "hockey");

  await page.reload({ waitUntil: "networkidle" });
  check("a reload keeps the query and sport", JSON.stringify(await names(page)) === JSON.stringify([far.name]), JSON.stringify(await names(page)));

  await page.getByRole("button", { name: "All sports" }).click();
  await page.locator('input[type="search"]').fill(`${TAG} nothingmatchesthis`);
  await settle(page);
  check("no matches shows the empty state", await page.getByText(/No centres match/).isVisible());
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await settle(page);
  check("clearing empties the search box and the URL", (await page.locator('input[type="search"]').inputValue()) === "" && !new URL(page.url()).searchParams.has("q"));

  console.log("\n4. Saved centres");
  await page.locator('input[type="search"]').fill(TAG);
  await settle(page);
  await page.getByRole("button", { name: `Save ${near.name}` }).click();
  check("the star is marked pressed", (await page.getByRole("button", { name: `Remove ${near.name} from saved` }).getAttribute("aria-pressed")) === "true");
  check("control: the saved strip is hidden while searching", !(await page.getByRole("heading", { name: "Your saved centres" }).isVisible()));
  await page.goto(`${APP}/find`, { waitUntil: "networkidle" });
  const savedStrip = page.locator('section[aria-labelledby="saved-heading"]');
  check("after a reload the saved centre is in “Your saved centres”", (await savedStrip.innerText().catch(() => "")).includes(near.name));
  check("…and not the one that wasn't saved", !(await savedStrip.innerText().catch(() => "")).includes(far.name));

  console.log("\n5. On a phone");
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: HERE,
    permissions: ["geolocation"],
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${APP}/find?q=${TAG}`, { waitUntil: "networkidle" });
  await phonePage.getByRole("button", { name: "Use my location" }).click();
  await phonePage.getByRole("button", { name: "Sorted by distance" }).waitFor({ timeout: 10000 });
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("nothing scrolls sideways at 390 px", overflow <= 0, `overflow=${overflow}px`);
  const starBox = await phonePage.getByRole("button", { name: `Save ${far.name}` }).boundingBox();
  check("the save button is at least 44 px", starBox && starBox.width >= 44 && starBox.height >= 44, JSON.stringify(starBox));
  await phonePage.screenshot({ path: `${OUT}/verify-ag-phone.png`, fullPage: true });

  await phonePage.getByRole("link", { name: near.name }).click();
  await phonePage.waitForURL(`**/facility/${near.slug}`, { timeout: 15000 });
  check("tapping a card opens the facility page", phonePage.url().endsWith(`/facility/${near.slug}`), phonePage.url());
  await phone.close();

  console.log("\n6. Nav and attribution");
  await page.goto(`${APP}/find?q=${TAG}`, { waitUntil: "networkidle" });
  check("the nav links to /find", (await page.locator('header a[href="/find"]').count()) > 0);
  const credit = page.getByRole("link", { name: /OpenStreetMap contributors/ });
  check("the OpenStreetMap credit links to its copyright page", (await credit.getAttribute("href")) === "https://www.openstreetmap.org/copyright");
  await page.screenshot({ path: `${OUT}/verify-ag-desktop.png`, fullPage: true });
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await context.close();
} catch (e) {
  fail++;
  console.log(`  FAIL  harness error — ${e.message}`);
} finally {
  await browser.close();
  for (const id of cleanup.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: leftover } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
  console.log(`\nTeardown: ${leftover?.length ?? 0} org(s) left over`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
