/**
 * Widget schedule switcher — the half of migration 043 that `verify-n` could
 * not reach.
 *
 * `verify-n` proved the scopes are saved, RLS-gated and rendered, and that the
 * header bar shows a dropdown with the right default. It stops there on
 * purpose: the dropdown is a Radix Select, whose options are portal-rendered
 * on click and simply do not exist in the HTML a `fetch()` returns. So the one
 * thing the feature exists for — a visitor picking a different schedule and
 * seeing different sessions — was never actually exercised.
 *
 * That gap matters more than it sounds. Everything up to the click can work
 * while the click itself does nothing: the option list is built from
 * `scopeOptions`, but the *data* comes from `useTemplateSchedule` keyed on the
 * active scope's facility/department/schedule ids. A wiring mistake between
 * `onScopeChange` and that query would leave a dropdown that changes its own
 * label and nothing else — which looks entirely correct in a screenshot.
 *
 * So this drives a real Chromium, signed out, the way a visitor on an org's
 * website meets the embed, and asserts the mechanism rather than the label:
 *
 *   - The default scope's sessions are on screen and the other scope's are
 *     not. Both directions, because "the right sessions are showing" is only
 *     meaningful alongside "the wrong ones are not".
 *   - The switcher offers both published scopes and never the one whose
 *     facility is unpublished, and names the building behind the active one.
 *   - Picking the second scope swaps the rendered sessions, *and* issues a
 *     fresh `/api/sessions/expand` carrying that scope's schedule group id.
 *     The network assertion is what separates "the query re-ran" from "the
 *     label changed".
 *
 * The switcher was a Radix Select at every size when this was written, which
 * is why the header talks about portals; at three scopes it is now a pill row
 * (`ScheduleScopeSwitcher` swaps to a Select at five or more), so the options
 * are in the DOM without a click. The reason a browser is still required is
 * unchanged: only a real click proves the *data* follows the selection.
 *   - Switching back restores the first scope's sessions, so the switch is a
 *     filter and not a one-way latch.
 *
 * Two fixture details are load-bearing and were both found by this harness
 * failing first:
 *
 *   - Sessions carry no template, so each one renders its schedule group's
 *     name (`templateName ?? scheduleGroupName` in WeeklyScheduleList). That
 *     gives each scope a distinct, assertable string on screen.
 *   - Anonymous callers only see weeks an admin has *approved* (migration
 *     037, `filterUnapprovedPublicWeeks`). Without approved
 *     `schedule_week_reviews` rows the widget renders an empty schedule and
 *     every assertion below fails for a reason that has nothing to do with
 *     the dropdown.
 *
 * It passed on its first run, which is exactly when a browser test deserves
 * suspicion, so it was checked against a deliberately broken build: replacing
 * `onScopeChange={setSelectedScopeId}` with a no-op — the precise failure this
 * exists to catch — turns section 4 red on all four assertions and leaves the
 * rest green. Section 5 keeps passing under that mutation, which is correct:
 * "switching back works" cannot fail if switching never happened, so section 4
 * is the discriminating one.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, the real
 * routes, teardown in a `finally`.
 *
 *   npm run dev
 *   node scripts/verify/verify-p.mjs
 *
 * Pass --headed to watch it drive the browser.
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

async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const isoDate = (d) => d.toISOString().slice(0, 10);

/** Sunday-anchored, matching `sessionWeekStart` in src/lib/utils/dates.ts. */
function weekStartOf(date) {
  // LOCAL calendar date, parked at UTC midnight so isoDate() reads the same
  // digits back. Reading `date` with UTC getters here is the bug that turned
  // this harness red every day after 17:00 Pacific: the app decides which week
  // to render with local getters (getWeekStart in src/lib/utils/dates.ts), so
  // once UTC has crossed midnight the fixture writes its sessions into a week
  // the page is not showing — a whole week off, on a Saturday evening. See the
  // note in README.md.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture: two published chains, each with its own daily session");
  // ---------------------------------------------------------------
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-p ${stamp}`, slug: `zz-verify-p-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(org.id);

  const email = `zz-verify-p-${stamp}@example.invalid`;
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
    .insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  /** A published facility → department → schedule group → space → session. */
  async function makeChain(label, published = true, inFacility = null) {
    const { data: facility } = inFacility ? { data: inFacility } : await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ ${label} Building ${stamp}`,
        slug: `zz-verify-p-${label.toLowerCase()}-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: published,
      })
      .select("id, name")
      .single();

    const { data: department } = await admin
      .from("departments")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: `ZZ ${label} Dept ${stamp}`,
        slug: `zz-verify-p-${label.toLowerCase()}-dept-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single();

    // The name that ends up on each session row on screen, since these
    // sessions have no template.
    const scheduleName = `ZZ ${label} Schedule ${stamp}`;
    const { data: scheduleGroup } = await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: scheduleName,
        slug: `zz-verify-p-${label.toLowerCase()}-sched-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        source: "manual",
      })
      .select("id")
      .single();

    const { data: space } = await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: `ZZ ${label} Space ${stamp}`,
        slug: `zz-verify-p-${label.toLowerCase()}-space-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single();

    // Daily from three days ago, open-ended: whichever day the harness runs,
    // and whichever week boundary the browser lands on, there is an
    // occurrence on screen.
    const from = new Date(Date.now() - 3 * 86400000);
    const created = await api("/api/sessions", cookie, {
      method: "POST",
      body: JSON.stringify({
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=DAILY",
        valid_from: isoDate(from),
        valid_until: null,
        dtstart: `${isoDate(from)}T09:00:00Z`,
        dtend_time: "10:00",
        space_ids: [space.id],
      }),
    });
    if (created.status >= 300) {
      throw new Error(`${label} session create: ${created.status} ${JSON.stringify(created.body)}`);
    }

    // Anonymous visitors only see weeks an admin approved (migration 037).
    // Cover last/this/next week so a run near a boundary still works.
    const today = new Date();
    for (const offset of [-7, 0, 7]) {
      const anchor = new Date(today.getTime() + offset * 86400000);
      await admin.from("schedule_week_reviews").insert({
        org_id: org.id,
        schedule_group_id: scheduleGroup.id,
        week_start: isoDate(weekStartOf(anchor)),
        status: "approved",
        reviewed_by: userData.user.id,
        reviewed_at: new Date().toISOString(),
      });
    }

    return { facility, department, scheduleGroup, scheduleName, departmentName: `ZZ ${label} Dept ${stamp}` };
  }

  const gym = await makeChain("Gym");
  const pool = await makeChain("Pool");
  const draft = await makeChain("Draft", false); // unpublished facility

  check("two published chains and one unpublished chain built", !!gym && !!pool && !!draft);

  // The gym scope is facility-wide, so the visitor's Department and Schedule
  // dropdowns are built from what that building really has (expandScopes in
  // /widget/[orgId]). A second live department to narrow between, and three
  // things that must never be offered: a draft department (with a published
  // schedule, so "no schedules" isn't what hides it), a draft schedule and an
  // ended one in the gym's own department.
  const courts = await makeChain("Courts", true, gym.facility);
  const hiddenDeptName = `ZZ Hidden Dept ${stamp}`;
  const { data: hiddenDept } = await admin
    .from("departments")
    .insert({ org_id: org.id, facility_id: gym.facility.id, name: hiddenDeptName, slug: `zz-verify-p-hidden-dept-${stamp}`, is_published: false })
    .select("id")
    .single();
  const hiddenNames = {
    inHiddenDept: `ZZ Hidden Dept Schedule ${stamp}`,
    draft: `ZZ Draft Schedule ${stamp}`,
    ended: `ZZ Ended Schedule ${stamp}`,
  };
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  for (const [key, departmentId, status, ends_on] of [
    ["inHiddenDept", hiddenDept.id, "published", null],
    ["draft", gym.department.id, "draft", null],
    ["ended", gym.department.id, "published", yesterday],
  ]) {
    await admin.from("schedule_groups").insert({
      org_id: org.id,
      facility_id: gym.facility.id,
      department_id: departmentId,
      name: hiddenNames[key],
      slug: `zz-verify-p-${key.toLowerCase()}-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status,
      ends_on,
      source: "manual",
    });
  }
  check("facility-wide fixture: a second department plus three hidden ones built", !!courts && !!hiddenDept);

  // ---------------------------------------------------------------
  console.log("\n1. Save three scopes; the list view so each session shows its schedule name");
  // ---------------------------------------------------------------
  const gymLabel = `ZZ Gym Filter ${stamp}`;
  const poolLabel = `ZZ Pool Filter ${stamp}`;
  const draftLabel = `ZZ Draft Filter ${stamp}`;

  const saved = await api("/api/widget-config", cookie, {
    method: "PATCH",
    body: JSON.stringify({
      allowed_templates: ["list"],
      scopes: [
        { label: gymLabel, facilityId: gym.facility.id },
        {
          label: poolLabel,
          facilityId: pool.facility.id,
          scheduleGroupId: pool.scheduleGroup.id,
        },
        { label: draftLabel, facilityId: draft.facility.id },
      ],
    }),
  });
  check("PATCH /api/widget-config saved 3 scopes", saved.status === 200 && saved.body?.scopes?.length === 3, JSON.stringify(saved.body));

  // ---------------------------------------------------------------
  console.log("\n2. The embed, in a real browser, signed out");
  // ---------------------------------------------------------------
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    // No cookies: this is a stranger on the org's website, not staff.
    const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const page = await context.newPage();

    const expandRequests = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/sessions/expand")) expandRequests.push(r.url());
    });

    await page.goto(`${APP}/widget/${org.id}`, { waitUntil: "networkidle" });

    const gymSession = page.getByText(gym.scheduleName).first();
    const poolSession = page.getByText(pool.scheduleName).first();

    await gymSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});

    check("defaults to the first scope: its sessions are on screen", await gymSession.isVisible());
    check(
      "…and the other scope's sessions are NOT (so this is a filter, not everything)",
      !(await poolSession.isVisible().catch(() => false))
    );
    check(
      "the unpublished-facility scope's sessions are absent too",
      !(await page.getByText(draft.scheduleName).first().isVisible().catch(() => false))
    );

    // ---------------------------------------------------------------
    console.log("\n3. The switcher itself, in a real browser");
    // ---------------------------------------------------------------
    // ScheduleScopeFilters: Facility / Department / Schedule Radix Selects in
    // this labelled group. The gym and pool scopes are on different
    // facilities, so switching between them is the Facility dropdown.
    const switcher = page.getByRole("group", { name: "Choose a schedule" });
    check("the header bar renders a schedule switcher", await switcher.isVisible());

    const facilityPicker = switcher.getByRole("button", { name: "Facility", exact: true });
    const schedulePicker = switcher.getByRole("button", { name: "Schedule", exact: true });
    check(
      "a facility-wide scope starts on the whole building: All schedules",
      ((await schedulePicker.textContent()) ?? "").includes("All schedules"),
      await schedulePicker.textContent()
    );
    check(
      "the Facility dropdown names the building behind it, not just its label",
      ((await facilityPicker.textContent()) ?? "").includes(gym.facility.name),
      await facilityPicker.textContent()
    );

    // Each menu opens a tick-box list (TickBoxList) labelled after it.
    const listOf = (name) => page.getByRole("group", { name, exact: true }).locator("label");
    await facilityPicker.click();
    const facilityOptions = listOf("Facility");
    await facilityOptions.first().waitFor({ timeout: 10000 });
    const offered = await facilityOptions.allTextContents();
    check(
      "opening it offers both published facilities",
      offered.includes(gym.facility.name) && offered.includes(pool.facility.name),
      JSON.stringify(offered)
    );
    check(
      "…and never the unpublished one",
      !offered.includes(draft.facility.name),
      JSON.stringify(offered)
    );
    // One at a time (the default): ticking a facility replaces the tick.
    const pickFacility = async (name) => {
      if (!(await listOf("Facility").first().isVisible().catch(() => false))) await facilityPicker.click();
      await page.getByRole("checkbox", { name, exact: true }).locator("..").click();
    };

    // ---------------------------------------------------------------
    console.log("\n4. Picking the second scope actually re-scopes the data");
    // ---------------------------------------------------------------
    expandRequests.length = 0;
    await pickFacility(pool.facility.name);

    await poolSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});

    check(
      "the Facility menu follows the pick, and Schedule re-fits to All schedules",
      ((await facilityPicker.textContent()) ?? "").includes(pool.facility.name) &&
        ((await schedulePicker.textContent()) ?? "").includes("All schedules"),
      `${await facilityPicker.textContent()} | ${await schedulePicker.textContent()}`
    );
    await schedulePicker.click();
    const poolSchedules = await listOf("Schedule").allTextContents();
    await page.keyboard.press("Escape");
    check(
      "a schedule-level entry is listed under the name the org gave it",
      poolSchedules.length === 1 && poolSchedules[0] === poolLabel,
      JSON.stringify(poolSchedules)
    );
    check("the second scope's sessions are now on screen", await poolSession.isVisible());
    check(
      "…and the first scope's sessions are gone — the data changed, not just the label",
      !(await gymSession.isVisible().catch(() => false))
    );
    check(
      "a fresh /api/sessions/expand was issued for the newly selected schedule group",
      expandRequests.some((u) => u.includes(pool.scheduleGroup.id)),
      JSON.stringify(expandRequests)
    );

    // ---------------------------------------------------------------
    console.log("\n5. Switching back — a filter, not a one-way latch");
    // ---------------------------------------------------------------
    await pickFacility(gym.facility.name);
    await gymSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});

    check("the first scope's sessions come back", await gymSession.isVisible());
    check(
      "…and the second scope's are hidden again",
      !(await poolSession.isVisible().catch(() => false))
    );

    // ---------------------------------------------------------------
    console.log("\n6. A facility-wide scope offers that building's real departments and schedules");
    // ---------------------------------------------------------------
    const departmentPicker = switcher.getByRole("button", { name: "Department", exact: true });
    const optionsOf = async (picker, name) => {
      await picker.click();
      await listOf(name).first().waitFor({ timeout: 10000 });
      const texts = await listOf(name).allTextContents();
      await page.keyboard.press("Escape");
      return texts;
    };
    const pick = async (picker, name) => {
      await picker.click();
      await page.getByRole("checkbox", { name, exact: true }).locator("..").click();
    };
    const courtsSession = page.getByText(courts.scheduleName).first();

    const deptOptions = await optionsOf(departmentPicker, "Department");
    check(
      "Department lists both live departments, and reads All departments with neither ticked",
      deptOptions.length === 2 &&
        deptOptions.includes(gym.departmentName) &&
        deptOptions.includes(courts.departmentName) &&
        ((await departmentPicker.textContent()) ?? "").includes("All departments"),
      `${JSON.stringify(deptOptions)} | ${await departmentPicker.textContent()}`
    );
    check("…never the draft department", !deptOptions.includes(hiddenDeptName), JSON.stringify(deptOptions));
    await courtsSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    check(
      "All departments shows both departments' sessions",
      (await gymSession.isVisible()) && (await courtsSession.isVisible())
    );

    expandRequests.length = 0;
    await pick(departmentPicker, gym.departmentName);
    // "Courts hidden" alone is satisfied by the loading state, where nothing
    // is on screen at all — wait for the gym's sessions to come back too.
    await courtsSession.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
    await gymSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    // Picks are asked for as the exact schedules they cover (scopeSelection.ts).
    check(
      "picking a department narrows the query to its schedules",
      expandRequests.some((u) => u.includes(gym.scheduleGroup.id) && !u.includes(courts.scheduleGroup.id)),
      JSON.stringify(expandRequests)
    );
    check(
      "…and the other department's sessions leave the screen",
      (await gymSession.isVisible()) && !(await courtsSession.isVisible().catch(() => false)),
      `gym=${await gymSession.isVisible()} courts=${await courtsSession.isVisible().catch(() => false)}`
    );

    const schedOptions = await optionsOf(schedulePicker, "Schedule");
    check(
      "Schedule lists just the department's live schedule",
      schedOptions.length === 1 && schedOptions[0] === gym.scheduleName,
      JSON.stringify(schedOptions)
    );
    check(
      "…never its draft or ended schedules, nor the draft department's",
      !Object.values(hiddenNames).some((n) => schedOptions.includes(n)),
      JSON.stringify(schedOptions)
    );

    expandRequests.length = 0;
    await pick(schedulePicker, gym.scheduleName);
    await page.waitForLoadState("networkidle");
    // The department has one live schedule, so ticking it covers exactly what
    // the department pick already loaded — the same query, served from cache.
    // A request here would mean the selection is not what keys the data.
    check(
      "ticking the department's only schedule names it and re-uses the loaded week",
      ((await schedulePicker.textContent()) ?? "").includes(gym.scheduleName) &&
        (await gymSession.isVisible()) &&
        expandRequests.length === 0,
      `${await schedulePicker.textContent()} | ${JSON.stringify(expandRequests)}`
    );

    await pick(departmentPicker, courts.departmentName);
    await courtsSession.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    check(
      "switching department lands on its All schedules and swaps the sessions",
      ((await schedulePicker.textContent()) ?? "").includes("All schedules") &&
        (await courtsSession.isVisible()) &&
        !(await gymSession.isVisible().catch(() => false)),
      await schedulePicker.textContent()
    );

    // ---------------------------------------------------------------
    console.log("\n7. The signed-in preview offers what a visitor gets, not what staff can read");
    // ---------------------------------------------------------------
    // Signed out, RLS already hides a draft department, so section 6 passes
    // with or without expandScopes' own publish filter. The dashboard's preview
    // iframe carries the admin's session, where RLS lets drafts through — the
    // filter in the route is the only thing between staff and a preview that
    // lists a department no visitor will ever see.
    const staff = await browser.newContext({ viewport: { width: 900, height: 900 } });
    await staff.addCookies(
      cookie.split("; ").map((pair) => {
        const at = pair.indexOf("=");
        return { name: pair.slice(0, at), value: pair.slice(at + 1), domain: new URL(APP).hostname, path: "/" };
      })
    );
    const staffPage = await staff.newPage();
    await staffPage.goto(`${APP}/widget/${org.id}?preview=1`, { waitUntil: "networkidle" });
    const staffDept = staffPage
      .getByRole("group", { name: "Choose a schedule" })
      .getByRole("button", { name: "Department", exact: true });
    await staffDept.click();
    const staffList = staffPage.getByRole("group", { name: "Department", exact: true }).locator("label");
    await staffList.first().waitFor({ timeout: 10000 });
    const staffOptions = await staffList.allTextContents();
    check(
      "the preview lists the live departments",
      staffOptions.includes(gym.departmentName) && staffOptions.includes(courts.departmentName),
      JSON.stringify(staffOptions)
    );
    check("…and still not the draft one", !staffOptions.includes(hiddenDeptName), JSON.stringify(staffOptions));
    await staff.close();
  } finally {
    await browser.close();
  }
} catch (err) {
  check("the run completed without throwing", false, err?.stack ?? String(err));
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

  // Count users as well as orgs. Deleting an org cascades its rows but leaves
  // the fixture's auth user behind, and a leftover check that looks only at
  // organizations reports a clean teardown while users pile up — three
  // orphaned @example.invalid accounts accumulated in the live project before
  // anyone noticed.
  const { data: orgsLeft } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `%${stamp}%`);
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
