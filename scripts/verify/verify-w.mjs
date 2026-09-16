/**
 * The staff/patron audience toggle and the conflict manager's occupancy labels
 * — stage 2 of docs/PLAN-internal-view.md.
 *
 * The toggle's whole claim is that Patron view shows what a patron *genuinely*
 * receives rather than a client-side imitation of it, so what has to be proven
 * is that one signed-in caller gets two different payloads for the same week
 * depending only on `audience`:
 *
 *  1. Without the parameter: holder names, internal bookings, unapproved weeks.
 *  2. With `audience=public`: names withheld, internal bookings gone, and an
 *     unapproved week empty — because it is empty for a patron.
 *
 * Point 2's internal-booking half is the one that would fail silently. Internal
 * rows are normally dropped by RLS, which cannot help here: the caller is a real
 * org member, so their own rows come back, and only the app-layer filter in
 * applyDisclosure removes them. A preview that leaked them would look correct in
 * every other respect.
 *
 * Also asserts the parameter can only narrow — an anonymous caller passing it
 * gains nothing, and there is no value that asks for staff treatment.
 *
 * Same pattern as its siblings: service-role fixtures, a genuinely signed-in
 * user driving real HTTP, teardown in a finally. `--app=` as in verify-t.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";

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

const stamp = Date.now();
const ids = { users: [], orgs: [] };

const HOLDER = `ZZWestsideCamps${stamp}`;
const SETUP = `ZZWaveBreakersOut${stamp}`;

// Two weeks, one approved and one not, so the audience toggle's effect on
// week-review visibility is separable from its effect on disclosure.
const APPROVED_WEEK = "2026-08-09"; // Sun 2026-08-09 .. Sat 2026-08-15
const approvedRange = ["2026-08-09T00:00:00Z", "2026-08-15T23:59:59Z"];
const pendingRange = ["2026-08-16T00:00:00Z", "2026-08-22T23:59:59Z"];

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-w ${stamp}`, slug: `zz-verify-w-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const adminEmail = `zz-verify-w-admin-${stamp}@example.invalid`;
  const adminPassword = `Zw!${stamp}aA9`;
  const { data: adminUserData } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  ids.users.push(adminUserData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: adminUserData.user.id, role: "admin" });

  const { data: adminSignIn, error: adminSignInErr } = await anon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (adminSignInErr) throw new Error(`admin signIn: ${adminSignInErr.message}`);
  const adminCookie = sessionCookies(adminSignIn.session);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: "ZZ Verify-W Pool",
        slug: `zz-verify-w-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const lane = (
    await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Lane 1",
        slug: `zz-lane-1-${stamp}`,
        display_order: 1,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const lane2 = (
    await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Lane 2",
        slug: `zz-lane-2-${stamp}`,
        display_order: 2,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const group = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: `ZZ Verify-W Schedule ${stamp}`,
        slug: `zz-verify-w-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        starts_on: "2026-08-10",
        published_at: new Date().toISOString(),
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  // Only the first week is approved. The second is left with no review row at
  // all, which migration 037 reads as 'pending'.
  await admin.from("schedule_week_reviews").insert({
    org_id: org.id,
    schedule_group_id: group.id,
    week_start: APPROVED_WEEK,
    status: "approved",
    reviewed_at: new Date().toISOString(),
  });

  const recurring = {
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: "2026-08-10T06:00:00Z",
    dtend_time: "08:00",
    valid_from: "2026-08-10",
    valid_until: null,
  };

  const publicDropIn = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      ...recurring,
      space_ids: [lane.id],
      occupancy_kind: "drop_in",
      disclosure: "public",
    }),
  });

  const reserved = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      ...recurring,
      space_ids: [lane.id],
      occupancy_kind: "rental",
      disclosure: "reserved",
      holder_name: HOLDER,
      setup_notes: SETUP,
    }),
  });

  const internal = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      ...recurring,
      space_ids: [lane2.id],
      occupancy_kind: "closure",
      disclosure: "internal",
      holder_name: `${HOLDER}Internal`,
    }),
  });

  console.log("\n1. Fixture — three bookings on one approved week");
  check(
    "public drop-in, reserved rental and internal closure all saved",
    publicDropIn.status === 200 && reserved.status === 200 && internal.status === 200,
    `${publicDropIn.status}/${reserved.status}/${internal.status}`
  );

  const weekUrl = (range, audience) =>
    `/api/sessions/expand?facilityId=${facility.id}&rangeStart=${encodeURIComponent(
      range[0]
    )}&rangeEnd=${encodeURIComponent(range[1])}${audience ? `&audience=${audience}` : ""}`;

  console.log("\n2. Staff view — the default, with no parameter at all");
  const staff = await api(weekUrl(approvedRange), adminCookie);
  const staffSessions = staff.body.data ?? [];
  check("staff see all three occurrences", staffSessions.length === 3, `${staffSessions.length}`);
  check(
    "staff see the holder name",
    staffSessions.some((s) => s.holderName === HOLDER),
    JSON.stringify(staffSessions.map((s) => s.holderName))
  );
  check(
    "staff see the setup notes",
    staffSessions.some((s) => s.setupNotes === SETUP),
    JSON.stringify(staffSessions.map((s) => s.setupNotes))
  );

  console.log("\n3. Patron view — the SAME signed-in caller, one parameter different");
  const patron = await api(weekUrl(approvedRange, "public"), adminCookie);
  const patronSessions = patron.body.data ?? [];
  const patronBody = JSON.stringify(patron.body);

  // The drop-in block and the rental share one lane for the same two hours, so
  // residual subtraction (lib/schedule/residual.ts) removes the drop-in from a
  // patron's payload entirely: the lane is rented, and advertising an open swim
  // on it would be false. Staff still get it — asserted above, where all three
  // occurrences come back — because a booking they cannot see is one they cannot
  // fix. That asymmetry is `preserveFullyClaimed`, and this pair of checks is
  // what pins it in both directions.
  check(
    "the internal booking is gone (app-layer filter — RLS cannot help here)",
    !patronSessions.some((s) => s.disclosure === "internal"),
    `${patronSessions.length}: ${JSON.stringify(patronSessions.map((s) => s.disclosure))}`
  );
  check(
    "and so is the drop-in block, whose only lane the rental takes outright",
    !patronSessions.some((s) => s.occupancyKind === "drop_in"),
    JSON.stringify(patronSessions.map((s) => `${s.occupancyKind}/${s.scheduleGroupName}`))
  );
  check("the holder name is gone", !patronBody.includes(HOLDER), "found in body");
  check("the setup notes are gone", !patronBody.includes(SETUP), "found in body");
  check(
    "the withheld booking is labelled Reserved",
    patronSessions.some((s) => s.disclosure === "reserved" && s.scheduleGroupName === "Reserved"),
    JSON.stringify(patronSessions.map((s) => s.scheduleGroupName))
  );
  // What the toggle must NOT do is strip a withheld booking of the availability
  // a patron came for. The name goes; the time and the lane stay, which is what
  // lets residual subtraction stay honest for an outsider at all.
  check(
    "redaction keeps the withheld booking’s time and spaces — only its name goes",
    patronSessions.some(
      (s) => s.disclosure === "reserved" && s.spaceIds.length === 1 && !!s.start && !!s.end
    ),
    JSON.stringify(patronSessions.map((s) => [s.scheduleGroupName, s.spaceIds.length]))
  );

  console.log("\n4. Patron view agrees with what an actual patron receives");
  // The point of fetching server-side rather than filtering in the browser: the
  // preview and the real thing must be the same bytes, or the preview is a
  // second implementation free to drift.
  const realPatron = await api(weekUrl(approvedRange), null);
  const realPatronSessions = realPatron.body.data ?? [];
  check(
    "anon and Patron view return the same occurrence count",
    realPatronSessions.length === patronSessions.length,
    `${realPatronSessions.length} vs ${patronSessions.length}`
  );
  check(
    "anon and Patron view return the same labels, in the same order",
    JSON.stringify(realPatronSessions.map((s) => s.scheduleGroupName)) ===
      JSON.stringify(patronSessions.map((s) => s.scheduleGroupName)),
    `${JSON.stringify(realPatronSessions.map((s) => s.scheduleGroupName))} vs ${JSON.stringify(
      patronSessions.map((s) => s.scheduleGroupName)
    )}`
  );

  console.log("\n5. An unapproved week: full for staff, empty for patrons");
  const staffPending = await api(weekUrl(pendingRange), adminCookie);
  check(
    "staff see the unapproved week's sessions",
    (staffPending.body.data ?? []).length === 3,
    `${(staffPending.body.data ?? []).length}`
  );
  const patronPending = await api(weekUrl(pendingRange, "public"), adminCookie);
  check(
    "Patron view shows the unapproved week as empty — as it is for a patron",
    (patronPending.body.data ?? []).length === 0,
    JSON.stringify(patronPending.body.data)
  );

  console.log("\n6. The parameter can only narrow, never widen");
  const anonWithParam = await api(weekUrl(approvedRange, "public"), null);
  check(
    // One, not two: the drop-in block is subtracted away for every outsider, and
    // a real anon caller must land in exactly the same place the toggle does.
    "anon passing audience=public gains nothing (the same single occurrence)",
    (anonWithParam.body.data ?? []).length === 1,
    JSON.stringify((anonWithParam.body.data ?? []).map((s) => s.scheduleGroupName))
  );
  check(
    "anon passing audience=public still sees no holder name",
    !JSON.stringify(anonWithParam.body).includes(HOLDER),
    "found in body"
  );
  // There is deliberately no value that asks for staff treatment; an invented
  // one must be rejected rather than quietly ignored, so a typo in a caller
  // cannot silently produce a staff payload on a public surface.
  const anonAsStaff = await api(weekUrl(approvedRange, "staff"), null);
  check(
    "audience=staff is rejected outright (400), not ignored",
    anonAsStaff.status === 400,
    `${anonAsStaff.status} ${JSON.stringify(anonAsStaff.body)}`
  );

  console.log("\n7. The conflict manager labels what kind of claim each side is");
  // Two exclusive claims on one lane — inserted directly, the way
  // /api/import/commit does, since the write route would (correctly) refuse the
  // second one.
  const { data: rentalA } = await admin
    .from("sessions")
    .insert({
      org_id: org.id,
      schedule_group_id: group.id,
      ...recurring,
      occupancy_kind: "rental",
      disclosure: "reserved",
      source: "manual",
      is_active: true,
    })
    .select("id")
    .single();
  const { data: rentalB } = await admin
    .from("sessions")
    .insert({
      org_id: org.id,
      schedule_group_id: group.id,
      ...recurring,
      occupancy_kind: "rental",
      disclosure: "reserved",
      source: "manual",
      is_active: true,
    })
    .select("id")
    .single();
  await admin.from("session_spaces").insert([
    { session_id: rentalA.id, space_id: lane2.id, org_id: org.id },
    { session_id: rentalB.id, space_id: lane2.id, org_id: org.id },
  ]);

  const conflicts = await api("/api/conflicts", adminCookie);
  const pairs = conflicts.body.conflicts ?? [];
  const rentalPair = pairs.find(
    (c) =>
      [c.sessionA.sessionId, c.sessionB.sessionId].includes(rentalA.id) &&
      [c.sessionA.sessionId, c.sessionB.sessionId].includes(rentalB.id)
  );
  check("the two rentals on one lane are reported as a conflict", !!rentalPair, JSON.stringify(pairs.length));
  check(
    "both sides carry their occupancy kind, so the manager can label them",
    rentalPair?.sessionA.occupancyKind === "rental" && rentalPair?.sessionB.occupancyKind === "rental",
    JSON.stringify([rentalPair?.sessionA.occupancyKind, rentalPair?.sessionB.occupancyKind])
  );
  check(
    "both sides carry their disclosure",
    rentalPair?.sessionA.disclosure === "reserved" && rentalPair?.sessionB.disclosure === "reserved",
    JSON.stringify([rentalPair?.sessionA.disclosure, rentalPair?.sessionB.disclosure])
  );

  console.log("\n8. …and does NOT report the rental-during-drop-in pair as one");
  // The negative control that matters most: the drop-in block and the reserved
  // rental from section 1 share ZZ Lane 1 at the same hours. Reported here, the
  // page would fill with one row per rental as soon as a customer used the
  // feature, and staff would stop reading it.
  const dropInVsRental = pairs.find(
    (c) =>
      [c.sessionA.sessionId, c.sessionB.sessionId].includes(publicDropIn.body.sessionId) &&
      [c.sessionA.sessionId, c.sessionB.sessionId].includes(reserved.body.sessionId)
  );
  check(
    "an exclusive-vs-residual pair on the same lane is not a conflict",
    !dropInVsRental,
    JSON.stringify(dropInVsRental)
  );
} finally {
  for (const id of ids.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of ids.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const { data: leftover } = await admin.from("organizations").select("id, name").like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftover?.length ?? 0} org(s) left over${
      leftover?.length ? ` — ${leftover.map((o) => o.name).join(", ")}` : ""
    }`
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
