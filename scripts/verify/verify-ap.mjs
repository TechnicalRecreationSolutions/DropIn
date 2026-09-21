/**
 * Annual billing: the interval actually reaches Stripe, and is never offered
 * when it cannot be honoured.
 *
 * Before this change the pricing pages advertised a yearly figure on every tier
 * and `create-checkout` had no interval parameter at all — it passed a single
 * monthly price ID. The copy promised something no code path could charge.
 *
 * The risk in fixing it is not "does the toggle work". It is that the annual
 * price IDs **do not exist in Stripe yet**, so the feature has to ship dark and
 * turn on by configuration. That produces two states, and the dangerous one is
 * the *disabled* state, because it is what production runs today:
 *
 *  1. **Disabled must look like nothing happened.** No toggle, monthly
 *     checkout unchanged, and an annual request refused with an explanation
 *     rather than a 500 — a broken deployment and a not-yet-enabled feature
 *     must not look alike.
 *
 *  2. **Enabled must charge the right thing.** The toggle changes the price
 *     shown AND the interval in the request body. A toggle that repaints the
 *     card without changing the payload bills the customer monthly while the
 *     page says yearly, which is the worst outcome available here — so §3
 *     intercepts the actual POST rather than trusting the UI.
 *
 * Run twice, against a server started with and without the annual env vars:
 *
 *   node scripts/verify/verify-ap.mjs --app=http://localhost:3100 --expect=enabled
 *   node scripts/verify/verify-ap.mjs --app=http://localhost:3101 --expect=disabled
 *
 * `--headed` to watch it. `--shots=<dir>` to write screenshots.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";
const EXPECT =
  process.argv.find((a) => a.startsWith("--expect="))?.slice("--expect=".length) ?? "disabled";
const HEADED = process.argv.includes("--headed");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice(8) ?? null;

if (!["enabled", "disabled"].includes(EXPECT)) {
  console.error(`--expect must be "enabled" or "disabled", got "${EXPECT}"`);
  process.exit(2);
}

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
  const pairs = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++)
    pairs.push([`${COOKIE_NAME}.${n}`, value.slice(i, i + MAX)]);
  return pairs;
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

console.log(`\nverify-ap — annual billing (expecting: ${EXPECT})\n`);

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-ap ${stamp}`, slug: `zz-verify-ap-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-ap-${stamp}@example.invalid`;
  const password = `Zap!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  ids.users.push(userData.user.id);

  // OWNER, not "admin". Migration 055 retired `admin`, and billing:manage is
  // owner-only by design — a manager must not be able to start a checkout.
  // Several older harnesses still insert "admin" and would silently grant
  // nothing here.
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookiePairs = sessionCookiePairs(signIn.session);

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies(
    cookiePairs.map(([name, value]) => ({
      name,
      value,
      url: APP,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    }))
  );
  const page = await context.newPage();

  // ---------------------------------------------------------------------
  // 1. The billing page renders, and offers the interval choice only when
  //    the server can actually price it.
  // ---------------------------------------------------------------------
  await page.goto(`${APP}/dashboard/billing`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Current plan", { timeout: 15000 });

  const yearlyToggle = page.getByRole("radio", { name: "Yearly" });
  const toggleCount = await yearlyToggle.count();

  if (EXPECT === "enabled") {
    check("the Monthly/Yearly toggle is rendered", toggleCount === 1, `count=${toggleCount}`);
    check(
      "the 'Two months free' incentive is shown beside it",
      (await page.getByText("Two months free").count()) === 1
    );
  } else {
    check(
      "NO interval toggle when annual is unconfigured",
      toggleCount === 0,
      `count=${toggleCount}`
    );
  }

  // The yearly figure is a real published price, so it stays visible on the
  // cards in BOTH states — advertised is not the same as sellable.
  const bodyText = await page.locator("body").innerText();
  check("the Standard monthly price is shown", bodyText.includes("$249"));
  check("the Standard yearly price is still shown", bodyText.includes("$2,490"));

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SHOTS, `billing-${EXPECT}-monthly.png`),
      fullPage: true,
    });
  }

  // ---------------------------------------------------------------------
  // 2. Switching to Yearly repaints the card with the annual figure.
  // ---------------------------------------------------------------------
  if (EXPECT === "enabled") {
    await yearlyToggle.click();
    await page.waitForTimeout(150);
    const afterText = await page.locator("body").innerText();
    check("yearly selected: the /yr figure leads", afterText.includes("$2,490/yr"));
    check(
      "yearly selected: the monthly-equivalent comparison appears",
      afterText.includes("vs $2,988/year monthly"),
      "expected 249*12 = 2,988"
    );
    if (SHOTS) {
      await page.screenshot({
        path: path.join(SHOTS, "billing-enabled-yearly.png"),
        fullPage: true,
      });
    }
  }

  // ---------------------------------------------------------------------
  // 3. THE ONE THAT MATTERS: the interval in the actual request body.
  //    A toggle that repaints without changing the payload would bill
  //    monthly while the page says yearly.
  // ---------------------------------------------------------------------
  let capturedBody = null;
  await page.route("**/api/stripe/create-checkout", async (route) => {
    capturedBody = route.request().postDataJSON();
    // Abort rather than fulfil — we must not create a real Stripe session.
    await route.abort();
  });

  const switchButton = page.getByRole("button", { name: /Switch to Standard/ });
  if ((await switchButton.count()) > 0) {
    await switchButton.first().click();
    await page.waitForTimeout(400);
    check("the checkout request was made", capturedBody !== null);
    check(
      "it carries the legacy tier name Stripe prices",
      capturedBody?.tier === "pro",
      JSON.stringify(capturedBody)
    );
    check(
      `it carries interval="${EXPECT === "enabled" ? "year" : "month"}"`,
      capturedBody?.interval === (EXPECT === "enabled" ? "year" : "month"),
      JSON.stringify(capturedBody)
    );
  } else {
    check("a Switch to Standard button exists", false, "button not found");
  }

  // The interceptor above catches every call to this path, including the
  // direct fetches below — which then fail as "Failed to fetch" rather than
  // reaching the server. Remove it before testing the API itself.
  await page.unroute("**/api/stripe/create-checkout");

  // ---------------------------------------------------------------------
  // 4. The API refuses what the UI would not have offered.
  //    Posting past the UI must give a clear 400, never a 500 — a
  //    not-yet-enabled feature and a broken deployment must not look alike.
  // ---------------------------------------------------------------------
  const apiResult = await page.evaluate(async (app) => {
    const r = await fetch(`${app}/api/stripe/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "pro", interval: "year" }),
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      /* non-JSON error page */
    }
    return { status: r.status, body };
  }, APP);

  if (EXPECT === "disabled") {
    check(
      "annual POST is refused with 400, not 500",
      apiResult.status === 400,
      `status=${apiResult.status}`
    );
    check(
      "the refusal explains itself",
      typeof apiResult.body?.error === "string" &&
        apiResult.body.error.toLowerCase().includes("annual billing is not available"),
      JSON.stringify(apiResult.body)
    );
  } else {
    // Enabled: the guard must NOT fire. It is allowed to fail further on —
    // this harness configures placeholder price IDs, so Stripe itself rejects
    // them — and that failure is the proof the request got past the guard.
    const refusedAsUnavailable =
      apiResult.status === 400 &&
      String(apiResult.body?.error ?? "").toLowerCase().includes("not available");
    check(
      "annual POST is NOT refused as unavailable",
      !refusedAsUnavailable,
      `status=${apiResult.status} ${JSON.stringify(apiResult.body)}`
    );
  }

  // ---------------------------------------------------------------------
  // 5. An unknown interval is rejected by the schema, not coerced.
  // ---------------------------------------------------------------------
  const badInterval = await page.evaluate(async (app) => {
    const r = await fetch(`${app}/api/stripe/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "pro", interval: "decade" }),
    });
    return r.status;
  }, APP);
  check("an invalid interval is a 400", badInterval === 400, `status=${badInterval}`);

  // Backwards compatibility — a body with NO interval — is deliberately NOT
  // exercised live here. In the disabled configuration it would default to
  // month, pass every guard, and create a real Stripe Checkout session and
  // customer for a throwaway org. The zod `.default("month")` is covered by
  // the node assertions in this change instead (getStripePriceId's default
  // argument), and the check above proves the schema is being applied at all.

  await browser.close();
} catch (err) {
  console.error("\nharness error:", err.message);
  fail++;
} finally {
  // PostgrestFilterBuilder is thenable but not a Promise, so it has no
  // .catch() — awaiting inside try/catch is the shape that actually works.
  for (const id of ids.users) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      console.warn(`  cleanup: user ${id} not deleted`);
    }
  }
  for (const id of ids.orgs) {
    try {
      await admin.from("organizations").delete().eq("id", id);
    } catch {
      console.warn(`  cleanup: org ${id} not deleted`);
    }
  }
}

console.log(`\n${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
