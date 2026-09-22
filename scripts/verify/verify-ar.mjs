/**
 * "Add another one" — every page-level create form, not just spaces.
 *
 * Companion to verify-aq, which covers the Spaces page the bug was reported
 * from. The cause is not specific to spaces: under `cacheComponents` Next
 * hides a route segment on navigation instead of unmounting it and reuses the
 * same React instance when you return, so ANY form that sets a busy flag and
 * then navigates comes back holding the record it just saved, disabled on
 * "Saving…" forever. `/…/new` is one URL per form, so the second "Add" always
 * lands on the instance that submitted the first.
 *
 * Each form below is driven the same way: open it, save one record, open it
 * again, and assert the second form is blank and usable — then actually save
 * a second record, because "the field is empty" is not the same claim as "a
 * second one can be created".
 *
 * Every navigation after the first `goto` is a CLICK. A `page.goto` rebuilds
 * the React tree, which resets the form for free and hides the entire bug;
 * §0's control exists to prove the retention is really in play, so that the
 * passes below mean something.
 *
 *   npm run dev            (or: next start on another port, then --app=)
 *   node scripts/verify/verify-ar.mjs [--app=http://localhost:3000] [--headed]
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

const stamp = Date.now();
const ids = { orgs: [], users: [] };

console.log(`\nverify-ar — create forms reopened after a save  (${APP})\n`);

try {
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ ar ${stamp}`, slug: `zz-ar-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const email = `zz-ar-${stamp}@example.invalid`;
  const password = `Zr!${stamp}aA9`;
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
      name: `Aquatics ${stamp}`,
      slug: `zz-dept-${stamp}`,
      display_order: 0,
      is_published: true,
    })
    .select("id")
    .single();

  await admin.from("spaces").insert({
    org_id: org.id,
    facility_id: facility.id,
    department_id: dept.id,
    name: "Lane 1",
    slug: `zz-lane-1-${stamp}`,
    display_order: 1,
    is_published: true,
  });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
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

  /** The submit button of the form the user can actually see. */
  const submitButton = () => page.locator('form button[type="submit"]:visible').last();

  /**
   * Reads the visible form. `#name` is the first field of every form here,
   * and the visible-only filter matters: retention means a hidden copy of
   * another form can be in the document at the same time.
   */
  async function formState() {
    await page.waitForSelector("#name:visible", { timeout: 15000 });
    const name = await page.locator("#name:visible").inputValue();
    const btn = submitButton();
    return {
      name,
      button: (await btn.innerText()).trim(),
      disabled: await btn.isDisabled(),
    };
  }

  /**
   * Click a link and wait for the route to change. Always client-side.
   *
   * Filtered to visible elements: retention leaves earlier pages in the
   * document with `display: none`, so a bare selector can match a link on a
   * hidden page and the click then goes nowhere.
   */
  async function clickTo(selector, urlPattern) {
    const link = () => page.locator(selector).filter({ visible: true }).first();

    // Retried once. Several of these links live in a route's static shell,
    // which paints before the streamed body arrives — a click that lands in
    // that window is occasionally swallowed and the URL simply never changes.
    // A second click is enough, and failing the whole run over it would make
    // this file flaky rather than informative.
    for (const timeout of [8000, 20000]) {
      await link().click();
      try {
        await page.waitForURL(urlPattern, { timeout });
        return;
      } catch (err) {
        if (timeout !== 8000) throw err;
      }
    }
  }

  /**
   * Submit and wait until the URL actually changes.
   *
   * Not `waitForURL(<destination>)`: several of these forms live at a path
   * the destination pattern also matches (…/facilities/<id>/departments/new
   * contains "facilities"), so a pattern match resolves instantly and the
   * assertions race the POST. Leaving the form's own URL is the unambiguous
   * signal that the save went through.
   */
  async function submitAndLeave() {
    const btn = submitButton();
    if (await btn.isDisabled()) {
      // The exact shape of the bug: the button is stuck on "Saving…". Named
      // rather than waited on, so a failing run reports it instead of timing
      // out for 30 seconds against an element that will never be enabled.
      throw new Error(`submit is disabled (${JSON.stringify((await btn.innerText()).trim())})`);
    }
    const from = page.url();
    await btn.click();
    await page.waitForFunction((u) => location.href !== u, from, { timeout: 25000 });
  }

  /**
   * The shared shape: open the form, assert it is usable, fill it, save, then
   * open it again and assert it is STILL usable. `fill` gets the page and the
   * suffix to make the record's name unique.
   */
  async function addTwice(spec) {
    console.log(`\n  ${spec.label}`);
    try {
      await runAddTwice(spec);
    } catch (err) {
      // One broken form must not hide the other five — a failing run should
      // name every form that is wrong, not just the first.
      check(`${spec.label}: the flow completed`, false, String(err?.message ?? err).split("\n")[0]);
    }
  }

  async function runAddTwice({ label, listUrl, newLink, newUrl, fill, countSaved, returnToList }) {
    await page.goto(listUrl, { waitUntil: "networkidle" });

    await clickTo(newLink, newUrl);
    const first = await formState();
    check(`${label}: 1st open is blank`, first.name === "", `name=${JSON.stringify(first.name)}`);

    await fill(page, "one");
    await submitAndLeave();

    // Saving a schedule lands on that schedule, where the "Add schedule" link
    // is replaced by the schedule's own editor — one click on the facility
    // card is the way back to the list, and it stays a client-side
    // navigation, which is what this file is testing.
    if (returnToList) await clickTo(returnToList, /dashboard\//);

    await clickTo(newLink, newUrl);
    const second = await formState();
    check(`${label}: REOPENED form is blank`, second.name === "",
      `name=${JSON.stringify(second.name)}`);
    check(`${label}: REOPENED form is not stuck on "Saving…"`, !/Saving|Creating/.test(second.button),
      `button=${JSON.stringify(second.button)}`);

    await fill(page, "two");
    // Checked AFTER filling, not before: some of these forms legitimately
    // disable their button until the required fields are there, so "disabled
    // on an empty form" says nothing. What must be true is that a filled form
    // can be submitted.
    check(`${label}: REOPENED form can be submitted once filled`,
      (await submitButton().isDisabled()) === false);
    await submitAndLeave();

    const n = await countSaved();
    check(`${label}: BOTH records reached the database`, n === 2, `found ${n}`);
  }

  // -------------------------------------------------------------------
  // 0. POSITIVE CONTROL — the segment really is retained and reused.
  //    An unsaved draft must survive leaving and returning by clicking.
  //    If this fails, nothing below is evidence of anything.
  // -------------------------------------------------------------------
  await page.goto(`${APP}/dashboard/departments?facility=${facility.id}`, {
    waitUntil: "networkidle",
  });
  const DEPT_NEW = `a[href="/dashboard/facilities/${facility.id}/departments/new"]`;
  await clickTo(DEPT_NEW, /departments\/new/);
  await page.waitForSelector("#name:visible", { timeout: 15000 });
  await page.fill("#name:visible", "UNSAVED DRAFT");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(/dashboard\/(departments|facilities)/, { timeout: 15000 });
  await clickTo(DEPT_NEW, /departments\/new/);
  const control = await formState();
  check(
    "control: an unsaved draft survives leaving and returning (segment IS reused)",
    control.name === "UNSAVED DRAFT",
    `name=${JSON.stringify(control.name)} — if blank, Next no longer retains segments and this file proves nothing`
  );

  // -------------------------------------------------------------------
  // 1. Departments
  // -------------------------------------------------------------------
  await addTwice({
    label: "DepartmentForm",
    listUrl: `${APP}/dashboard/departments?facility=${facility.id}`,
    newLink: DEPT_NEW,
    newUrl: /departments\/new/,
    fill: async (p, n) => p.fill("#name:visible", `ZZ Dept ${n} ${stamp}`),
    countSaved: async () => {
      const { data } = await admin
        .from("departments")
        .select("id")
        .eq("facility_id", facility.id)
        .like("name", `ZZ Dept % ${stamp}`);
      return data?.length ?? 0;
    },
  });

  // -------------------------------------------------------------------
  // 2. Facilities — the one with state outside the `form` object (photos).
  // -------------------------------------------------------------------
  await addTwice({
    label: "FacilityForm",
    listUrl: `${APP}/dashboard/facilities`,
    newLink: 'a[href="/dashboard/facilities/new"]',
    newUrl: /facilities\/new/,
    fill: async (p, n) => {
      await p.fill("#name:visible", `ZZ Bldg ${n} ${stamp}`);
      await p.fill("#address_line1:visible", "2 Test St");
      await p.fill("#city:visible", "Victoria");
      await p.fill("#postal_code:visible", "V0V 0V0");
    },
    countSaved: async () => {
      const { data } = await admin
        .from("facilities")
        .select("id")
        .eq("org_id", org.id)
        .like("name", `ZZ Bldg % ${stamp}`);
      return data?.length ?? 0;
    },
  });

  // -------------------------------------------------------------------
  // 3. Schedules
  // -------------------------------------------------------------------
  await addTwice({
    label: "ScheduleGroupForm",
    listUrl: `${APP}/dashboard/schedule?facility=${facility.id}`,
    newLink: `a[href*="/facilities/${facility.id}/"][href$="/schedule-groups/new"]`,
    newUrl: /schedule-groups\/new/,
    returnToList: `a[href="/dashboard/schedule?facility=${facility.id}"]`,
    fill: async (p, n) => p.fill("#name:visible", `ZZ Sched ${n} ${stamp}`),
    countSaved: async () => {
      const { data } = await admin
        .from("schedule_groups")
        .select("id")
        .eq("facility_id", facility.id)
        .like("name", `ZZ Sched % ${stamp}`);
      return data?.length ?? 0;
    },
  });

  // -------------------------------------------------------------------
  // 4. Session templates
  // -------------------------------------------------------------------
  await addTwice({
    label: "SessionTemplateForm",
    listUrl: `${APP}/dashboard/sessions?facility=${facility.id}`,
    newLink: 'a[href^="/dashboard/sessions/new"]',
    newUrl: /sessions\/new/,
    fill: async (p, n) => p.fill("#name:visible", `ZZ Tmpl ${n} ${stamp}`),
    countSaved: async () => {
      const { data } = await admin
        .from("session_templates")
        .select("id")
        .eq("facility_id", facility.id)
        .like("name", `ZZ Tmpl % ${stamp}`);
      return data?.length ?? 0;
    },
  });

  // -------------------------------------------------------------------
  // 5. Sessions — no #name field; identified by its start date instead.
  // -------------------------------------------------------------------
  console.log("\n  SessionForm");
  const SESSION_NEW = 'a[href="/dashboard/schedule/sessions/new"]';
  const dateInput = () => page.locator('form input[type="date"]:visible').first();
  try {

    await page.goto(`${APP}/dashboard/schedule?facility=${facility.id}`, { waitUntil: "networkidle" });
    await clickTo(SESSION_NEW, /schedule\/sessions\/new/);
    await page.waitForSelector('form input[type="date"]:visible', { timeout: 15000 });

    const sessionFirst = {
      date: await dateInput().inputValue(),
      button: (await submitButton().innerText()).trim(),
      disabled: await submitButton().isDisabled(),
    };
    check(
      "SessionForm: 1st open has no start date",
      sessionFirst.date === "",
      `date=${JSON.stringify(sessionFirst.date)} button=${JSON.stringify(sessionFirst.button)}`
    );

    await dateInput().fill("2026-10-05");
    await submitAndLeave();

    await clickTo(SESSION_NEW, /schedule\/sessions\/new/);
    await page.waitForSelector('form input[type="date"]:visible', { timeout: 15000 });
    const sessionSecond = {
      date: await dateInput().inputValue(),
      button: (await submitButton().innerText()).trim(),
      disabled: await submitButton().isDisabled(),
    };
    check("SessionForm: REOPENED form has no start date", sessionSecond.date === "",
      `date=${JSON.stringify(sessionSecond.date)}`);
    check("SessionForm: REOPENED form is not stuck on \"Saving…\"", !/Saving/.test(sessionSecond.button),
      `button=${JSON.stringify(sessionSecond.button)}`);
    await dateInput().fill("2026-10-12");
    check("SessionForm: REOPENED form can be submitted once filled", (await submitButton().isDisabled()) === false);
    await submitAndLeave();

    const { data: sessions } = await admin
      .from("sessions")
      .select("id")
      .eq("org_id", org.id);
    check("SessionForm: BOTH sessions reached the database", (sessions?.length ?? 0) === 2,
      `found ${sessions?.length ?? 0}`);
  } catch (err) {
    check("SessionForm: the flow completed", false, String(err?.message ?? err).split("\n")[0]);
  }

  await browser.close();
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
