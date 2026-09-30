/**
 * verify-bg — the status library and department statuses (migration 064), and
 * the reworked facility status page.
 *
 *   node --experimental-strip-types scripts/verify/verify-bg.mjs --logic-only   # no server, no database
 *   node --experimental-strip-types scripts/verify/verify-bg.mjs                # needs the app on :3000
 *   ... --app=http://localhost:3005  --headed  --shots=.design-shots/status
 *
 * 0. templatesFor: which statuses a department is offered.
 * 1. Before 064: the page still renders, offering the built-in list.
 * 2. With 064: seeding (existing orgs and the trigger), RLS on the library,
 *    the same-org trigger, and the template API as owner and as coordinator.
 * 3. With 064: a notice about a department — the API's cross-table checks, and
 *    the public read naming the department.
 * 4. In a browser: the board, the Tennis composer NOT offering a pool status,
 *    the Aquatics one offering it, posting to Tennis landing on the Tennis row,
 *    and the Settings library filter.
 *
 * Every mechanism assertion has a positive control next to it: "tennis is not
 * offered contamination" is paired with "aquatics is", so an empty list cannot
 * pass by accident.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const LOGIC_ONLY = process.argv.includes("--logic-only");
const HEADED = process.argv.includes("--headed");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice(8) ?? null;

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

// ── 0. Logic ─────────────────────────────────────────────────────────────────
async function logicSection() {
  console.log("\n0. templatesFor (no database, no server)");
  const { templatesFor, joinTemplates } = await import("../../src/lib/status/templates.ts");
  const T = (id, departmentIds) => ({ id, label: id, category: "other", severity: "info", headline: id, body: null, display_order: 0, departmentIds });
  const all = [T("power", []), T("fecal", ["aq"]), T("courts-wet", ["tn"]), T("elsewhere", ["other-dept"])];
  const ids = (xs) => xs.map((x) => x.id).sort().join(",");

  check("tennis: everyone's + its own, no pool status", ids(templatesFor(all, "tn", ["aq", "tn"])) === "courts-wet,power", ids(templatesFor(all, "tn", ["aq", "tn"])));
  check("aquatics (positive control): gets the pool status", ids(templatesFor(all, "aq", ["aq", "tn"])) === "fecal,power");
  check("whole facility: everyone's + this building's departments, not another building's",
    ids(templatesFor(all, null, ["aq", "tn"])) === "courts-wet,fecal,power", ids(templatesFor(all, null, ["aq", "tn"])));
  check("whole facility with no departments: only the unassigned ones", ids(templatesFor(all, null, [])) === "power");
  const joined = joinTemplates(
    [{ ...T("b", []), display_order: 2 }, { ...T("a", []), display_order: 1 }],
    [{ template_id: "b", department_id: "x" }, { template_id: "b", department_id: "y" }]
  );
  check("joinTemplates orders by display_order and attaches departments",
    joined[0].id === "a" && joined[1].departmentIds.join(",") === "x,y");
}

if (LOGIC_ONLY) {
  await logicSection();
  console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Fixtures ────────────────────────────────────────────────────────────────
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
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) parts.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
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

async function makeUser(orgId, role, label, scope = null) {
  const email = `zz-bg-${label}-${stamp}@example.invalid`;
  const password = `Zz!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);
  const { data: membership, error: mErr } = await admin
    .from("org_memberships").insert({ org_id: orgId, user_id: data.user.id, role, email }).select("id").single();
  if (mErr) throw new Error(`membership ${label}: ${mErr.message}`);
  if (scope) {
    const { error: sErr } = await admin.from("membership_scopes").insert({ membership_id: membership.id, org_id: orgId, ...scope });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }
  const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  const cookieParts = cookiePartsFor(signed.session);
  const client = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  return { userId: data.user.id, cookieParts, cookie: cookieParts.map((c) => `${c.name}=${c.value}`).join("; "), client };
}

async function mkOrg(name) {
  const { data, error } = await admin.from("organizations")
    .insert({ name: `ZZ ${name} ${stamp}`, slug: `zz-bg-${name}-${stamp}`, status: "active" }).select("id").single();
  if (error) throw new Error(`org: ${error.message}`);
  ids.orgs.push(data.id);
  return data.id;
}

async function main() {
  await logicSection();

  const { error: probe } = await admin.from("notice_templates").select("id").limit(1);
  const has064 = !probe;
  console.log(`\n  migration 064: ${has064 ? "applied" : "NOT applied — sections 2-3 skip; 1 and 4 run on the fallback"}`);

  // Departments are created BEFORE anything reads the library, and the org is
  // seeded by the trigger at insert — when it has no departments yet. So the
  // seeded pool statuses start on every department; section 2 assigns them.
  const orgId = await mkOrg("status");
  const { data: facility } = await admin.from("facilities").insert({
    org_id: orgId, name: `ZZ Rec ${stamp}`, slug: `zz-bg-rec-${stamp}`, address_line1: "1 Test St",
    city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id, slug").single();
  const mkDept = async (name, order) => (await admin.from("departments").insert({
    org_id: orgId, facility_id: facility.id, name, slug: `${name.toLowerCase()}-${stamp}`, display_order: order, is_published: true,
  }).select("id").single()).data.id;
  const aquatics = await mkDept("Aquatics", 1);
  const tennis = await mkDept("Tennis", 2);
  const mkSpace = async (name, departmentId) => (await admin.from("spaces").insert({
    org_id: orgId, facility_id: facility.id, department_id: departmentId, name,
    slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`, is_published: true,
  }).select("id").single()).data.id;
  const lane = await mkSpace("Lane 1", aquatics);
  const court = await mkSpace("Court 1", tennis);

  const owner = await makeUser(orgId, "owner", "owner");
  const tennisCoord = await makeUser(orgId, "coordinator", "tcoord", { department_id: tennis });
  const noticesPath = `/api/facilities/${facility.id}/notices`;

  // ── 1. Before 064 ────────────────────────────────────────────────────────
  if (!has064) {
    console.log("\n1. Before 064: fallback");
    const page = await fetch(`${APP}/dashboard/facilities/${facility.id}/status`, { headers: { Cookie: owner.cookie } });
    const html = await page.text();
    check("status page renders", page.status === 200, String(page.status));
    check("...with a row per department", html.includes("Aquatics") && html.includes("Tennis") && html.includes("Whole facility"));
    const deptPost = await api(noticesPath, owner.cookie, { method: "POST", body: JSON.stringify({
      category: "staffing", severity: "info", headline: `ZZ short ${stamp}`, department_id: tennis, is_published: true }) });
    check("a department post says 064 is missing (503), not a vague 400", deptPost.status === 503, `${deptPost.status} ${JSON.stringify(deptPost.body)}`);
    const wholePost = await api(noticesPath, owner.cookie, { method: "POST", body: JSON.stringify({
      category: "power", severity: "closure", headline: `ZZ power ${stamp}`, is_published: true }) });
    check("positive control: a whole-facility post still works", wholePost.status === 201, `${wholePost.status}`);
    const lib = await fetch(`${APP}/dashboard/settings/statuses`, { headers: { Cookie: owner.cookie } });
    check("the library page explains 064 is not applied", (await lib.text()).includes("migration 064"));
    skipped("sections 2-3", "migration 064 not applied");
  }

  let fecalId = null;
  if (has064) {
    // ── 2. Library ─────────────────────────────────────────────────────────
    console.log("\n2. The library");
    const { data: seeded } = await admin.from("notice_templates").select("id, label").eq("org_id", orgId);
    check("a new organization is seeded by the trigger (13 statuses)", seeded?.length === 13, String(seeded?.length));
    fecalId = seeded?.find((t) => t.label.startsWith("Fecal"))?.id;

    const { data: real } = await admin.from("organizations").select("id").not("name", "like", "ZZ%").limit(50);
    const { data: realTemplates } = await admin.from("notice_templates").select("org_id").in("org_id", (real ?? []).map((o) => o.id));
    const seededOrgs = new Set((realTemplates ?? []).map((t) => t.org_id));
    check("existing organizations were seeded by the migration", (real ?? []).every((o) => seededOrgs.has(o.id)), `${seededOrgs.size}/${real?.length}`);

    // Assign contamination to Aquatics through the API, as the owner.
    const assign = await api(`/api/notice-templates/${fecalId}`, owner.cookie, { method: "PATCH", body: JSON.stringify({ department_ids: [aquatics] }) });
    check("owner assigns a status to Aquatics", assign.status === 200 && assign.body.template?.departmentIds?.join() === aquatics, `${assign.status} ${JSON.stringify(assign.body)}`);

    const created = await api("/api/notice-templates", owner.cookie, { method: "POST", body: JSON.stringify({
      label: `Courts wet ${stamp}`, category: "weather", severity: "closure", headline: "Outdoor courts closed — wet", department_ids: [tennis] }) });
    check("owner creates a Tennis-only status", created.status === 201, `${created.status} ${JSON.stringify(created.body)}`);
    const courtsId = created.body.template?.id;

    const byCoord = await api("/api/notice-templates", tennisCoord.cookie, { method: "POST", body: JSON.stringify({
      label: "nope", category: "other", severity: "info", headline: "nope" }) });
    check("a coordinator cannot add to the library (403)", byCoord.status === 403, String(byCoord.status));
    const { error: directErr, data: directRows } = await tennisCoord.client.from("notice_templates")
      .insert({ org_id: orgId, label: "direct", category: "other", severity: "info", headline: "direct" }).select("id");
    check("...nor straight through PostgREST (RLS)", !!directErr || (directRows ?? []).length === 0, directErr?.message ?? "inserted!");
    const { data: coordReads } = await tennisCoord.client.from("notice_templates").select("id").eq("org_id", orgId);
    check("positive control: the coordinator can READ the library", (coordReads?.length ?? 0) >= 14, String(coordReads?.length));

    const otherOrg = await mkOrg("other");
    const { data: otherFac } = await admin.from("facilities").insert({ org_id: otherOrg, name: `ZZ other ${stamp}`, slug: `zz-bg-other-${stamp}`, address_line1: "1", city: "V", province: "BC", postal_code: "V0V 0V0" }).select("id").single();
    const { data: otherDept } = await admin.from("departments").insert({ org_id: otherOrg, facility_id: otherFac.id, name: "Foreign", slug: `foreign-${stamp}` }).select("id").single();
    const foreign = await api(`/api/notice-templates/${courtsId}`, owner.cookie, { method: "PATCH", body: JSON.stringify({ department_ids: [otherDept.id] }) });
    check("another organization's department is refused", foreign.status === 400, `${foreign.status}`);
    const { data: courtsLinks } = await admin.from("notice_template_departments").select("department_id").eq("template_id", courtsId);
    check("...and the refused PATCH left the status on Tennis, not on every department",
      courtsLinks?.length === 1 && courtsLinks[0].department_id === tennis, JSON.stringify(courtsLinks));

    const widen = await api(`/api/notice-templates/${courtsId}`, owner.cookie, { method: "PATCH", body: JSON.stringify({ department_ids: [] }) });
    const { count: afterWiden } = await admin.from("notice_template_departments").select("*", { count: "exact", head: true }).eq("template_id", courtsId);
    check("department_ids: [] makes it every department's", widen.status === 200 && afterWiden === 0, `${widen.status} ${afterWiden}`);
    await api(`/api/notice-templates/${courtsId}`, owner.cookie, { method: "PATCH", body: JSON.stringify({ department_ids: [tennis] }) });

    // ── 3. Department notices ──────────────────────────────────────────────
    console.log("\n3. A notice about a department");
    const post = (over) => api(noticesPath, owner.cookie, { method: "POST", body: JSON.stringify({
      category: "staffing", severity: "info", headline: `ZZ Tennis short-staffed ${stamp}`, is_published: true, ...over }) });
    const ok = await post({ department_id: tennis });
    check("posting about Tennis stores department_id", ok.status === 201 && ok.body.notice?.department_id === tennis, `${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
    const mismatch = await post({ department_id: tennis, space_id: lane });
    check("a pool lane under Tennis is refused", mismatch.status === 400, String(mismatch.status));
    const matched = await post({ department_id: tennis, space_id: court, headline: `ZZ Court 1 net down ${stamp}` });
    check("positive control: a tennis court under Tennis is accepted", matched.status === 201, String(matched.status));
    const foreignDept = await post({ department_id: otherDept.id });
    check("another organization's department is refused", foreignDept.status === 400, String(foreignDept.status));

    const { data: pub } = await anon.from("facility_notices").select("headline, departments(name)").eq("facility_id", facility.id);
    const row = (pub ?? []).find((n) => n.headline === `ZZ Tennis short-staffed ${stamp}`);
    check("the public read can name the department", row?.departments?.name === "Tennis", JSON.stringify(row));
  }

  // ── 4. Browser ─────────────────────────────────────────────────────────
  console.log("\n4. In a browser");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, isMobile: width < 600, hasTouch: width < 600 });
      await context.addCookies(owner.cookieParts.map((c) => ({ ...c, domain: new URL(APP).hostname, path: "/" })));
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(`${APP}/dashboard/facilities/${facility.id}/status`, { waitUntil: "networkidle" });

      const rowOf = (name) => page.locator("li", { has: page.locator("p.font-semibold", { hasText: new RegExp(`^${name}$`) }) }).first();
      check(`${width}px: board has Whole facility, Aquatics, Tennis rows`,
        (await rowOf("Whole facility").count()) === 1 && (await rowOf("Aquatics").count()) === 1 && (await rowOf("Tennis").count()) === 1);
      if (has064) {
        check(`${width}px: the Tennis post sits on the Tennis row`, (await rowOf("Tennis").textContent()).includes(`ZZ Tennis short-staffed ${stamp}`));
        check(`${width}px: ...and not on the Aquatics row`, !(await rowOf("Aquatics").textContent()).includes("short-staffed"));
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${width}px: no horizontal overflow`, overflow <= 0, String(overflow));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/board-${width}.png`, fullPage: true }); }

      const openFor = async (name) => {
        await rowOf(name).getByRole("button", { name: /Post|Report/ }).filter({ visible: true }).first().click();
        await page.getByRole("dialog").waitFor();
      };
      await openFor("Tennis");
      const dialog = page.getByRole("dialog");
      const tennisList = await dialog.textContent();
      if (has064) {
        check(`${width}px: Tennis composer does NOT offer contamination`, !tennisList.includes("Fecal"));
        check(`${width}px: Tennis composer offers its own status`, tennisList.includes(`Courts wet ${stamp}`));
      }
      check(`${width}px: Tennis composer offers the everyone statuses`, tennisList.includes("Power outage"));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/composer-tennis-${width}.png` });
      await dialog.getByRole("button", { name: "Aquatics" }).click();
      const aqList = await dialog.textContent();
      check(`${width}px: positive control — Aquatics offers contamination`, aqList.includes("Fecal"));
      if (has064) check(`${width}px: ...and not the Tennis-only status`, !aqList.includes(`Courts wet ${stamp}`));

      if (width === 1440) {
        await dialog.getByRole("button", { name: "Tennis" }).click();
        await dialog.getByRole("button", { name: /Short-staffed|Reduced hours/ }).click();
        await dialog.getByLabel(/What patrons will read/).fill(`ZZ via browser ${stamp}`);
        const where = dialog.getByLabel("Where");
        const opts = await where.locator("option").allTextContents();
        check("the Where picker lists Tennis spaces only", opts.includes("Court 1") && !opts.includes("Lane 1"), opts.join("|"));
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/composer-form-${width}.png` });
        await dialog.getByRole("button", { name: "Post it" }).click();
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction((t) => document.body.innerText.includes(t), `ZZ via browser ${stamp}`, { timeout: 10000 });
        const onRow = (await rowOf(has064 ? "Tennis" : "Whole facility").textContent()).includes(`ZZ via browser ${stamp}`);
        check(`posted from the browser, it lands on the ${has064 ? "Tennis" : "Whole facility (no 064)"} row`, onRow);
        // People here — the head count tool, folded into this page 2026-09-29.
        const people = page.locator("#people");
        check("People here sits on the status page", (await people.getByRole("heading", { name: "People here" }).count()) === 1);
        check("...with temperatures folded (none recorded here)", !(await people.getByLabel(/Water \(°C\)/i).isVisible().catch(() => false)));
        check("the sidebar no longer has a Head counts item", (await page.getByRole("link", { name: "Head counts" }).count()) === 0);
        await people.locator("#count").fill("23");
        await people.getByRole("button", { name: "Record count" }).click();
        await people.getByText("Saved").first().waitFor({ timeout: 8000 }).catch(() => {});
        const { data: counted } = await admin.from("facility_readings").select("value, recorded_by")
          .eq("facility_id", facility.id).eq("metric", "headcount").order("recorded_at", { ascending: false }).limit(1).maybeSingle();
        check("a count recorded here lands in facility_readings, as the viewer", counted?.value === 23 && counted?.recorded_by === owner.userId, JSON.stringify(counted));
        await page.goto(`${APP}/dashboard/counts?facility=${facility.id}`, { waitUntil: "networkidle" });
        check("/dashboard/counts?facility= redirects to this status page",
          new URL(page.url()).pathname === `/dashboard/facilities/${facility.id}/status`, page.url());
        await page.goto(`${APP}/dashboard/facilities/${facility.id}/status`, { waitUntil: "networkidle" });
      } else {
        await page.keyboard.press("Escape");
        // An open dialog aria-hides everything behind it, the bar included.
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const nav = page.getByRole("navigation", { name: "Primary" });
        check("390px: the bottom bar has one Status tab and no Count tab",
          (await nav.getByRole("link", { name: "Status" }).count()) === 1 && (await nav.getByRole("link", { name: "Count" }).count()) === 0,
          (await nav.getByRole("link").allTextContents()).join("|"));
      }
      check(`${width}px: no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));

      if (has064 && width === 1440) {
        await page.goto(`${APP}/dashboard/settings/statuses`, { waitUntil: "networkidle" });
        const libText = await page.locator("main").textContent();
        check("library lists the seeded and the new status", libText.includes("Power outage") && libText.includes(`Courts wet ${stamp}`));
        await page.getByRole("button", { name: "Tennis", exact: true }).click();
        const filtered = await page.locator("main").textContent();
        check("library filtered to Tennis hides contamination", !filtered.includes("Fecal"));
        check("positive control: ...and still shows Tennis's own", filtered.includes(`Courts wet ${stamp}`));
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/library-${width}.png`, fullPage: true });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => { fail++; console.log(`  FAIL  harness crashed — ${e.stack ?? e}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
