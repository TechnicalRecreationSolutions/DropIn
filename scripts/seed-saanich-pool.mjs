/**
 * One-off seed script: creates a facility + Aquatics department + "Lengths
 * Swimming" schedule group + spaces (one per pool area) + sessions,
 * transcribed from the SCP Lengths Swimming Schedule PDF (July 20-26, 2026),
 * under the user's existing org (see TARGET_ORG_ID below -- the app has no
 * org switcher, so a brand-new org would be invisible to a multi-org user).
 *
 * Source data is a single week with different time blocks every day per pool
 * area, so each (space, weekday, time-block) becomes its own session with a
 * single-day BYDAY RRULE. Per user decision: recurrence left open-ended
 * (valid_until = NULL, treated as a repeating weekly pattern), and lane
 * availability (RED/BLUE/BLACK) is appended into location_detail since
 * there's no dedicated schema field for it.
 *
 * dtstart is stored as literal wall-clock digits with a fake "Z" suffix per
 * migration 034 (timezone removed) -- NOT a real UTC instant.
 *
 * Run: node seed-saanich-pool.mjs
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const ENV_PATH = new URL("../.env.local", import.meta.url);
const env = Object.fromEntries(
  fs
    .readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// -----------------------------------------------------------------------
// Day codes used by rrule BYDAY
// -----------------------------------------------------------------------
const DAY = { MON: "MO", TUE: "TU", WED: "WE", THU: "TH", FRI: "FR" };

// status suffix appended to location_detail (append style, per user decision)
const STATUS_LABEL = {
  red: "Reduced Lanes (1-2)",
  blue: "3-4 Lanes Available",
  black: "More Than 4 Lanes Available",
};

// -----------------------------------------------------------------------
// Transcribed schedule data
// Each space has a list of { day, start, end, status } blocks.
// Times are 24h "HH:MM". status in {red, blue, black} or null (unspecified,
// treated as black/normal per legend default for un-colored ranges).
// -----------------------------------------------------------------------
const SPACES = [
  {
    slug: "competition-pool-25m",
    name: "Competition Pool - 25M Short Course",
    blocks: [
      // MON 20
      { day: "MON", start: "09:45", end: "12:00", status: null },
      { day: "MON", start: "12:00", end: "13:00", status: "blue" },
      { day: "MON", start: "13:00", end: "17:30", status: null },
      { day: "MON", start: "17:30", end: "18:00", status: "blue" },
      { day: "MON", start: "19:30", end: "22:00", status: null },
      // TUES 21
      { day: "TUE", start: "09:45", end: "18:00", status: null },
      { day: "TUE", start: "19:30", end: "22:00", status: null },
      // WED 22
      { day: "WED", start: "09:45", end: "12:30", status: null },
      { day: "WED", start: "12:30", end: "13:00", status: "blue" },
      { day: "WED", start: "13:00", end: "18:00", status: null },
      { day: "WED", start: "19:30", end: "20:30", status: "blue" },
      { day: "WED", start: "20:30", end: "22:00", status: null },
      // THURS 23 (no block listed for this pool/day in source)
      // FRI 24
      { day: "FRI", start: "09:45", end: "11:00", status: null },
      { day: "FRI", start: "11:00", end: "11:30", status: "red" },
      { day: "FRI", start: "11:30", end: "12:00", status: "blue" },
      { day: "FRI", start: "12:00", end: "14:00", status: null },
      { day: "FRI", start: "16:00", end: "19:00", status: "blue" },
      { day: "FRI", start: "19:00", end: "22:00", status: null },
    ],
  },
  {
    slug: "competition-pool-50m",
    name: "Competition Pool - 50M Long Course",
    blocks: [
      // MON 20
      { day: "MON", start: "05:30", end: "07:30", status: null },
      { day: "MON", start: "09:00", end: "09:30", status: "blue" },
      // TUES 21
      { day: "TUE", start: "05:30", end: "06:00", status: null },
      { day: "TUE", start: "06:00", end: "07:30", status: "blue" },
      // WED 22
      { day: "WED", start: "05:30", end: "06:00", status: null },
      { day: "WED", start: "08:00", end: "09:00", status: "blue" },
      { day: "WED", start: "09:00", end: "09:30", status: null },
      // THURS 23
      { day: "THU", start: "05:30", end: "07:30", status: null },
      { day: "THU", start: "09:00", end: "09:30", status: "blue" },
      { day: "THU", start: "09:30", end: "11:45", status: null },
      { day: "THU", start: "11:45", end: "13:00", status: "red" },
      { day: "THU", start: "13:00", end: "14:00", status: null },
      { day: "THU", start: "14:00", end: "16:00", status: "blue" },
      { day: "THU", start: "16:00", end: "17:30", status: null },
      { day: "THU", start: "17:30", end: "18:00", status: "blue" },
      { day: "THU", start: "19:30", end: "20:45", status: "red" },
      { day: "THU", start: "20:45", end: "22:00", status: null },
      // FRI 24
      { day: "FRI", start: "05:30", end: "06:00", status: null },
      { day: "FRI", start: "06:00", end: "07:30", status: "red" },
    ],
  },
  {
    slug: "teach-pool-lengths",
    name: "Teach Pool - Lengths",
    blocks: [
      { day: "MON", start: "05:30", end: "07:55", status: "blue" },
      { day: "MON", start: "16:00", end: "19:00", status: "red" },
      { day: "MON", start: "21:00", end: "22:00", status: "blue" },
      { day: "TUE", start: "05:30", end: "07:55", status: "blue" },
      { day: "TUE", start: "20:00", end: "22:00", status: "blue" },
      { day: "WED", start: "05:30", end: "07:55", status: "blue" },
      { day: "WED", start: "21:00", end: "22:00", status: "blue" },
      { day: "THU", start: "05:30", end: "07:55", status: "blue" },
      { day: "THU", start: "16:00", end: "20:00", status: "red" },
      { day: "THU", start: "20:00", end: "22:00", status: "blue" },
      { day: "FRI", start: "05:30", end: "07:55", status: "blue" },
      { day: "FRI", start: "16:00", end: "22:00", status: "red" },
    ],
  },
  {
    slug: "teach-pool-shallow-water-walking",
    name: "Teach Pool - Shallow Water Walking",
    blocks: [
      { day: "MON", start: "05:30", end: "07:45", status: "red" },
      { day: "TUE", start: "05:30", end: "07:55", status: "red" },
      { day: "WED", start: "05:30", end: "07:55", status: "red" },
      { day: "THU", start: "05:30", end: "07:45", status: "red" },
      { day: "FRI", start: "05:30", end: "07:45", status: "red" },
    ],
  },
  {
    slug: "dive-tank-lengths",
    name: "Dive Tank - Lengths",
    blocks: [
      // MON 20
      { day: "MON", start: "05:30", end: "06:30", status: null },
      { day: "MON", start: "06:30", end: "07:55", status: "blue" },
      { day: "MON", start: "07:55", end: "08:55", status: "red" },
      { day: "MON", start: "08:55", end: "10:00", status: "blue" },
      { day: "MON", start: "11:15", end: "12:45", status: "blue" },
      { day: "MON", start: "16:00", end: "19:00", status: "blue" },
      { day: "MON", start: "21:00", end: "22:00", status: null },
      // TUES 21
      { day: "TUE", start: "05:30", end: "06:30", status: null },
      { day: "TUE", start: "06:30", end: "08:00", status: "blue" },
      { day: "TUE", start: "08:55", end: "10:00", status: "blue" },
      { day: "TUE", start: "11:15", end: "12:45", status: "blue" },
      { day: "TUE", start: "16:00", end: "19:00", status: "blue" },
      { day: "TUE", start: "20:00", end: "20:30", status: "red" },
      { day: "TUE", start: "20:30", end: "22:00", status: null },
      // WED 22
      { day: "WED", start: "05:30", end: "07:55", status: null },
      { day: "WED", start: "08:55", end: "09:45", status: "blue" },
      { day: "WED", start: "11:00", end: "12:45", status: "red" },
      { day: "WED", start: "16:00", end: "19:00", status: "blue" },
      { day: "WED", start: "21:00", end: "22:00", status: null },
      // THURS 23
      { day: "THU", start: "05:30", end: "06:45", status: null },
      { day: "THU", start: "06:45", end: "07:55", status: "blue" },
      { day: "THU", start: "09:00", end: "12:45", status: "red" },
      { day: "THU", start: "16:00", end: "19:00", status: "blue" },
      { day: "THU", start: "20:00", end: "20:30", status: "red" },
      { day: "THU", start: "20:30", end: "22:00", status: null },
      // FRI 24
      { day: "FRI", start: "05:30", end: "07:55", status: null },
      { day: "FRI", start: "07:55", end: "10:00", status: "blue" },
      { day: "FRI", start: "11:15", end: "12:45", status: "blue" },
      { day: "FRI", start: "16:00", end: "19:00", status: "blue" },
    ],
  },
  {
    slug: "dive-tank-deep-water-walking",
    name: "Dive Tank - Deep Water Walking",
    blocks: [
      { day: "MON", start: "05:30", end: "11:15", status: "red" },
      { day: "TUE", start: "05:30", end: "11:15", status: "red" },
      { day: "WED", start: "16:00", end: "16:45", status: "red" },
      { day: "THU", start: "05:30", end: "11:15", status: "red" },
      { day: "FRI", start: "05:30", end: "11:15", status: "red" },
    ],
  },
];

// -----------------------------------------------------------------------
function timeToParts(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

// dtstart: literal wall-clock digits with a "Z" suffix (per migration 034 --
// NOT a real UTC instant). Anchor calendar date is arbitrary within the
// target week; rrule BYDAY handles actual weekday selection. Using the
// Mon 2026-07-20 week as the anchor to match the source PDF's dates.
const WEEK_START = { year: 2026, month: 7, day: 20 }; // Monday
const DAY_OFFSET = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4 };

function dtstartFor(day, hhmm) {
  const { h, m } = timeToParts(hhmm);
  const d = WEEK_START.day + DAY_OFFSET[day];
  const dd = String(d).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${WEEK_START.year}-${String(WEEK_START.month).padStart(2, "0")}-${dd}T${hh}:${mm}:00Z`;
}

function dtendTimeFor(hhmm) {
  const { h, m } = timeToParts(hhmm);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

// -----------------------------------------------------------------------
// The app has no org switcher yet (src/lib/auth/membership.ts) -- every page
// resolves a signed-in user to their EARLIEST-joined org, silently. Creating
// a brand-new org here would be invisible to the user without either a
// switcher or backdating joined_at, so this targets their existing main org
// instead (confirmed via org_memberships: joined 2026-07-21, earliest for
// this user).
const TARGET_ORG_ID = "2b55b947-79f2-4a2c-a2c6-e265ef2933b2"; // Technical Recreation Solutions

async function main() {
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", TARGET_ORG_ID)
    .single();
  if (orgErr) throw new Error(`org lookup: ${orgErr.message}`);
  console.log(`Using existing organization: ${org.name} (${org.id})`);

  console.log("Creating facility...");
  const { data: facility, error: facErr } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: "Saanich Commonwealth Pool",
      slug: "saanich-commonwealth-pool",
      address_line1: "4636 Elk Lake Dr",
      city: "Saanich",
      province: "BC",
      postal_code: "V8Z 5M1",
      country: "CA",
      phone: "250-475-7600",
      website_url: "https://www.saanich.ca/swim",
      is_published: true,
    })
    .select()
    .single();
  if (facErr) throw new Error(`facility insert: ${facErr.message}`);
  console.log(`  facility id: ${facility.id}`);

  console.log("Creating department...");
  const { data: dept, error: deptErr } = await admin
    .from("departments")
    .insert({
      facility_id: facility.id,
      org_id: org.id,
      name: "Aquatics",
      slug: "aquatics",
      is_published: true,
    })
    .select()
    .single();
  if (deptErr) throw new Error(`department insert: ${deptErr.message}`);
  console.log(`  department id: ${dept.id}`);

  console.log("Creating schedule group...");
  const { data: sg, error: sgErr } = await admin
    .from("schedule_groups")
    .insert({
      department_id: dept.id,
      org_id: org.id,
      facility_id: facility.id,
      name: "Lengths Swimming",
      slug: "lengths-swimming",
      description:
        "Public lengths swimming across the Competition Pool, Teach Pool, and Dive Tank. Times subject to change at short notice -- call 250-475-7600 to confirm.",
      sport_category: "swimming",
      activity_type: "drop_in",
      status: "published",
      starts_on: "2026-07-20",
      ends_on: null,
      source: "manual",
    })
    .select()
    .single();
  if (sgErr) throw new Error(`schedule_group insert: ${sgErr.message}`);
  console.log(`  schedule_group id: ${sg.id}`);

  console.log("Creating spaces...");
  const spaceIdBySlug = {};
  for (const space of SPACES) {
    const { data, error } = await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: dept.id,
        name: space.name,
        slug: space.slug,
        is_published: true,
      })
      .select()
      .single();
    if (error) throw new Error(`space insert (${space.slug}): ${error.message}`);
    spaceIdBySlug[space.slug] = data.id;
    console.log(`  space "${space.name}" -> ${data.id}`);
  }

  console.log("Creating sessions...");
  let sessionCount = 0;
  for (const space of SPACES) {
    for (const block of space.blocks) {
      const rrule = `FREQ=WEEKLY;BYDAY=${DAY[block.day]}`;
      const locationDetail = block.status ? STATUS_LABEL[block.status] : null;

      const { data: session, error: sessErr } = await admin
        .from("sessions")
        .insert({
          schedule_group_id: sg.id,
          org_id: org.id,
          rrule,
          dtstart: dtstartFor(block.day, block.start),
          dtend_time: dtendTimeFor(block.end),
          valid_from: "2026-07-20",
          valid_until: null,
          location_detail: locationDetail,
          source: "manual",
          is_active: true,
        })
        .select()
        .single();
      if (sessErr)
        throw new Error(
          `session insert (${space.slug} ${block.day} ${block.start}-${block.end}): ${sessErr.message}`
        );

      const { error: linkErr } = await admin.from("session_spaces").insert({
        session_id: session.id,
        space_id: spaceIdBySlug[space.slug],
        org_id: org.id,
      });
      if (linkErr) throw new Error(`session_spaces insert: ${linkErr.message}`);

      sessionCount++;
    }
  }

  console.log(`\nDone. Created ${sessionCount} sessions.`);
  console.log(`Org: ${org.name} (${org.id})`);
  console.log(`Facility: ${facility.name} (${facility.id})`);
  console.log(`View at: http://localhost:3000/dashboard/schedule`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
