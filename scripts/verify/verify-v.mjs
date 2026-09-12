/**
 * Occupancy kinds, disclosure, and the staff-only sidecar (migration 046) —
 * stage 1 of docs/PLAN-internal-view.md.
 *
 * Four things this has to prove, each of which fails silently:
 *
 *  1. A 'reserved' booking still publishes its BLOCK (time + spaces) so patrons
 *     learn the water is gone, while its holder name and setup notes appear
 *     nowhere in a public response — not as a field, not inside the label.
 *  2. `session_internal` is unreadable by anon at the RLS layer, not merely
 *     absent from the route's output. The route skipping the query and the
 *     policy refusing it look identical from outside; only a direct select
 *     separates them.
 *  3. An 'internal' booking is absent from a public expand entirely, and so are
 *     its session_spaces rows — which have their own public policy and would
 *     otherwise leak "some session holds Lane 1 at 6am" for a session anon
 *     cannot see.
 *  4. The conflict engine now lets an exclusive claim overlap a residual one
 *     (the rental-during-drop-in case that was a hard 409 before 046) while
 *     still blocking exclusive-vs-exclusive and residual-vs-residual. Asserting
 *     only "the rental saved" would pass against an engine that had simply been
 *     switched off.
 *
 * Positive controls throughout: an org member is asked the same questions as
 * anon on the same fixtures, so "anon sees nothing" is distinguishable from
 * "the fixture never existed" — the false-green this repo has produced twice.
 *
 * Same pattern as its siblings: service-role fixtures, a genuinely signed-in
 * user (or anon, where public visibility is the point) driving real HTTP,
 * teardown in a finally.
 *
 * Fixture note, learned from verify-p/verify-s: migration 037 hides unapproved
 * weeks from anonymous callers, so the week under test is explicitly APPROVED —
 * without that every anonymous assertion here passes for the wrong reason.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

// `--app=http://localhost:3001` to drive a server other than the default dev
// one, the same switch verify-t/perf-nav take. Useful when the dev server has
// wedged: a crashed Next dev worker answers *every* dynamic `[param]` route
// with a 500 and an HTML body, which reads here as a route bug rather than a
// server that needs restarting.
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

/**
 * A second publishable-key client that NEVER signs anyone in, for the direct
 * PostgREST reads below that claim to be anonymous.
 *
 * `anon` is used for signInWithPassword, and supabase-js keeps that session in
 * memory even with persistSession: false — so after section 1 every
 * `anon.from(...)` runs as the last user signed in, which here is the *other
 * org's admin*. Those assertions still passed (an outsider reads zero rows
 * too), but they were testing a different gate than their labels claimed, and
 * the same mistake produced a false failure in verify-y where an org member
 * legitimately saw the row. Caught while building migration 048.
 */
const publicDb = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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

// Distinctive strings: if either ever appears in a public response — as a
// field, or interpolated into a label — a substring search over the whole body
// finds it. "Reserved" alone would be too generic to assert on.
const HOLDER = `ZZIslandSwimming${stamp}`;
const SETUP = `ZZSoftLaneRopesPoloNets${stamp}`;
const HELD_GROUP_NAME = `ZZ Rentals And Clubs ${stamp}`;

// Monday 2026-08-10; the Sunday-start week containing it is 2026-08-09..15.
const WEEK_START = "2026-08-09";
const rangeStart = "2026-08-09T00:00:00Z";
const rangeEnd = "2026-08-15T23:59:59Z";

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-v ${stamp}`, slug: `zz-verify-v-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const adminEmail = `zz-verify-v-admin-${stamp}@example.invalid`;
  const adminPassword = `Zv!${stamp}aA9`;
  const { data: adminUserData } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  ids.users.push(adminUserData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: adminUserData.user.id, role: "admin" });

  // A second org's admin: the "signed in, but an outsider" case. Anon alone
  // would leave it untested whether the gate is publish state or membership.
  const otherOrg = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-v other ${stamp}`, slug: `zz-verify-v-other-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(otherOrg.id);

  const outsiderEmail = `zz-verify-v-outsider-${stamp}@example.invalid`;
  const outsiderPassword = `Zv!${stamp}bB9`;
  const { data: outsiderUserData } = await admin.auth.admin.createUser({
    email: outsiderEmail,
    password: outsiderPassword,
    email_confirm: true,
  });
  ids.users.push(outsiderUserData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: otherOrg.id, user_id: outsiderUserData.user.id, role: "admin" });

  const { data: adminSignIn, error: adminSignInErr } = await anon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (adminSignInErr) throw new Error(`admin signIn: ${adminSignInErr.message}`);
  const adminCookie = sessionCookies(adminSignIn.session);

  const { data: outsiderSignIn, error: outsiderSignInErr } = await anon.auth.signInWithPassword({
    email: outsiderEmail,
    password: outsiderPassword,
  });
  if (outsiderSignInErr) throw new Error(`outsider signIn: ${outsiderSignInErr.message}`);
  const outsiderCookie = sessionCookies(outsiderSignIn.session);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: "ZZ Verify-V Pool",
        slug: `zz-verify-v-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const lane1 = (
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

  // Two published schedule groups. The second is named to look like a renter
  // list, because a "reserved" session's *group name* is one of the three ways
  // a renter's identity can reach the public (the others being its template's
  // name and the sidecar itself).
  async function makeGroup(name, slug) {
    return (
      await admin
        .from("schedule_groups")
        .insert({
          org_id: org.id,
          facility_id: facility.id,
          name,
          slug,
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
  }

  const dropInGroup = await makeGroup(`ZZ Lengths Swimming ${stamp}`, `zz-lengths-${stamp}`);
  const heldGroup = await makeGroup(HELD_GROUP_NAME, `zz-rentals-${stamp}`);

  // Migration 037: without approval, anon sees nothing and every assertion
  // below would pass for the wrong reason.
  for (const groupId of [dropInGroup.id, heldGroup.id]) {
    await admin.from("schedule_week_reviews").insert({
      org_id: org.id,
      schedule_group_id: groupId,
      week_start: WEEK_START,
      status: "approved",
      reviewed_at: new Date().toISOString(),
    });
  }

  const baseSession = {
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: "2026-08-10T06:00:00Z",
    dtend_time: "08:00",
    valid_from: "2026-08-10",
    valid_until: null,
  };

  console.log("\n1. The public drop-in block exists first — every later claim overlaps it");
  const dropIn = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: dropInGroup.id,
      ...baseSession,
      space_ids: [lane1.id, lane2.id],
      occupancy_kind: "drop_in",
      disclosure: "public",
    }),
  });
  check("public drop-in block on Lanes 1-2, 6-8am saves (200)", dropIn.status === 200, JSON.stringify(dropIn.body));

  console.log("\n2. The 409 that used to make this feature impossible");
  // Same lane, same hours. Before 046 this was a hard 409 from
  // findSessionConflict() — it is the exact shape the internal view exists to
  // record, so it must now save.
  const rental = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: heldGroup.id,
      ...baseSession,
      space_ids: [lane1.id],
      occupancy_kind: "rental",
      disclosure: "reserved",
      holder_name: HOLDER,
      setup_notes: SETUP,
    }),
  });
  check(
    "an exclusive rental overlapping a residual drop-in block on the SAME lane saves (200)",
    rental.status === 200,
    JSON.stringify(rental.body)
  );

  console.log("\n3. …but the protection that matters is still on");
  // A second exclusive claim on the same lane at the same time. This is two
  // renters in one lane — the error a lifeguard sheet exists to catch — and it
  // must still be refused. Without this assertion, section 2 would also pass
  // against a conflict engine that had simply been disabled.
  const secondRental = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: heldGroup.id,
      ...baseSession,
      space_ids: [lane1.id],
      occupancy_kind: "rental",
      disclosure: "reserved",
      holder_name: `${HOLDER}Second`,
    }),
  });
  check(
    "exclusive-vs-exclusive on one lane is still refused (409)",
    secondRental.status === 409,
    `${secondRental.status} ${JSON.stringify(secondRental.body)}`
  );

  const secondDropIn = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: dropInGroup.id,
      ...baseSession,
      space_ids: [lane2.id],
      occupancy_kind: "drop_in",
      disclosure: "public",
    }),
  });
  check(
    "residual-vs-residual is still refused (409) — unchanged from before 046",
    secondDropIn.status === 409,
    `${secondDropIn.status} ${JSON.stringify(secondDropIn.body)}`
  );

  console.log("\n4. An internal-only booking, on the other lane");
  const internalSession = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: heldGroup.id,
      ...baseSession,
      space_ids: [lane2.id],
      occupancy_kind: "closure",
      disclosure: "internal",
      holder_name: `${HOLDER}Internal`,
      setup_notes: `${SETUP}Internal`,
    }),
  });
  check(
    "an internal closure saves (200)",
    internalSession.status === 200,
    JSON.stringify(internalSession.body)
  );
  const internalSessionId = internalSession.body.sessionId;

  const expandUrl = `/api/sessions/expand?facilityId=${facility.id}&rangeStart=${encodeURIComponent(
    rangeStart
  )}&rangeEnd=${encodeURIComponent(rangeEnd)}`;

  console.log("\n5. Positive control — staff see everything, including the withheld names");
  const staffView = await api(expandUrl, adminCookie);
  const staffSessions = staffView.body.data ?? [];
  check(
    "staff see all three occurrences (drop-in, rental, internal)",
    staffSessions.length === 3,
    `${staffSessions.length}: ${JSON.stringify(staffSessions.map((s) => s.scheduleGroupName))}`
  );
  const staffRental = staffSessions.find((s) => s.disclosure === "reserved");
  check("staff see the rental's holder name", staffRental?.holderName === HOLDER, JSON.stringify(staffRental));
  check("staff see the rental's setup notes", staffRental?.setupNotes === SETUP, JSON.stringify(staffRental));
  check(
    "staff see the internal occurrence",
    staffSessions.some((s) => s.disclosure === "internal"),
    JSON.stringify(staffSessions.map((s) => s.disclosure))
  );

  console.log("\n6. Anon: the block is published, the identity is not");
  const publicView = await api(expandUrl, null);
  const publicSessions = publicView.body.data ?? [];
  const publicBody = JSON.stringify(publicView.body);

  check(
    "anon sees exactly two occurrences — the drop-in and the reserved block",
    publicSessions.length === 2,
    `${publicSessions.length}: ${JSON.stringify(publicSessions.map((s) => s.scheduleGroupName))}`
  );

  const publicReserved = publicSessions.find((s) => s.disclosure === "reserved");
  check("anon still sees the reserved block itself", !!publicReserved, publicBody);
  check(
    "the reserved block keeps its time (6am start) — the availability patrons came for",
    publicReserved?.start?.includes("T06:00"),
    JSON.stringify(publicReserved)
  );
  check(
    "the reserved block keeps its space (ZZ Lane 1)",
    publicReserved?.spaceNames?.includes("ZZ Lane 1"),
    JSON.stringify(publicReserved?.spaceNames)
  );
  check(
    "the reserved block's label is the generic one, not the group name",
    publicReserved?.scheduleGroupName === "Reserved",
    JSON.stringify(publicReserved?.scheduleGroupName)
  );

  // The three leak routes, asserted against the whole serialized body rather
  // than field by field: a future field that carries the name would slip past
  // a per-field check.
  check("anon response contains the holder name NOWHERE", !publicBody.includes(HOLDER), "found in body");
  check("anon response contains the setup notes NOWHERE", !publicBody.includes(SETUP), "found in body");
  check(
    "anon response contains the renter-ish group name NOWHERE",
    !publicBody.includes(HELD_GROUP_NAME),
    "found in body"
  );
  check("anon gets holderName null on the reserved block", publicReserved?.holderName === null, publicBody);
  check("anon gets setupNotes null on the reserved block", publicReserved?.setupNotes === null, publicBody);

  console.log("\n7. The internal booking is absent for anon, not merely unlabelled");
  check(
    "no occurrence with disclosure 'internal' reaches anon",
    !publicSessions.some((s) => s.disclosure === "internal"),
    publicBody
  );

  console.log("\n8. A signed-in outsider is treated as public, not as staff");
  const outsiderView = await api(expandUrl, outsiderCookie);
  const outsiderBody = JSON.stringify(outsiderView.body);
  check(
    "another org's admin sees two occurrences, same as anon",
    (outsiderView.body.data ?? []).length === 2,
    outsiderBody
  );
  check("another org's admin never sees the holder name", !outsiderBody.includes(HOLDER), "found in body");

  console.log("\n9. RLS, not route filtering — the distinction the route cannot prove");
  // The route skipping the sidecar query and the policy refusing it produce the
  // same output. Only a direct select separates them, and it is the guarantee
  // migration 046 rests on.
  const { data: anonInternal, error: anonInternalErr } = await publicDb
    .from("session_internal")
    .select("session_id, holder_name, setup_notes");
  check(
    "anon selecting session_internal directly gets zero rows",
    (anonInternal ?? []).length === 0,
    `${JSON.stringify(anonInternal)} ${anonInternalErr?.message ?? ""}`
  );

  const outsiderDb = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${outsiderSignIn.session.access_token}` } },
  });
  const { data: outsiderInternal } = await outsiderDb
    .from("session_internal")
    .select("session_id, holder_name");
  check(
    "another org's admin selecting session_internal directly gets zero rows",
    (outsiderInternal ?? []).length === 0,
    JSON.stringify(outsiderInternal)
  );

  // Positive control for both: the rows genuinely exist. Without this, a
  // migration that never created the table would pass every check above.
  const { data: serviceInternal } = await admin
    .from("session_internal")
    .select("session_id, holder_name")
    .eq("org_id", org.id);
  check(
    "the sidecar rows really exist (service role sees both)",
    (serviceInternal ?? []).length === 2,
    JSON.stringify(serviceInternal)
  );

  console.log("\n10. An internal session's space claims don't leak either");
  // session_spaces has its own public-read policy (migration 033, patched by
  // 046). Left unpatched it would still serve "something holds ZZ Lane 2 at
  // 6am" for a session anon cannot see.
  const { data: anonSpaces } = await publicDb
    .from("session_spaces")
    .select("session_id, space_id")
    .eq("session_id", internalSessionId);
  check(
    "anon reads zero session_spaces rows for the internal session",
    (anonSpaces ?? []).length === 0,
    JSON.stringify(anonSpaces)
  );

  const { data: anonSpacesControl } = await publicDb
    .from("session_spaces")
    .select("session_id, space_id")
    .eq("session_id", rental.body.sessionId);
  check(
    "control: anon DOES read the reserved session's session_spaces rows",
    (anonSpacesControl ?? []).length === 1,
    JSON.stringify(anonSpacesControl)
  );

  console.log("\n11. A partial update must not silently republish a withheld booking");
  // The conflict manager's "move to another space" and the command centre's
  // reschedule both POST/PATCH without mentioning occupancy_kind or disclosure.
  // If either field carried a default through this route, a rental would come
  // back as a public drop-in — and the name in its group would go public with it.
  const reschedule = await api(`/api/sessions/${rental.body.sessionId}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ dtstart: "2026-08-10T06:30:00Z", dtend_time: "08:00" }),
  });
  check(
    "rescheduling the rental succeeds (200)",
    reschedule.status === 200,
    `${reschedule.status} ${JSON.stringify(reschedule.body)}`
  );

  const { data: afterReschedule } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", rental.body.sessionId)
    .single();
  check(
    "the rental is still a rental after a partial update",
    afterReschedule?.occupancy_kind === "rental",
    JSON.stringify(afterReschedule)
  );
  check(
    "the rental is still withheld after a partial update",
    afterReschedule?.disclosure === "reserved",
    JSON.stringify(afterReschedule)
  );

  const { data: internalAfter } = await admin
    .from("session_internal")
    .select("holder_name")
    .eq("session_id", rental.body.sessionId)
    .single();
  check(
    "a partial update leaves the holder name alone rather than blanking it",
    internalAfter?.holder_name === HOLDER,
    JSON.stringify(internalAfter)
  );

  console.log("\n12. Clearing a holder name from the form works");
  const cleared = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      sessionId: internalSessionId,
      schedule_group_id: heldGroup.id,
      ...baseSession,
      space_ids: [lane2.id],
      occupancy_kind: "closure",
      disclosure: "internal",
      holder_name: "",
      setup_notes: "",
    }),
  });
  check("saving with both staff fields empty succeeds (200)", cleared.status === 200, JSON.stringify(cleared.body));
  const { data: clearedRow } = await admin
    .from("session_internal")
    .select("session_id")
    .eq("session_id", internalSessionId)
    .maybeSingle();
  check("the sidecar row is gone once both fields are empty", clearedRow === null, JSON.stringify(clearedRow));
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
