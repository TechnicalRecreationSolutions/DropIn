/**
 * Pricing surfaces agree with the catalogue — and with each other.
 *
 * The pricing change (docs/PRICING.md) moved the billed unit to the facility,
 * replaced two tiers with four, and deleted a limit that metered a table
 * dropped 34 migrations ago. Everything here fails *silently*:
 *
 *   - **A page that hardcodes a figure.** The landing page, the billing page
 *     and the FAQ all state the trial length and the per-facility overage. They
 *     now read `TRIAL_PERIOD_DAYS` and `EXTRA_FACILITY_MONTHLY`, so the way to
 *     catch a regression is to change the catalogue and assert the *pages*
 *     moved. That is what section 1 does — it re-derives every expected figure
 *     from `plans.ts` rather than restating it, so a number typed into JSX
 *     instead of imported fails here and nowhere else.
 *   - **`free` rendering as the cheapest plan.** `subscriptions.plan_tier` can
 *     only hold `free | pro | enterprise` (migration 004's CHECK), so the
 *     catalogue keys are translated through `STORED_TIER_TO_PLAN`. The
 *     dangerous bug is the cheap one: `PLANS[plan_tier]` on a `free` row used
 *     to be a lookup that now misses, and the sloppy fix is to fall back to
 *     Starter — telling an unpaid org it is on a paid plan. Asserted in both
 *     directions: `free` must say "No active plan" *and* must not say Starter.
 *   - **Stale copy surviving.** Old prices and the dropped
 *     `programsPerFacility` limit ("5 schedules per facility", "5 staff
 *     members") would read as a deliberate product state rather than a leftover.
 *     Section 3 is the negative control: the new figures being present proves
 *     nothing if the old ones are still on the page next to them.
 *
 * The public pricing section is server-rendered, so plain HTTP reaches it. The
 * billing page needs a session, so it gets the usual service-role fixture and a
 * really signed-in admin — never the service role for the thing under test. The
 * FAQ *answers* need a browser: a closed Radix Collapsible renders no markup at
 * all, so section 2 asserts they are absent over HTTP and section 2b clicks
 * them open, the same split verify-n/verify-p make for a portalled Select.
 *
 *   npm run dev
 *   node scripts/verify/verify-t.mjs [--headed]
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

function sessionCookieHeader(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  }
  return chunks.join("; ");
}

/**
 * The catalogue, read from source rather than imported.
 *
 * These scripts are plain .mjs with no TypeScript loader, so `plans.ts` cannot
 * be imported. Parsing it keeps the expectations derived from the single source
 * instead of restated here — which is the whole point of the section-1 checks.
 */
function readCatalogue() {
  const src = fs.readFileSync("src/lib/stripe/plans.ts", "utf8");
  const num = (name) => {
    const m = src.match(new RegExp(`export const ${name} = (\\d+)`));
    if (!m) throw new Error(`could not read ${name} from plans.ts`);
    return Number(m[1]);
  };
  const tiers = {};
  // Each tier block: key, name, priceMonthly, priceAnnual, priceAnnualFrom, facilities.
  const blockRe =
    /^ {2}(\w+): \{\n {4}tier: "\w+",\n {4}name: "([^"]+)",\n[\s\S]*?priceMonthly: (null|\d+),[^\n]*\n {4}priceAnnual: (null|\d+),[^\n]*\n {4}priceAnnualFrom: (null|\d+),[^\n]*\n {4}limits: \{\n {6}facilities: (-?\d+),/gm;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    tiers[m[1]] = {
      name: m[2],
      priceMonthly: m[3] === "null" ? null : Number(m[3]),
      priceAnnual: m[4] === "null" ? null : Number(m[4]),
      priceAnnualFrom: m[5] === "null" ? null : Number(m[5]),
      facilities: Number(m[6]),
    };
  }
  return {
    tiers,
    trialDays: num("TRIAL_PERIOD_DAYS"),
    extraFacility: num("EXTRA_FACILITY_MONTHLY"),
  };
}

/** Matches `dollars()` in plans.ts — thousands separated, no decimals. */
const dollars = (cents) =>
  (cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 });

/**
 * Entity-decoded, whitespace-collapsed page text.
 *
 * Comments are stripped to *nothing*, before tags, and that ordering is the
 * whole reason this helper exists. React emits `<!-- -->` between adjacent text
 * nodes, so `$<!-- -->89` renders to a reader as `$89` — replacing it with a
 * space instead yields `$ 89` and every price assertion in section 1 fails
 * against a page that is perfectly correct. Cost an hour the first time.
 */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;|&#x2014;/g, "—")
    .replace(/&nbsp;|&#x20;/g, " ")
    .replace(/\s+/g, " ");
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const cat = readCatalogue();
  const tierKeys = Object.keys(cat.tiers);

  console.log(
    `\nCatalogue: ${tierKeys.length} tiers (${tierKeys.join(", ")}), ` +
      `trial ${cat.trialDays}d, extra facility $${dollars(cat.extraFacility)}/mo`
  );
  check(
    "plans.ts parsed four tiers (guards the parser itself)",
    tierKeys.length === 4,
    `parsed ${tierKeys.length}: ${tierKeys.join(", ") || "none"}`
  );

  // ---------------------------------------------------------------
  console.log("\n1. Public pricing section matches the catalogue");
  // ---------------------------------------------------------------
  const homeRes = await fetch(`${APP}/`, { headers: { Accept: "text/html" } });
  check("GET / is 200", homeRes.status === 200, `status ${homeRes.status}`);
  const home = textOf(await homeRes.text());

  for (const [key, t] of Object.entries(cat.tiers)) {
    check(`landing page names "${t.name}"`, home.includes(t.name));

    if (t.priceMonthly === null) {
      // Quoted tier: the floor must be published, not the word "custom" alone.
      check(
        `${t.name} shows its annual floor $${dollars(t.priceAnnualFrom)}`,
        home.includes(`From $${dollars(t.priceAnnualFrom)}/year`),
        "quoted tier must still anchor a number"
      );
    } else {
      check(
        `${t.name} shows $${dollars(t.priceMonthly)}/mo`,
        home.includes(`$${dollars(t.priceMonthly)}`)
      );
      check(
        `${t.name} shows $${dollars(t.priceAnnual)}/year`,
        home.includes(`$${dollars(t.priceAnnual)}/year`)
      );
      // Two months free is the published annual discount; assert the arithmetic
      // rather than the copy, so a price edited on one line only fails here.
      check(
        `${t.name} annual really is ten months of monthly`,
        t.priceAnnual === t.priceMonthly * 10,
        `${t.priceAnnual} vs ${t.priceMonthly * 10}`
      );
    }

    const expected =
      t.facilities === -1
        ? "Unlimited facilities"
        : t.facilities === 1
          ? "1 facility"
          : `Up to ${t.facilities} facilities`;
    check(`${t.name} states its facility allowance ("${expected}")`, home.includes(expected));
  }

  check(
    `trial length on the page comes from the catalogue (${cat.trialDays}-day)`,
    home.includes(`${cat.trialDays}-day free trial`),
    "a hardcoded number here would survive a catalogue change"
  );
  check(
    `overage rate on the page comes from the catalogue ($${dollars(cat.extraFacility)}/mo)`,
    home.includes(`then $${dollars(cat.extraFacility)}/mo each`)
  );
  // The allowance is a bold line above the capability list. Repeating it as the
  // first bullet too (as the cards first did) reads as two different terms.
  check(
    "the facility allowance is stated once per card, not twice",
    (home.match(/Up to 4 facilities/g) ?? []).length === 1,
    "allowance duplicated between the bold line and a bullet"
  );
  // The hero and the closing CTA both say "plans start at …", far from the
  // pricing section — which is how both kept saying $49 after the tiers moved.
  // Derived from the catalogue's cheapest published monthly price.
  const lowest = Math.min(
    ...Object.values(cat.tiers)
      .map((t) => t.priceMonthly)
      .filter((p) => p !== null)
  );
  const startsAt = (home.match(/Plans start at \$[\d,]+\/month/g) ?? []);
  check(
    `both "plans start at" lines quote the cheapest tier ($${dollars(lowest)})`,
    startsAt.length === 2 && startsAt.every((s) => s === `Plans start at $${dollars(lowest)}/month`),
    `found ${startsAt.length}: ${startsAt.join(" | ") || "none"}`
  );

  check(
    "the billed unit is named in the heading",
    /Priced by facility/.test(home),
    "the old heading promised per-facility pricing the tiers did not deliver"
  );
  check(
    "the unlimited list is stated once, not per card",
    home.includes("Unlimited on every plan") &&
      ["Departments", "Schedules", "Spaces", "Staff accounts"].every((i) => home.includes(i))
  );

  // ---------------------------------------------------------------
  console.log("\n2. FAQ answers the metric question");
  // ---------------------------------------------------------------
  check(
    "FAQ says what is charged for",
    home.includes("What exactly are we charged for?"),
    "the metric is the first thing a buyer asks"
  );
  check(
    "FAQ states splitting a schedule up costs nothing extra",
    home.includes("Do we pay more for splitting our schedule up?")
  );
  // The answers are inside a Radix Collapsible, which renders *nothing* for a
  // closed item — not hidden markup, absent markup. So they are unreachable
  // over HTTP and get a real browser below, the same split verify-n documents
  // for its portalled Select.
  check(
    "FAQ answers are genuinely absent from the HTML (justifies section 2b)",
    !home.includes("As many as you need"),
    "if these now render server-side, fold 2b back into this section"
  );

  // ---------------------------------------------------------------
  console.log("\n2b. FAQ answers, expanded in a real browser");
  // ---------------------------------------------------------------
  // Two of the answers state figures that come from the catalogue. A number
  // typed in by hand would read correctly today and silently contradict
  // plans.ts after the next price change, which is exactly the regression the
  // rest of this script exists to catch — so they need to be read rendered.
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const page = await browser.newPage();
    await page.goto(`${APP}/#faq`, { waitUntil: "domcontentloaded" });

    const expand = async (question) => {
      const trigger = page.getByRole("button", { name: new RegExp(question, "i") });
      await trigger.click();
      return page.locator("body").innerText();
    };

    const staffText = await expand("How many staff accounts do we get");
    check(
      "FAQ answer states staff accounts are unlimited",
      /As many as you need, on every plan/.test(staffText)
    );

    const cancelText = await expand("Is there a contract, or can we cancel");
    check(
      `FAQ answer carries the catalogue trial length (${cat.trialDays}-day)`,
      cancelText.includes(`${cat.trialDays}-day free trial to start`),
      "a hardcoded trial length here would survive a catalogue change"
    );

    const chargedText = await expand("What exactly are we charged for");
    check(
      `FAQ answer carries the catalogue overage rate ($${dollars(cat.extraFacility)})`,
      chargedText.includes(`$${dollars(cat.extraFacility)} a month each`)
    );
    check(
      "…and names the facility as the billed unit",
      /Facilities — the buildings you publish/.test(chargedText)
    );
    check(
      "…and lists what is not counted",
      /Nothing else is counted/.test(chargedText) &&
        /staff accounts/.test(chargedText)
    );
  } finally {
    await browser.close();
  }

  // ---------------------------------------------------------------
  console.log("\n3. Negative control: the superseded copy is gone");
  // ---------------------------------------------------------------
  // The new figures being present proves nothing while the old ones sit beside
  // them. `programsPerFacility` metered `programs`, dropped in migration 011.
  check(
    'no "schedules per facility" limit (metered a dropped table)',
    !/schedules per facility/i.test(home),
    "programsPerFacility survived"
  );
  check(
    "no staff-account cap",
    !/\d+ staff accounts?/i.test(home),
    "a seat cap produces a shared password, not an upgrade"
  );
  check(
    "the old $49 and $199 plan prices are gone",
    !/\$49\/mo|\$199\/mo/.test(home),
    "superseded price still published as a plan rate"
  );
  check(
    'the "Pro" tier name is gone from the public page',
    !/\bPro\b/.test(home),
    "renamed to Standard"
  );

  // ---------------------------------------------------------------
  console.log("\n4. Fixture: an org with no subscription row at all");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-t ${stamp}`, slug: `zz-verify-t-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-t-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);
  ids.users.push(userData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookieHeader(signIn.session);

  const billingOf = async () => {
    const res = await fetch(`${APP}/dashboard/billing`, {
      headers: { Cookie: cookie, Accept: "text/html" },
    });
    return { status: res.status, text: textOf(await res.text()) };
  };

  // ---------------------------------------------------------------
  console.log("\n5. No subscription row renders as no plan, not as the cheapest one");
  // ---------------------------------------------------------------
  let billing = await billingOf();
  check("GET /dashboard/billing is 200", billing.status === 200, `status ${billing.status}`);
  check(
    "an org with no subscription says 'No active plan'",
    billing.text.includes("No active plan")
  );
  check(
    "…and does NOT claim the org is on Starter",
    !/Current plan Starter/.test(billing.text),
    "falling back to the cheapest tier tells an unpaid org it is paying"
  );
  check(
    "all four tiers are offered",
    Object.values(cat.tiers).every((t) => billing.text.includes(t.name))
  );
  check(
    "no 'Manage subscription' button without a subscription",
    !billing.text.includes("Manage subscription"),
    "the Stripe portal has nothing to open"
  );

  // ---------------------------------------------------------------
  console.log("\n6. plan_tier 'free' is a state, not a plan");
  // ---------------------------------------------------------------
  // Written through the service role on purpose: this mirrors exactly what the
  // Stripe webhook does on `customer.subscription.deleted` (route.ts sets
  // plan_tier 'free'), and no user-facing route can produce the row.
  const { error: subErr } = await admin.from("subscriptions").insert({
    org_id: org.id,
    stripe_customer_id: `cus_zz_verify_t_${stamp}`,
    plan_tier: "free",
    status: "canceled",
  });
  if (subErr) throw new Error(`subscription insert: ${subErr.message}`);

  billing = await billingOf();
  check(
    "a cancelled 'free' row still says 'No active plan'",
    billing.text.includes("No active plan")
  );
  check(
    "…and still does not name a paid tier as current",
    !/Current plan (Starter|Standard|Multi-site|Enterprise)/.test(billing.text),
    "STORED_TIER_TO_PLAN must map free to null"
  );

  // ---------------------------------------------------------------
  console.log("\n7. Positive control: a paid row really does render as that plan");
  // ---------------------------------------------------------------
  // Without this, sections 5 and 6 would pass on a page that renders "No active
  // plan" unconditionally. 'pro' is the legacy stored value the database still
  // accepts; STORED_TIER_TO_PLAN maps it up to Standard.
  const { error: upErr } = await admin
    .from("subscriptions")
    .update({
      plan_tier: "pro",
      status: "active",
      stripe_subscription_id: `sub_zz_verify_t_${stamp}`,
    })
    .eq("org_id", org.id);
  if (upErr) throw new Error(`subscription update: ${upErr.message}`);

  billing = await billingOf();
  const standard = cat.tiers.standard;
  check(
    `legacy 'pro' maps up to ${standard.name} and renders as current`,
    new RegExp(`Current plan ${standard.name}`).test(billing.text),
    "the legacy bridge must not leave a paying org showing no plan"
  );
  check(
    "…shows that tier's price",
    billing.text.includes(`$${dollars(standard.priceMonthly)}/month`)
  );
  check(
    `…shows that tier's facility allowance (${standard.facilities})`,
    billing.text.includes(`up to ${standard.facilities} facilities`)
  );
  check(
    "…and now offers the Stripe portal",
    billing.text.includes("Manage subscription")
  );
  check(
    "'No active plan' is gone once a plan is active",
    !billing.text.includes("No active plan"),
    "proves sections 5-6 were reading real state, not static copy"
  );

  // ---------------------------------------------------------------
  console.log("\n8. Tiers without a Stripe price contact us instead of 400ing");
  // ---------------------------------------------------------------
  // Only STRIPE_PRICE_PRO_MONTHLY and STRIPE_PRICE_ENTERPRISE_MONTHLY exist, so
  // Starter and Enterprise have no price to check out against. A button there
  // would post a tier the route's zod enum rejects.
  const checkoutRes = await fetch(`${APP}/api/stripe/create-checkout`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ tier: "starter" }),
  });
  check(
    "POST create-checkout rejects a catalogue key the route does not price",
    checkoutRes.status === 400,
    `status ${checkoutRes.status} — the UI must not offer a button for this`
  );
  check(
    "billing page offers a contact route for the unpriced tiers",
    /Contact us/.test(billing.text),
    "an honest mailto beats a button that 400s"
  );

  // ---------------------------------------------------------------
  console.log("\n9. Terms disclose the billed unit and the trial");
  // ---------------------------------------------------------------
  const termsRes = await fetch(`${APP}/terms`, { headers: { Accept: "text/html" } });
  check("GET /terms is 200", termsRes.status === 200, `status ${termsRes.status}`);
  const terms = textOf(await termsRes.text());
  check(
    "terms say plans are priced by facility count",
    /priced by the number of facilities/.test(terms),
    "the metric is a material term of sale"
  );
  check(
    "terms disclose that unmetered things are unmetered",
    /are not metered/.test(terms)
  );
  check("terms mention the free trial", /free trial/.test(terms));
  check("terms mention yearly billing", /monthly or yearly/.test(terms));
} catch (err) {
  fail++;
  console.log(`\n  FAIL  fixture or run threw — ${err.message}`);
} finally {
  // ---------------------------------------------------------------
  console.log("\nTeardown");
  // ---------------------------------------------------------------
  for (const id of ids.orgs) {
    const { error } = await admin.from("organizations").delete().eq("id", id);
    console.log(`  org ${id}: ${error ? `ERROR ${error.message}` : "deleted"}`);
  }
  for (const id of ids.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(`  user ${id}: ${error ? `ERROR ${error.message}` : "deleted"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
