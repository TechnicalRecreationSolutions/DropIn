/**
 * "Add space" after a save — the revived-form bug.
 *
 * Reported from the Spaces page: both the small "+ Add" and the large "Add
 * space" button opened a form already filled in with the lane last saved, and
 * stuck on "Saving…" with the button disabled, so nothing could be added.
 *
 * The cause is not the Spaces page. Next keeps a route segment mounted after
 * you navigate away (hidden, so back/forward is instant) and reuses that same
 * React instance when you return to the URL. /dashboard/facilities/<id>/spaces/new
 * is ONE url, so the second "Add space" lands back on the component that
 * submitted the first one — fields still populated, `loading` still true,
 * because it was only ever cleared on the error path.
 *
 * Which means the interesting assertion is not "the form is blank". It is
 * "the form is blank DESPITE the segment being reused". §1 is a positive
 * control that proves the reuse is still happening — if Next ever stops
 * retaining segments, §1 fails and the rest of this file stops being evidence
 * of anything.
 *
 *   npm run dev            (or: next start on another port, then --app=)
 *   node scripts/verify/verify-aq.mjs [--app=http://localhost:3000] [--headed]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ?? "http://localhost:3000";
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
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

function cookiePairs(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [[COOKIE_NAME, value]];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++)
    out.push([`${COOKIE_NAME}.${n}`, value.slice(i, i + MAX)]);
  return out;
}

const SUBMIT = 'button[type="submit"]';
const stamp = Date.now();
const ids = { orgs: [], users: [] };

console.log(`\nverify-aq — Add space after a save  (${APP})\n`);

try {
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ aq ${stamp}`, slug: `zz-aq-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const email = `zz-aq-${stamp}@example.invalid`;
  const password = `Zq!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  ids.users.push(userData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });

  const { data: facility } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ Pool ${stamp}`,
      slug: `zz-pool-${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();

  const { data: dept } = await admin
    .from("departments")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: "Aquatics",
      slug: `zz-dept-${stamp}`,
      display_order: 0,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: lane1 } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: dept.id,
      name: "Lane 1",
      slug: `zz-lane-1-${stamp}`,
      display_order: 1,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies(
    cookiePairs(signIn.session).map(([name, value]) => ({
      name,
      value,
      url: APP,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    }))
  );
  const page = await context.newPage();

  const SPACES = `${APP}/dashboard/spaces?facility=${facility.id}`;

  /**
   * The state of the form the user can actually see. Deliberately reads
   * `#name` across the whole document and picks the visible one: the retained
   * segment means more than one form is mounted, and asserting against the
   * first in DOM order would silently test the hidden one.
   */
  async function formState() {
    await page.waitForSelector("#name", { timeout: 15000 });
    return page.locator("#name").evaluateAll((els, submit) => {
      const el = els.find((e) => e.offsetParent !== null) ?? els[0];
      const root = el.closest("div.max-w-2xl");
      const btn = root?.querySelector(submit);
      return {
        name: el.value,
        button: btn?.textContent ?? "",
        disabled: !!btn?.disabled,
        mounted: els.length,
      };
    }, SUBMIT);
  }

  async function openSpacesPage() {
    await page.goto(SPACES, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Lane 1", { timeout: 15000 });
  }

  /**
   * Leave the form the way staff do — Cancel, a client-side navigation.
   *
   * `page.goto` would tear the whole React tree down and rebuild it, which
   * resets the form for free and hides the entire bug. Every step below has
   * to stay on soft navigation for the same reason.
   */
  async function cancelBackToSpaces() {
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForURL(/dashboard\/spaces/, { timeout: 15000 });
    await page.waitForSelector("text=Lane 1", { timeout: 15000 });
  }

  async function submitVisibleForm() {
    await page.locator(`${SUBMIT}:visible`).click();
    await page.waitForURL(/dashboard\/spaces/, { timeout: 20000 });
  }

  // -------------------------------------------------------------------
  // 1. POSITIVE CONTROL — the segment really is retained and reused.
  //    Type into the new-space form, leave WITHOUT saving, come back. If
  //    the text survives, this component was never remounted, which is the
  //    whole reason §2-§4 have to reset state by hand.
  // -------------------------------------------------------------------
  await openSpacesPage();
  await page.getByRole("link", { name: "Add space" }).click();
  await page.waitForURL(/spaces\/new/, { timeout: 15000 });
  await page.waitForSelector("#name", { timeout: 15000 });
  await page.fill("#name", "UNSAVED DRAFT");

  await cancelBackToSpaces();
  await page.getByRole("link", { name: "Add space" }).click();
  await page.waitForURL(/spaces\/new/, { timeout: 15000 });
  const control = await formState();
  check(
    "control: an unsaved draft survives leaving and returning (segment IS reused)",
    control.name === "UNSAVED DRAFT",
    `name=${JSON.stringify(control.name)} — if blank, Next no longer retains segments and this file proves nothing`
  );

  // -------------------------------------------------------------------
  // 2. A first create still works from that reused form.
  // -------------------------------------------------------------------
  await page.fill("#name", `Lane 2 ${stamp}`);
  await submitVisibleForm();
  await page.waitForSelector(`text=Lane 2 ${stamp}`, { timeout: 15000 });

  const { data: created } = await admin
    .from("spaces")
    .select("id")
    .eq("facility_id", facility.id)
    .eq("name", `Lane 2 ${stamp}`)
    .maybeSingle();
  check("the first space is actually written to the database", !!created);

  // -------------------------------------------------------------------
  // 3. THE BUG — opening "Add space" again. Both entry points, because the
  //    report named both.
  // -------------------------------------------------------------------
  await page.getByRole("link", { name: "Add space" }).click();
  await page.waitForURL(/spaces\/new/, { timeout: 15000 });
  const second = await formState();
  check(
    "2nd 'Add space': the name field is empty",
    second.name === "",
    `name=${JSON.stringify(second.name)}`
  );
  check(
    "2nd 'Add space': the button is not stuck on 'Saving…'",
    !/Saving/.test(second.button),
    `button=${JSON.stringify(second.button)}`
  );
  check("2nd 'Add space': the button is enabled", second.disabled === false);

  // A second space can genuinely be added — the end the user could not reach.
  await page.fill("#name", `Lane 3 ${stamp}`);
  await submitVisibleForm();
  const { data: third } = await admin
    .from("spaces")
    .select("id")
    .eq("facility_id", facility.id)
    .eq("name", `Lane 3 ${stamp}`)
    .maybeSingle();
  check("a SECOND space can be added back-to-back", !!third);

  // The small "+ Add" beside a department heading — same route, same bug.
  await page.locator(`a[href*="spaces/new?departmentId=${dept.id}"]`).first().click();
  await page.waitForURL(/spaces\/new/, { timeout: 15000 });
  const viaPlus = await formState();
  check(
    "small '+ Add': the name field is empty",
    viaPlus.name === "",
    `name=${JSON.stringify(viaPlus.name)}`
  );
  check(
    "small '+ Add': the button is enabled",
    viaPlus.disabled === false && !/Saving/.test(viaPlus.button),
    `button=${JSON.stringify(viaPlus.button)}`
  );
  check(
    "small '+ Add' still seeds the department it was clicked under",
    (await page.locator("#department_id:visible").inputValue()) === dept.id
  );

  // -------------------------------------------------------------------
  // 4. The edit form is reused too — saving an edit must not leave the
  //    editor disabled, or showing pre-save values, the next time that
  //    space is opened. Reached by clicking the chip, so the navigation is
  //    the client-side one the bug needs.
  // -------------------------------------------------------------------
  await cancelBackToSpaces();
  await page.getByRole("link", { name: "Edit Lane 1", exact: true }).click();
  await page.waitForURL(new RegExp(`spaces/${lane1.id}/edit`), { timeout: 15000 });
  await page.waitForSelector("#name", { timeout: 15000 });
  await page.fill("#name", `Lane 1 renamed ${stamp}`);
  await submitVisibleForm();

  await page.waitForSelector(`text=Lane 1 renamed ${stamp}`, { timeout: 15000 });
  await page.getByRole("link", { name: `Edit Lane 1 renamed ${stamp}`, exact: true }).click();
  await page.waitForURL(new RegExp(`spaces/${lane1.id}/edit`), { timeout: 15000 });
  const edit = await formState();
  check(
    "re-opening an edited space: the button is not stuck on 'Saving…'",
    !/Saving/.test(edit.button),
    `button=${JSON.stringify(edit.button)}`
  );
  check(
    "re-opening an edited space: it shows the SAVED name",
    edit.name === `Lane 1 renamed ${stamp}`,
    `name=${JSON.stringify(edit.name)}`
  );

  await browser.close();
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
