/**
 * Persistent demo-org seeder — for *visual* verification, not assertions.
 *
 * The three verify-*.mjs harnesses prove the data layer and tear their fixtures
 * down in a finally. This one deliberately does NOT tear down: the seven
 * unverified surfaces (events calendar, Events tab, feature dialogs, brochure
 * editor, published brochure, and both print stylesheets) can only be looked at
 * if the data is still there when a browser arrives.
 *
 * It prints a ready-to-paste document.cookie snippet so a browser can be
 * authenticated the way the harnesses authenticate — by installing the session
 * @supabase/ssr would have written — rather than by typing a password into the
 * login form.
 *
 * Everything it creates is prefixed `ZZ `. Clean up with:
 *   node scripts/verify/seed-demo.mjs --clean
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

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
const COOKIE = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

// ------------------------------------------------------------------ cleanup
if (process.argv.includes("--clean")) {
  const { data: orgs } = await admin.from("organizations").select("id, name").like("name", "ZZ Demo%");
  for (const o of orgs ?? []) {
    const { data: members } = await admin.from("org_memberships").select("user_id").eq("org_id", o.id);
    await admin.from("organizations").delete().eq("id", o.id);
    for (const m of members ?? []) await admin.auth.admin.deleteUser(m.user_id).catch(() => {});
    console.log(`deleted ${o.name} (${o.id})`);
  }
  console.log(`${orgs?.length ?? 0} demo org(s) removed.`);
  process.exit(0);
}

const stamp = Date.now();
const email = `zz-demo-${stamp}@example.invalid`;
const password = `Zd!${stamp}aA9`;
const ids = {};

// The seeded month. Events land in the current month so the calendar opens onto
// content rather than onto an empty grid that reads as a bug.
const now = new Date();
const Y = now.getUTCFullYear();
const M = now.getUTCMonth(); // 0-based
const iso = (d, h = 18) =>
  new Date(Date.UTC(Y, M, d, h, 0, 0)).toISOString();
const day = (d) => new Date(Date.UTC(Y, M, d)).toISOString().slice(0, 10);
const monthStart = day(1);
const monthEnd = new Date(Date.UTC(Y, M + 1, 0)).toISOString().slice(0, 10);

const org = (await admin
  .from("organizations")
  .insert({ name: `ZZ Demo Recreation`, slug: `zz-demo-${stamp}`, status: "active" })
  .select("id")
  .single()).data;
ids.org = org.id;

const user = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data;
ids.user = user.user.id;
await admin.from("org_memberships").insert({ org_id: ids.org, user_id: ids.user, role: "admin" });

const season = (await admin
  .from("seasons")
  .insert({
    org_id: ids.org,
    name: "ZZ Fall 2026",
    slug: `zz-fall-${stamp}`,
    starts_on: monthStart,
    ends_on: "2026-12-20",
    status: "active",
  })
  .select("id")
  .single()).data;
ids.season = season.id;

const fac = (await admin
  .from("facilities")
  .insert({
    org_id: ids.org,
    name: "ZZ Riverbend Leisure Centre",
    slug: `zz-riverbend-${stamp}`,
    description: "A demo facility seeded for visual verification.",
    address_line1: "1 Riverbend Way",
    city: "Edmonton",
    province: "AB",
    postal_code: "T6R 2M9",
    phone: "780-555-0100",
    is_published: true,
  })
  .select("id")
  .single()).data;
ids.facility = fac.id;

const dept = (await admin
  .from("departments")
  .insert({ org_id: ids.org, facility_id: ids.facility, name: "Aquatics", slug: `aquatics-${stamp}` })
  .select("id")
  .single()).data;
ids.department = dept.id;

// A department-nested group AND a facility-direct one — this is the duplicated
// route tree from the audit, and both branches need to render.
const groups = (await admin
  .from("schedule_groups")
  .insert([
    {
      org_id: ids.org,
      facility_id: ids.facility,
      department_id: ids.department,
      name: "ZZ Lane Swim",
      slug: `zz-lane-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      cost_cents: 600,
      status: "published",
      in_brochure: true,
    },
    {
      org_id: ids.org,
      facility_id: ids.facility,
      name: "ZZ Open Gym",
      slug: `zz-gym-${stamp}`,
      sport_category: "basketball",
      activity_type: "drop_in",
      cost_cents: 0,
      status: "published",
      in_brochure: true,
    },
  ])
  .select("id, name")).data;
ids.deptGroup = groups[0].id;
ids.facGroup = groups[1].id;

// A weekly series plus four one-offs spread across the month, so the calendar
// has both kinds and more than one row of content.
const sessions = (await admin
  .from("sessions")
  .insert([
    {
      org_id: ids.org, schedule_group_id: ids.deptGroup, season_id: ids.season,
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", dtstart: iso(3, 6), dtend_time: "09:00",
      valid_from: monthStart, valid_until: monthEnd, is_active: true,
      is_event: false, in_brochure: false,
    },
    {
      org_id: ids.org, schedule_group_id: ids.facGroup, season_id: ids.season,
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH", dtstart: iso(4, 19), dtend_time: "21:00",
      valid_from: monthStart, valid_until: monthEnd, is_active: true,
      is_event: false, in_brochure: false,
    },
    {
      org_id: ids.org, schedule_group_id: ids.facGroup, season_id: ids.season,
      rrule: "FREQ=DAILY;COUNT=1", dtstart: iso(8, 17), dtend_time: "20:00",
      valid_from: day(8), valid_until: day(8), is_active: true, is_event: true, in_brochure: true,
    },
    {
      org_id: ids.org, schedule_group_id: ids.deptGroup, season_id: ids.season,
      rrule: "FREQ=DAILY;COUNT=1", dtstart: iso(15, 10), dtend_time: "14:00",
      valid_from: day(15), valid_until: day(15), is_active: true, is_event: true, in_brochure: true,
    },
    {
      org_id: ids.org, schedule_group_id: ids.facGroup, season_id: ids.season,
      rrule: "FREQ=DAILY;COUNT=1", dtstart: iso(22, 18), dtend_time: "22:00",
      valid_from: day(22), valid_until: day(22), is_active: true, is_event: true, in_brochure: true,
    },
    {
      org_id: ids.org, schedule_group_id: ids.deptGroup, season_id: ids.season,
      rrule: "FREQ=DAILY;COUNT=1", dtstart: iso(27, 9), dtend_time: "12:00",
      valid_from: day(27), valid_until: day(27), is_active: true, is_event: true, in_brochure: true,
    },
  ])
  .select("id"));
if (sessions.error) throw new Error(`sessions insert: ${sessions.error.message}`);

const featured = sessions.data.slice(2);
await admin.from("session_features").insert([
  {
    session_id: featured[0].id, org_id: ids.org, title: "ZZ Family Splash Night",
    summary: "Inflatables, music, and the big slide open late.",
    description: "Our monthly family night takes over the leisure pool. Inflatable obstacle course, poolside music, and the big slide running until close. All ages welcome; children under 7 need a guardian in the water.",
    event_category: "Family", accent_color: "#0EA5E9",
    link_url: "https://example.com/splash", link_label: "Register",
  },
  {
    session_id: featured[1].id, org_id: ids.org, title: "ZZ Masters Swim Clinic",
    summary: "Stroke technique with a certified coach.",
    description: "A half-day clinic covering catch, rotation, and turns, filmed above and below the waterline. Capped at 12 swimmers.",
    event_category: "Aquatics", accent_color: "#7C3AED",
    link_url: "https://example.com/masters", link_label: "Sign up",
  },
  {
    session_id: featured[2].id, org_id: ids.org, title: "ZZ Friday Night Hoops",
    summary: "Open run, full court, all skill levels.",
    description: "Full-court open run in the main gym. Bring a light and a dark shirt. Winners hold the court.",
    event_category: "Sports", accent_color: "#F97316",
  },
  {
    session_id: featured[3].id, org_id: ids.org, title: "ZZ Community Pancake Morning",
    summary: "Free breakfast in the main lobby.",
    description: "Volunteers from the community league serve pancakes in the lobby from 9 until noon. Free, no registration.",
    event_category: "Community", accent_color: "#16A34A",
  },
]);

// Sign in the way the harnesses do, and hand back an installable cookie.
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
if (signInErr) throw new Error(`signIn: ${signInErr.message}`);

const value = "base64-" + stringToBase64URL(JSON.stringify(signIn.session));
const MAX = 3180;
const pairs = [];
if (value.length <= MAX) pairs.push([COOKIE, value]);
else for (let i = 0, n = 0; i < value.length; i += MAX, n++) pairs.push([`${COOKIE}.${n}`, value.slice(i, i + MAX)]);

const snippet = pairs
  .map(([k, v]) => `document.cookie=${JSON.stringify(`${k}=${v}; path=/; SameSite=Lax`)};`)
  .join("\n");

fs.writeFileSync("scripts/verify/.demo-cookie.js", snippet + "\nlocation.href='/dashboard';\n");

console.log(`
Seeded ZZ Demo Recreation
  org         ${ids.org}
  facility    ${ids.facility}   (published)
  department  ${ids.department}
  season      ${ids.season}
  groups      dept-nested ${ids.deptGroup} / facility-direct ${ids.facGroup}
  sessions    2 weekly series + 4 featured one-off events this month
  login       ${email}

Cookie snippet written to scripts/verify/.demo-cookie.js
Public URLs:
  /facility/zz-riverbend-${stamp}
  /org/zz-demo-${stamp}
  /org/zz-demo-${stamp}/events

Tear down with:  node scripts/verify/seed-demo.mjs --clean
`);
