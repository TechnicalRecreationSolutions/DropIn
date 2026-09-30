/**
 * Zones made on the Spaces page — `PATCH /api/spaces/zone` and the dialog.
 *
 * Before this a zone could only be made by opening each lane's edit form and
 * typing the same label into each. The claims worth doubting now:
 *
 *   1. **One write labels N spaces** and un-labels the ones taken out: create,
 *      rename, drop a member and dissolve are all the same route.
 *   2. **The route is department-scoped.** A member from another department
 *      is refused (400, nothing written), and a rename of "Main Pool" under
 *      Aquatics leaves Fitness's "Main Pool" alone.
 *   3. **A coordinator can only do this in their own department** — 403 out of
 *      scope, 200 in scope (positive control), and the department-less
 *      "Whole building" section is manager territory.
 *   4. **The dialog does it** — in a real browser, "New zone" on a department,
 *      a name, ticked lanes, Create: the heading appears without a reload and
 *      the rows are relabelled. Then the pencil on that heading renames it.
 *   5. **"+ Add" on a zone heading pre-fills the space form's zone field.**
 *
 *   npm run dev
 *   node scripts/verify/verify-bf.mjs [--headed] [--api-only]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const API_ONLY = process.argv.includes("--api-only");

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

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

function cookiePartsFor(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    parts.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  }
  return parts;
}

async function api(pathname, cookie, init = {}) {
  const res = await fetch(`${APP}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: res.status, body };
}

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function makeUser(orgId, role, label, departmentId = null) {
  const email = `zz-bf-${label}-${stamp}@example.invalid`;
  const password = `Zz!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);

  const { data: membership, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: data.user.id, role, email })
    .select("id")
    .single();
  if (mErr) throw new Error(`membership ${label} (${role}): ${mErr.message}`);

  if (departmentId) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert({ membership_id: membership.id, org_id: orgId, department_id: departmentId });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }

  const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  const cookieParts = cookiePartsFor(signed.session);
  return { cookieParts, cookie: cookieParts.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function main() {
  const { error: probe } = await admin.from("spaces").select("zone_name").limit(1);
  if (probe) { skipped("everything", "migration 054 (zone_name) not applied"); return; }

  const { data: org, error: oErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ zonedlg ${stamp}`, slug: `zz-zonedlg-${stamp}`, status: "active" })
    .select("id").single();
  if (oErr) throw new Error(`org: ${oErr.message}`);
  ids.orgs.push(org.id);

  const { data: facility, error: fErr } = await admin.from("facilities").insert({
    org_id: org.id, name: `ZZ Crystal ${stamp}`, slug: `zz-crystal-${stamp}`,
    address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id").single();
  if (fErr) throw new Error(`facility: ${fErr.message}`);

  const mkDept = async (name, order) => {
    const { data, error } = await admin.from("departments").insert({
      org_id: org.id, facility_id: facility.id, name, slug: `zz-${name.toLowerCase()}-${stamp}`,
      display_order: order, is_published: true,
    }).select("id").single();
    if (error) throw new Error(`department ${name}: ${error.message}`);
    return data;
  };
  const aquatics = await mkDept("Aquatics", 0);
  const fitness = await mkDept("Fitness", 1);

  const spaces = {};
  const mkSpace = async (name, departmentId, zone = null, order = 0) => {
    const { data, error } = await admin.from("spaces").insert({
      org_id: org.id, facility_id: facility.id, department_id: departmentId,
      name, slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      display_order: order, is_published: true, zone_name: zone,
    }).select("id").single();
    if (error) throw new Error(`space ${name}: ${error.message}`);
    spaces[name] = data.id;
    return data.id;
  };
  let n = 1;
  for (const lane of ["Lane 1", "Lane 2", "Lane 3", "Lane 4"]) await mkSpace(lane, aquatics.id, null, n++);
  await mkSpace("Dive Tank", aquatics.id, null, n++);
  await mkSpace("Hot Tub", aquatics.id, "Leisure", n++);
  await mkSpace("Studio A", fitness.id, "Main Pool", n++); // same string as the zone Aquatics is about to make
  await mkSpace("Parking", null, null, n++);               // "Whole building"

  const zoneOf = async (name) =>
    (await admin.from("spaces").select("zone_name").eq("id", spaces[name]).single()).data?.zone_name ?? null;

  const owner = await makeUser(org.id, "owner", "owner");
  const coord = await makeUser(org.id, "coordinator", "coord", aquatics.id);

  const zone = (cookie, body) => api("/api/spaces/zone", cookie, { method: "PATCH", body: JSON.stringify(body) });
  const base = { facility_id: facility.id, department_id: aquatics.id };

  // ── 1. One write, N labels ────────────────────────────────────────────────
  console.log("\n1. Create / rename / drop a member / dissolve — one route");

  let r = await zone(owner.cookie, { ...base, zone_name: "Main Pool", member_ids: [spaces["Lane 1"], spaces["Lane 2"], spaces["Lane 3"]] });
  check("create: 200", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("create: labelled 3, cleared 0", r.body.labelled === 3 && r.body.cleared === 0, JSON.stringify(r.body));
  check("create: Lane 1-3 now 'Main Pool'",
    (await zoneOf("Lane 1")) === "Main Pool" && (await zoneOf("Lane 3")) === "Main Pool");
  check("create: Lane 4 untouched (null)", (await zoneOf("Lane 4")) === null);
  check("create: Hot Tub keeps 'Leisure'", (await zoneOf("Hot Tub")) === "Leisure");

  // Rename + drop Lane 3 + pull Lane 4 in, in one call.
  r = await zone(owner.cookie, { ...base, zone_name: "50m Pool", previous_zone_name: "Main Pool",
    member_ids: [spaces["Lane 1"], spaces["Lane 2"], spaces["Lane 4"]] });
  check("rename+re-tick: 200", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("rename+re-tick: labelled 3, cleared 1", r.body.labelled === 3 && r.body.cleared === 1, JSON.stringify(r.body));
  check("rename: Lane 1 is now '50m Pool'", (await zoneOf("Lane 1")) === "50m Pool");
  check("dropped member: Lane 3 is back to no zone", (await zoneOf("Lane 3")) === null);
  check("added member: Lane 4 is '50m Pool'", (await zoneOf("Lane 4")) === "50m Pool");
  // FALSIFY: scope the clear by facility only and this reads null.
  check("Fitness's own 'Main Pool' was NOT touched by Aquatics' rename", (await zoneOf("Studio A")) === "Main Pool");

  // Moving a lane out of one zone into another via a create on the other.
  r = await zone(owner.cookie, { ...base, zone_name: "Leisure", member_ids: [spaces["Hot Tub"], spaces["Lane 4"]], previous_zone_name: "Leisure" });
  check("moving Lane 4 into 'Leisure' (typed existing name merges)", r.status === 200 && (await zoneOf("Lane 4")) === "Leisure");
  check("...and it is no longer in '50m Pool'", (await zoneOf("Lane 4")) !== "50m Pool");

  // Dissolve: empty member list with the previous name.
  r = await zone(owner.cookie, { ...base, zone_name: "50m Pool", previous_zone_name: "50m Pool", member_ids: [] });
  check("dissolve: 200, cleared 2", r.status === 200 && r.body.cleared === 2, `${r.status} ${JSON.stringify(r.body)}`);
  check("dissolve: Lane 1 and 2 have no zone, still exist",
    (await zoneOf("Lane 1")) === null && (await zoneOf("Lane 2")) === null);

  // ── 2. Department boundary ───────────────────────────────────────────────
  console.log("\n2. Department scoping");

  r = await zone(owner.cookie, { ...base, zone_name: "Sneaky", member_ids: [spaces["Lane 1"], spaces["Studio A"]] });
  check("a member from another department: 400", r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  check("...and nothing was written (Lane 1 still null)", (await zoneOf("Lane 1")) === null);
  check("...and Studio A still 'Main Pool'", (await zoneOf("Studio A")) === "Main Pool");

  r = await zone(owner.cookie, { ...base, zone_name: "Sneaky", member_ids: [spaces["Parking"]] });
  check("a department-less space under a department: 400", r.status === 400, String(r.status));

  r = await zone(owner.cookie, { ...base, zone_name: "  ", member_ids: [spaces["Lane 1"]] });
  check("blank zone name: 400", r.status === 400, String(r.status));

  r = await zone(owner.cookie, { ...base, zone_name: "Dup", member_ids: [spaces["Lane 1"], spaces["Lane 1"]] });
  check("duplicate member: 400", r.status === 400, String(r.status));

  r = await zone(null, { ...base, zone_name: "Anon", member_ids: [spaces["Lane 1"]] });
  check("signed out: 401", r.status === 401, String(r.status));

  // ── 3. Roles ─────────────────────────────────────────────────────────────
  console.log("\n3. Coordinator scope");

  r = await zone(coord.cookie, { ...base, zone_name: "Coord Pool", member_ids: [spaces["Lane 1"], spaces["Lane 2"]] });
  check("coordinator in own department: 200 (positive control)", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  check("...Lane 1 is 'Coord Pool'", (await zoneOf("Lane 1")) === "Coord Pool");

  r = await zone(coord.cookie, { facility_id: facility.id, department_id: fitness.id, zone_name: "Hijack", member_ids: [spaces["Studio A"]] });
  check("coordinator in another department: 403", r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
  check("...Studio A unchanged", (await zoneOf("Studio A")) === "Main Pool");

  r = await zone(coord.cookie, { facility_id: facility.id, department_id: null, zone_name: "Outside", member_ids: [spaces["Parking"]] });
  check("coordinator on 'Whole building' (null department): 403", r.status === 403, String(r.status));

  r = await zone(owner.cookie, { facility_id: facility.id, department_id: null, zone_name: "Outside", member_ids: [spaces["Parking"]] });
  check("owner on 'Whole building': 200", r.status === 200 && (await zoneOf("Parking")) === "Outside", String(r.status));

  // Back to the starting picture for the browser half: Lane 1-4 loose, Hot Tub
  // alone in "Leisure" (section 1 had pulled Lane 4 in there).
  await zone(owner.cookie, { ...base, zone_name: "Coord Pool", previous_zone_name: "Coord Pool", member_ids: [] });
  await zone(owner.cookie, { ...base, zone_name: "Leisure", previous_zone_name: "Leisure", member_ids: [spaces["Hot Tub"]] });
  check("reset: Lane 1-4 have no zone and Hot Tub is alone in 'Leisure'",
    (await zoneOf("Lane 1")) === null && (await zoneOf("Lane 4")) === null && (await zoneOf("Hot Tub")) === "Leisure");

  if (API_ONLY) return;

  // ── 4/5. The dialog, in a browser ────────────────────────────────────────
  console.log("\n4. The dialog on /dashboard/spaces");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(owner.cookieParts.map((c) => ({ ...c, domain: "localhost", path: "/" })));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${APP}/dashboard/spaces?facility=${facility.id}`, { waitUntil: "networkidle" });
    check("Spaces page: 'New zone' button on the Aquatics section", await page.locator(`[data-new-zone="${aquatics.id}"]`).count() === 1);
    check("Spaces page: no 'Main Pool' heading yet under Aquatics",
      (await page.locator(`[data-edit-zone="Main Pool"]`).count()) === 1, "expected exactly Fitness's one");

    await page.locator(`[data-new-zone="${aquatics.id}"]`).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    check("dialog opens titled 'New zone'", await dialog.getByText("New zone", { exact: true }).count() === 1);
    check("dialog lists only Aquatics spaces (6), not Studio A or Parking",
      (await dialog.locator("input[data-zone-member]").count()) === 6 &&
      (await dialog.getByText("Studio A").count()) === 0);
    check("Create is disabled until a name and a tick", await dialog.getByRole("button", { name: "Create zone" }).isDisabled());

    // Typing the name of the zone a ticked space is already in is a stay, not a
    // move — the hint must not say "moving from Leisure".
    await dialog.locator("#zone-dialog-name").fill("Leisure");
    await dialog.locator(`input[data-zone-member="${spaces["Hot Tub"]}"]`).check();
    check("a ticked space already in the typed zone shows no 'moving from'",
      (await dialog.getByText("moving from", { exact: false }).count()) === 0);
    await dialog.locator("#zone-dialog-name").fill("Main Pool");
    check("...but once the name differs, it does",
      (await dialog.getByText("moving from Leisure").count()) === 1);
    await dialog.locator(`input[data-zone-member="${spaces["Hot Tub"]}"]`).uncheck();

    for (const lane of ["Lane 1", "Lane 2", "Lane 3"]) {
      await dialog.locator(`input[data-zone-member="${spaces[lane]}"]`).check();
    }
    check("Hot Tub's row says which zone it is in now", (await dialog.getByText("in Leisure").count()) === 1);
    await dialog.getByRole("button", { name: "Create zone" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 });

    // Optimistic: the heading is there before any reload.
    const aqSection = page.locator("section", { has: page.locator(`[data-new-zone="${aquatics.id}"]`) });
    await aqSection.locator(`[data-edit-zone="Main Pool"]`).waitFor({ timeout: 5000 });
    check("'Main Pool' heading appears under Aquatics without a reload", true);
    check("DB: Lane 1-3 relabelled by the dialog",
      (await zoneOf("Lane 1")) === "Main Pool" && (await zoneOf("Lane 2")) === "Main Pool" && (await zoneOf("Lane 3")) === "Main Pool");
    check("DB: Lane 4 left alone", (await zoneOf("Lane 4")) === null);

    // Reload: the server agrees with what the page showed.
    await page.reload({ waitUntil: "networkidle" });
    const headingLanes = await aqSection.locator("h3", { hasText: "Main Pool" }).locator("xpath=../following-sibling::ul[1]").locator('a[aria-label^="Edit "]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Edit /, "")));
    check("after reload: Lane 1-3 sit under the 'Main Pool' heading", headingLanes.join(",") === "Lane 1,Lane 2,Lane 3", headingLanes.join(","));

    // Rename via the pencil.
    await aqSection.locator(`[data-edit-zone="Main Pool"]`).click();
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    check("edit dialog pre-ticks the 3 members",
      (await dialog.locator("input[data-zone-member]:checked").count()) === 3);
    check("edit dialog offers 'Remove zone'", (await dialog.getByRole("button", { name: "Remove zone" }).count()) === 1);
    await dialog.locator("#zone-dialog-name").fill("Competition Pool");
    await dialog.locator(`input[data-zone-member="${spaces["Lane 3"]}"]`).uncheck();
    await dialog.getByRole("button", { name: "Save zone" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    await aqSection.locator(`[data-edit-zone="Competition Pool"]`).waitFor({ timeout: 5000 });
    check("rename shows the new heading at once", true);
    check("DB: renamed and Lane 3 dropped",
      (await zoneOf("Lane 1")) === "Competition Pool" && (await zoneOf("Lane 3")) === null);
    check("DB: Fitness's 'Main Pool' still there after the Aquatics rename", (await zoneOf("Studio A")) === "Main Pool");

    // 5. "+ Add" on the heading pre-fills the form.
    console.log("\n5. '+ Add' on a zone heading");
    await aqSection.locator(`a[aria-label="Add a space to Competition Pool"]`).click();
    await page.waitForURL(/\/spaces\/new\?/, { timeout: 10000 });
    await page.locator("#zone_name").waitFor({ timeout: 10000 });
    check("space form opens with the zone pre-filled", (await page.locator("#zone_name").inputValue()) === "Competition Pool");
    check("...and the department pre-selected", (await page.locator("#department_id").inputValue()) === aquatics.id);

    check("no page errors during the browser run", errors.length === 0, errors.join(" | "));
    await context.close();
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.stack ?? e.message}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
