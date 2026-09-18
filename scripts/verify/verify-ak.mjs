/**
 * Department scoping of the space pickers (no migration — a filter fix).
 *
 * Reproduces the Panorama shape:
 * a facility with BOTH an Aquatics and a Tennis department, pool lanes filed
 * under Aquatics, and a tennis court left with department_id NULL.
 *
 *   npm run dev
 *   node scripts/verify/verify-ak.mjs [--headed]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = "http://localhost:3000";
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

let pass = 0, fail = 0;
const check = (l, ok, d = "") => { if (ok) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ` — ${d}` : ""}`); } };

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

async function main() {
  const { data: org } = await admin.from("organizations")
    .insert({ name: `ZZ scope ${stamp}`, slug: `zz-scope-${stamp}`, status: "active" }).select("id").single();
  ids.orgs.push(org.id);

  const email = `zz-scope-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(u.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: u.user.id, role: "admin" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });

  // --- Facility A: Panorama's shape ---------------------------------------
  const { data: fac } = await admin.from("facilities").insert({
    org_id: org.id, name: `ZZ Panorama ${stamp}`, slug: `zz-pan-${stamp}`,
    address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id").single();

  const dept = {};
  for (const [i, name] of ["Aquatics", "Tennis"].entries()) {
    const { data } = await admin.from("departments").insert({
      org_id: org.id, facility_id: fac.id, name, slug: `zz-${name.toLowerCase()}-${stamp}`,
      display_order: i, is_published: true,
    }).select("id").single();
    dept[name] = data.id;
  }

  for (const [i, name] of ["Lane 1", "Lane 2", "Lane 3"].entries()) {
    await admin.from("spaces").insert({
      org_id: org.id, facility_id: fac.id, department_id: dept.Aquatics, name,
      slug: `zz-lane-${i}-${stamp}`, display_order: i + 1, is_published: true, zone_name: "Main Pool",
    });
  }
  // The bug's subject: a real court, never filed under Tennis.
  await admin.from("spaces").insert({
    org_id: org.id, facility_id: fac.id, department_id: null, name: "Tennis Court",
    slug: `zz-court-${stamp}`, display_order: 9, is_published: true,
  });

  const { data: aquaticsSchedule } = await admin.from("schedule_groups").insert({
    org_id: org.id, facility_id: fac.id, department_id: dept.Aquatics,
    name: `ZZ Lap Swim ${stamp}`, slug: `zz-lap-${stamp}`,
    sport_category: "swimming", activity_type: "drop_in", status: "published", source: "manual",
  }).select("id").single();

  // --- Facility B: no departments at all (the control) ---------------------
  const { data: facB } = await admin.from("facilities").insert({
    org_id: org.id, name: `ZZ Flat Arena ${stamp}`, slug: `zz-flat-${stamp}`,
    address_line1: "2 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
  }).select("id").single();
  for (const [i, name] of ["Rink A", "Rink B"].entries()) {
    await admin.from("spaces").insert({
      org_id: org.id, facility_id: facB.id, department_id: null, name,
      slug: `zz-rink-${i}-${stamp}`, display_order: i + 1, is_published: true,
    });
  }
  const { data: flatSchedule } = await admin.from("schedule_groups").insert({
    org_id: org.id, facility_id: facB.id, department_id: null,
    name: `ZZ Public Skate ${stamp}`, slug: `zz-skate-${stamp}`,
    sport_category: "skating", activity_type: "drop_in", status: "published", source: "manual",
  }).select("id").single();

  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies(cookieParts(signIn.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
  const page = await context.newPage();

  const pickerSpaces = async (scheduleGroupId) => {
    await page.goto(`${APP}/dashboard/schedule/sessions/new?scheduleGroupId=${scheduleGroupId}`, { waitUntil: "networkidle" });
    return (await page.locator("button[aria-pressed]").allInnerTexts()).map((t) => t.trim());
  };

  try {
    const aquatics = await pickerSpaces(aquaticsSchedule.id);
    check("THE BUG: no tennis court in the Aquatics picker", !aquatics.includes("Tennis Court"), aquatics.join(", "));
    check("positive control: the Aquatics lanes are still offered",
      ["Lane 1", "Lane 2", "Lane 3"].every((n) => aquatics.includes(n)), aquatics.join(", "));

    // A department-less building must not be collateral damage.
    const flat = await pickerSpaces(flatSchedule.id);
    check("control: a facility with no departments still offers its spaces",
      flat.includes("Rink A") && flat.includes("Rink B"), flat.join(", "));

    // Templates: the same picker, previously not scoped at all.
    await page.goto(`${APP}/dashboard/sessions/new?facility=${fac.id}&department=${dept.Aquatics}`, { waitUntil: "networkidle" });
    const templateBody = await page.locator("body").innerText();
    check("template 'usual spaces' excludes the tennis court", !/Tennis Court/.test(templateBody));
    check("positive control: template still offers the lanes", /Lane 1/.test(templateBody));

    // The empty-picker dead end is explained, not silent.
    const { data: tennisSchedule } = await admin.from("schedule_groups").insert({
      org_id: org.id, facility_id: fac.id, department_id: dept.Tennis,
      name: `ZZ Court Time ${stamp}`, slug: `zz-court-time-${stamp}`,
      sport_category: "tennis", activity_type: "drop_in", status: "published", source: "manual",
    }).select("id").single();
    await page.goto(`${APP}/dashboard/schedule/sessions/new?scheduleGroupId=${tennisSchedule.id}`, { waitUntil: "networkidle" });
    const tennisBody = await page.locator("body").innerText();
    check("an empty picker explains where the spaces went", /assign .* on the Spaces page/i.test(tennisBody), tennisBody.match(/No spaces[^\n]*/)?.[0] ?? "no message");
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.message}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
