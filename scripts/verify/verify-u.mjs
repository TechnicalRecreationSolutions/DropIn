/**
 * Deleting a session template from the Session templates page — driven in a
 * real browser as a signed-in admin.
 *
 * The API (DELETE /api/session-templates/[id]) already existed and archives
 * rather than drops (is_active=false); what's new is the row's Delete button
 * and its confirm dialog. What can go wrong:
 *
 *   - **Cancel still deleting.** Asserted against the database, not the list —
 *     a list that merely hasn't refreshed would pass a UI-only check.
 *   - **Deleting the wrong row.** Two templates; only the clicked one goes.
 *   - **The list not refreshing.** The page is a server component; the row
 *     only disappears if router.refresh() re-runs the query.
 *   - **Taking placed sessions with it.** A session placed from the template
 *     must survive, still pointing at it.
 *   - **A second button breaking the phone layout.** Asserted at 390px.
 *
 *   npm run dev
 *   node scripts/verify/verify-u.mjs [--headed]
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

function sessionCookiePairs(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [[COOKIE_NAME, value]];
  const pairs = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) pairs.push([`${COOKIE_NAME}.${n}`, value.slice(i, i + MAX)]);
  return pairs;
}

const isoDate = (d) => d.toISOString().slice(0, 10);
const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture: two facility-wide templates, one session placed from the first");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-u ${stamp}`, slug: `zz-verify-u-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-u-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);
  ids.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookiePairs = sessionCookiePairs(signIn.session);
  const cookie = cookiePairs.map(([n, v]) => `${n}=${v}`).join("; ");

  const { data: facility, error: facErr } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ Rec Centre ${stamp}`,
      slug: `zz-verify-u-${stamp}`,
      address_line1: "1 Test St",
      city: "Vancouver",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();
  if (facErr) throw new Error(`facility insert: ${facErr.message}`);

  async function makeTemplate(name, order) {
    const { data, error } = await admin
      .from("session_templates")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: null,
        name,
        color: "#3B82F6",
        default_duration_minutes: 60,
        display_order: order,
      })
      .select("id")
      .single();
    if (error) throw new Error(`template insert: ${error.message}`);
    return data.id;
  }
  const nameA = `ZZ Lane Swim ${stamp}`;
  const nameB = `ZZ Aqua Fit ${stamp}`;
  const templateA = await makeTemplate(nameA, 0);
  const templateB = await makeTemplate(nameB, 1);

  const { data: scheduleGroup, error: sgErr } = await admin
    .from("schedule_groups")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: `ZZ Fall ${stamp}`,
      slug: `zz-verify-u-fall-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status: "published",
      source: "manual",
    })
    .select("id")
    .single();
  if (sgErr) throw new Error(`schedule group insert: ${sgErr.message}`);

  const today = new Date();
  const res = await fetch(`${APP}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      schedule_group_id: scheduleGroup.id,
      template_id: templateA,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      valid_from: isoDate(today),
      valid_until: null,
      dtstart: `${isoDate(today)}T10:00:00Z`,
      dtend_time: "11:00",
      space_ids: [],
    }),
  });
  const placed = await res.json().catch(() => ({}));
  check("a session was placed from template A", res.status < 300, `status=${res.status} ${JSON.stringify(placed)}`);

  const isActive = async (id) =>
    (await admin.from("session_templates").select("is_active").eq("id", id).single()).data?.is_active;

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
    const page = await context.newPage();
    const pageUrl = `${APP}/dashboard/sessions?facility=${facility.id}`;

    await page.goto(pageUrl, { waitUntil: "networkidle" });
    await page.getByText(nameA).waitFor({ state: "visible", timeout: 30000 });

    // ---------------------------------------------------------------
    console.log("\n1. Each row offers Delete");
    // ---------------------------------------------------------------
    check("control: both templates are listed", (await page.getByText(nameA).isVisible()) && (await page.getByText(nameB).isVisible()));
    const deleteA = page.getByRole("button", { name: `Delete ${nameA}` });
    check("template A has its own Delete button", await deleteA.isVisible());
    check("template B has its own Delete button", await page.getByRole("button", { name: `Delete ${nameB}` }).isVisible());

    // ---------------------------------------------------------------
    console.log("\n2. Cancel deletes nothing");
    // ---------------------------------------------------------------
    await deleteA.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    check("the dialog names the template", (await dialog.textContent())?.includes(nameA));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    check("after Cancel, template A is still active in the database", (await isActive(templateA)) === true);
    check("…and still listed", await page.getByText(nameA).isVisible());

    // ---------------------------------------------------------------
    console.log("\n3. Confirming deletes that template, and only that one");
    // ---------------------------------------------------------------
    await deleteA.click();
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await dialog.getByRole("button", { name: "Delete template" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    await page.getByText(nameA).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});

    check("template A is archived in the database (is_active=false)", (await isActive(templateA)) === false);
    check("template A is gone from the list without a reload", (await page.getByText(nameA).count()) === 0);
    check("template B is untouched in the database", (await isActive(templateB)) === true);
    check("…and still listed", await page.getByText(nameB).isVisible());

    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(nameB).waitFor({ state: "visible", timeout: 30000 });
    check("after a full reload A stays gone", (await page.getByText(nameA).count()) === 0);

    const { data: sessionsLeft } = await admin
      .from("sessions")
      .select("id, template_id, is_active")
      .eq("schedule_group_id", scheduleGroup.id);
    check(
      "the session placed from A survives, still linked to it",
      sessionsLeft?.length === 1 && sessionsLeft[0].template_id === templateA && sessionsLeft[0].is_active === true,
      JSON.stringify(sessionsLeft)
    );

    // ---------------------------------------------------------------
    console.log("\n4. On a phone, the row's two buttons fit");
    // ---------------------------------------------------------------
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phone.addCookies(cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
    const small = await phone.newPage();
    try {
      await small.goto(pageUrl, { waitUntil: "networkidle" });
      await small.getByText(nameB).waitFor({ state: "visible", timeout: 30000 });
      const deleteB = small.getByRole("button", { name: `Delete ${nameB}` });
      check("Delete is reachable at 390px", await deleteB.isVisible());
      const box = await deleteB.boundingBox();
      check("…and sits inside the viewport", box && box.x + box.width <= 390, JSON.stringify(box));
      const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check("the page does not scroll sideways", overflow <= 0, `overflow=${overflow}px`);
    } finally {
      await phone.close();
    }
  } finally {
    await browser.close();
  }
} catch (err) {
  fail++;
  console.error("\n  ERROR  the harness threw before finishing:\n", err);
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

  const { data: orgsLeft } = await admin.from("organizations").select("id, name").like("name", `%${stamp}%`);
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const usersLeft = (userList?.users ?? []).filter((u) => u.email?.includes(String(stamp)));
  console.log(
    `\nTeardown: ${orgsLeft?.length ?? 0} org(s), ${usersLeft.length} user(s) left over` +
      (orgsLeft?.length || usersLeft.length
        ? ` — LEAKED: ${[...(orgsLeft ?? []).map((o) => o.name), ...usersLeft.map((u) => u.email)].join(", ")}`
        : "")
  );
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
