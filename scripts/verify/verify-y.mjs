/**
 * Facility configurations — the bulkhead (migration 048, stage 3 of
 * docs/PLAN-internal-view.md).
 *
 * What this proves, in the order the sections run:
 *
 * 1. A space created without a configuration is in EVERY configuration
 *    (`configuration_id IS NULL`) — the default that makes this migration a
 *    no-op for existing customers. Positive control: one created with a
 *    configuration keeps it.
 * 2. The two boundaries the schema deliberately does not enforce, and the API
 *    therefore must: only owners/admins may manage configurations, and a space
 *    cannot be assigned to another building's configuration (migration 048's
 *    closing note explains why there is no cross-table CHECK).
 * 3. /api/sessions/expand carries the configuration a session's lanes imply,
 *    for staff AND for anon — including for a `reserved` booking, whose
 *    *identity* is withheld while its availability is not. The label is
 *    publicly readable by design (decision 6); the renter's name still is not.
 * 4. Cross-configuration overlaps are an ADVISORY and never a 409 (decisions 4
 *    and 5). Both bookings save; /api/conflicts reports the pair with
 *    severity "advisory"; and two negative controls keep the predicate honest —
 *    an every-configuration space (the hot tub) pairs with nothing, and two
 *    lanes in the *same* configuration produce no row at all.
 * 5. A real double-booking still outranks it: a same-space overlapping pair
 *    comes back as severity "conflict", which is what the Overview's
 *    "Conflicts" card counts.
 * 6. Deleting a configuration returns its lanes to "every configuration" and
 *    touches no session (ON DELETE SET NULL) — and the advisory it was causing
 *    disappears, because there is no longer a disagreement to report.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures (org, users,
 * facility, spaces, schedule group — none of them the thing under test), real
 * signed-in users driving the real HTTP routes, a direct PostgREST query where
 * RLS itself is the mechanism under test, positive controls throughout, and
 * teardown in a finally.
 *
 * `dtstart` holds local wall-clock digits with no real instant meaning (see
 * dropin/docs/RESUME-timezone-removal.md), so every dtstart below is a literal
 * "Z"-suffixed digit string. 2026-08-10 is a real Monday.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

// `--app=http://localhost:3001` to drive a server other than the default dev
// one — see the wedged-dev-server note in README.md.
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
 * A second publishable-key client that NEVER signs anyone in — the only way to
 * query as a genuine anonymous visitor.
 *
 * `anon` above is used for signInWithPassword, and a supabase-js client keeps
 * that session in memory even with persistSession: false, so every later
 * `anon.from(...)` runs as whoever signed in last. Section 3's RLS assertion
 * failed on its first run for exactly that reason — as an org member it saw the
 * unpublished facility's configuration by right, and read as a policy hole.
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

function pairKeyOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

try {
  // ------------------------------------------------------------- fixtures
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-y ${stamp}`, slug: `zz-verify-y-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  async function makeUser(role) {
    const email = `zz-verify-y-${role}-${stamp}@example.invalid`;
    const password = `Zy!${stamp}${role}A9`;
    const { data: userData } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    ids.users.push(userData.user.id);
    await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role });
    const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`${role} signIn: ${error.message}`);
    return { userId: userData.user.id, cookie: sessionCookies(signIn.session) };
  }

  const adminUser = await makeUser("admin");
  const memberUser = await makeUser("member");

  async function makeFacility(name, slug, isPublished) {
    return (
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name,
          slug,
          address_line1: "1 Test St",
          city: "Vancouver",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: isPublished,
        })
        .select("id")
        .single()
    ).data;
  }

  const pool = await makeFacility(`ZZ Verify-Y Pool ${stamp}`, `zz-verify-y-pool-${stamp}`, true);
  // Unpublished, and used for two separate things: the cross-facility boundary
  // check in section 2, and the RLS predicate in section 3 (a configuration at
  // an unpublished facility must not be readable by anon).
  const annex = await makeFacility(`ZZ Verify-Y Annex ${stamp}`, `zz-verify-y-annex-${stamp}`, false);

  // The first configuration is created through the real route, so section 2's
  // 403 has a 201 to be measured against.
  const createdByAdmin = await api("/api/facility-configurations", adminUser.cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: pool.id, name: "Long Course (50m)" }),
  });

  const longCourse = createdByAdmin.body.configuration;
  // Everything below hangs off this one, so a failure here has to say so
  // plainly rather than surfacing as a dozen unrelated nulls.
  if (!longCourse?.id) {
    throw new Error(
      `fixture: POST /api/facility-configurations failed (${createdByAdmin.status}) ${JSON.stringify(
        createdByAdmin.body
      )}`
    );
  }

  const shortCourse = (
    await admin
      .from("facility_configurations")
      .insert({ org_id: org.id, facility_id: pool.id, name: "Short Course (25m)", display_order: 1 })
      .select("id, name")
      .single()
  ).data;

  const annexConfig = (
    await admin
      .from("facility_configurations")
      .insert({ org_id: org.id, facility_id: annex.id, name: "Annex layout", display_order: 0 })
      .select("id, name")
      .single()
  ).data;

  async function makeSpace(name, configurationId) {
    return (
      await admin
        .from("spaces")
        .insert({
          org_id: org.id,
          facility_id: pool.id,
          name: `${name} ${stamp}`,
          slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${stamp}`,
          is_published: true,
          ...(configurationId ? { configuration_id: configurationId } : {}),
        })
        .select("id, name, configuration_id")
        .single()
    ).data;
  }

  const laneL1 = await makeSpace("LC Lane 1", longCourse.id);
  const laneL2 = await makeSpace("LC Lane 2", longCourse.id);
  const laneS1 = await makeSpace("SC Lane 1", shortCourse.id);
  const laneS2 = await makeSpace("SC Lane 2", shortCourse.id);
  // No configuration: the hot tub exists whatever the bulkhead is doing.
  const hotTub = await makeSpace("Hot Tub", null);

  const scheduleGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: pool.id,
        name: `ZZ Verify-Y Schedule ${stamp}`,
        slug: `zz-verify-y-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        starts_on: "2026-08-10",
        ends_on: "2026-12-31",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  // Publishing the schedule is not enough for an anonymous read: migration 037
  // hides any week no admin has approved. Sunday-start week containing Mon
  // 2026-08-10 — the same fixture requirement verify-f/p/s document.
  await admin.from("schedule_week_reviews").insert({
    org_id: org.id,
    schedule_group_id: scheduleGroup.id,
    week_start: "2026-08-09",
    status: "approved",
    reviewed_at: new Date().toISOString(),
  });

  const baseSession = {
    schedule_group_id: scheduleGroup.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    valid_from: "2026-08-10",
    valid_until: null,
  };

  async function createSession(overrides) {
    return api("/api/sessions", adminUser.cookie, {
      method: "POST",
      body: JSON.stringify({ ...baseSession, ...overrides }),
    });
  }

  // ---------------------------------------------------------------------
  console.log("\n1. NULL means 'every configuration' — the default that changes nothing");
  check(
    "a space inserted with no configuration_id is NULL, not an error",
    hotTub.configuration_id === null,
    JSON.stringify(hotTub)
  );
  check(
    "positive control — a space inserted with one keeps it",
    laneL1.configuration_id === longCourse?.id,
    JSON.stringify({ lane: laneL1.configuration_id, expected: longCourse?.id })
  );

  const spaceNoConfig = await api("/api/spaces", adminUser.cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: pool.id, name: `Sauna ${stamp}` }),
  });
  check(
    "POST /api/spaces without configuration_id creates a space in every configuration",
    spaceNoConfig.status === 201 && spaceNoConfig.body.space?.configuration_id === null,
    JSON.stringify(spaceNoConfig.body)
  );

  const spaceWithConfig = await api("/api/spaces", adminUser.cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: pool.id,
      name: `SC Lane 3 ${stamp}`,
      configuration_id: shortCourse.id,
    }),
  });
  check(
    "POST /api/spaces with a same-facility configuration_id stores it",
    spaceWithConfig.status === 201 &&
      spaceWithConfig.body.space?.configuration_id === shortCourse.id,
    JSON.stringify(spaceWithConfig.body)
  );

  // ---------------------------------------------------------------------
  console.log("\n2. The two boundaries the schema leaves to the API");
  check(
    "an admin can create a configuration (201)",
    createdByAdmin.status === 201 && !!longCourse?.id,
    JSON.stringify(createdByAdmin.body)
  );
  const memberCreate = await api("/api/facility-configurations", memberUser.cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: pool.id, name: `Member attempt ${stamp}` }),
  });
  check(
    "a plain member cannot — configurations decide which lanes exist, so this is facility setup (403)",
    memberCreate.status === 403,
    `status=${memberCreate.status} ${JSON.stringify(memberCreate.body)}`
  );

  const duplicateName = await api("/api/facility-configurations", adminUser.cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: pool.id, name: "Long Course (50m)" }),
  });
  check(
    "a duplicate name at the same facility is rejected with a readable message",
    duplicateName.status >= 400 && /already has a configuration/i.test(duplicateName.body.error ?? ""),
    `status=${duplicateName.status} ${JSON.stringify(duplicateName.body)}`
  );

  const crossFacilityCreate = await api("/api/spaces", adminUser.cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: pool.id,
      name: `Cross lane ${stamp}`,
      configuration_id: annexConfig.id,
    }),
  });
  check(
    "a space cannot be created in another building's configuration (404)",
    crossFacilityCreate.status === 404,
    `status=${crossFacilityCreate.status} ${JSON.stringify(crossFacilityCreate.body)}`
  );

  const crossFacilityPatch = await api(`/api/spaces/${laneL1.id}`, adminUser.cookie, {
    method: "PATCH",
    body: JSON.stringify({ configuration_id: annexConfig.id }),
  });
  check(
    "nor moved into one by PATCH (404)",
    crossFacilityPatch.status === 404,
    `status=${crossFacilityPatch.status} ${JSON.stringify(crossFacilityPatch.body)}`
  );
  const { data: laneAfterPatch } = await admin
    .from("spaces")
    .select("configuration_id")
    .eq("id", laneL1.id)
    .single();
  check(
    "and the refused PATCH left the lane where it was",
    laneAfterPatch.configuration_id === longCourse.id,
    JSON.stringify(laneAfterPatch)
  );

  // ---------------------------------------------------------------------
  console.log("\n3. expand carries the configuration — to staff, to anon, and for a withheld booking");
  const dropIn = await createSession({
    dtstart: "2026-08-10T06:00:00Z",
    dtend_time: "08:00",
    space_ids: [laneL1.id, laneL2.id],
    occupancy_kind: "drop_in",
    disclosure: "public",
  });
  check("a long-course drop-in block saves", dropIn.status < 300, JSON.stringify(dropIn.body));

  const tubBlock = await createSession({
    dtstart: "2026-08-10T10:00:00Z",
    dtend_time: "11:00",
    space_ids: [hotTub.id],
    occupancy_kind: "program",
    disclosure: "public",
  });
  check("a hot-tub program saves", tubBlock.status < 300, JSON.stringify(tubBlock.body));

  const rental = await createSession({
    dtstart: "2026-08-10T10:00:00Z",
    dtend_time: "11:00",
    space_ids: [laneL1.id],
    occupancy_kind: "rental",
    disclosure: "reserved",
    holder_name: `Island Swimming ${stamp}`,
    setup_notes: "Soft lane ropes, polo nets",
  });
  check(
    "a long-course rental on a lane the drop-in block also lists saves (residual vs exclusive, migration 046)",
    rental.status < 300,
    JSON.stringify(rental.body)
  );

  const RANGE = `rangeStart=2026-08-10T00:00:00.000Z&rangeEnd=2026-08-17T00:00:00.000Z`;
  const staffExpand = await api(`/api/sessions/expand?facilityId=${pool.id}&${RANGE}`, adminUser.cookie);
  const staffRows = staffExpand.body.data ?? [];
  const staffDropIn = staffRows.find((s) => s.sessionId === dropIn.body.sessionId);
  check(
    "staff see the drop-in block's configuration, named",
    !!staffDropIn &&
      staffDropIn.configurationIds?.length === 1 &&
      staffDropIn.configurationIds[0] === longCourse.id &&
      staffDropIn.configurationNames?.join() === "Long Course (50m)",
    JSON.stringify(staffDropIn?.configurationIds ?? staffExpand.body)
  );
  const staffTub = staffRows.find((s) => s.sessionId === tubBlock.body.sessionId);
  check(
    "a session on an every-configuration space reports none — the normal case everywhere no bulkhead exists",
    !!staffTub && staffTub.configurationIds?.length === 0 && staffTub.configurationNames?.length === 0,
    JSON.stringify(staffTub?.configurationIds)
  );

  const anonExpand = await api(`/api/sessions/expand?facilityId=${pool.id}&${RANGE}`);
  const anonRows = anonExpand.body.data ?? [];
  const anonRental = anonRows.find((s) => s.sessionId === rental.body.sessionId);
  check(
    "anon sees the reserved rental's block at all (availability, not identity)",
    !!anonRental,
    JSON.stringify(anonRows.map((s) => s.sessionId))
  );
  check(
    "and its configuration is published with it — 'can I swim 50s tonight' is a patron question",
    !!anonRental && anonRental.configurationNames?.join() === "Long Course (50m)",
    JSON.stringify(anonRental?.configurationNames)
  );
  check(
    "while the holder's name and setup notes stay withheld (migration 046 still holds)",
    !!anonRental &&
      anonRental.holderName === null &&
      anonRental.setupNotes === null &&
      !JSON.stringify(anonExpand.body).includes("Island Swimming"),
    JSON.stringify({ holder: anonRental?.holderName, notes: anonRental?.setupNotes })
  );

  // RLS itself, not the route: the configuration table is readable for a
  // published facility and not for an unpublished one.
  const { data: anonConfigs } = await publicDb
    .from("facility_configurations")
    .select("id, facility_id")
    .in("facility_id", [pool.id, annex.id]);
  check(
    "anon can read a published facility's configurations directly (decision 6)",
    (anonConfigs ?? []).some((c) => c.facility_id === pool.id),
    JSON.stringify(anonConfigs)
  );
  check(
    "but not an unpublished facility's — the policy is gated on the facility, not on a flag of its own",
    !(anonConfigs ?? []).some((c) => c.facility_id === annex.id),
    JSON.stringify(anonConfigs)
  );

  // ---------------------------------------------------------------------
  console.log("\n4. Cross-configuration overlap is an advisory, never a 409");
  const scProgram = await createSession({
    dtstart: "2026-08-10T10:00:00Z",
    dtend_time: "11:00",
    space_ids: [laneS1.id],
    occupancy_kind: "program",
    disclosure: "public",
  });
  check(
    "a short-course program overlapping the long-course rental SAVES — the schema cannot know they are the same water",
    scProgram.status < 300,
    `status=${scProgram.status} ${JSON.stringify(scProgram.body)}`
  );

  const lcProgram2 = await createSession({
    dtstart: "2026-08-10T10:00:00Z",
    dtend_time: "11:00",
    space_ids: [laneL2.id],
    occupancy_kind: "program",
    disclosure: "public",
  });
  check(
    "a second long-course program on a different lane also saves",
    lcProgram2.status < 300,
    JSON.stringify(lcProgram2.body)
  );

  const conflicts1 = await api("/api/conflicts", adminUser.cookie);
  check("GET /api/conflicts 200", conflicts1.status === 200, JSON.stringify(conflicts1.body));
  const rows1 = conflicts1.body.conflicts ?? [];

  const advisoryKey = pairKeyOf(rental.body.sessionId, scProgram.body.sessionId);
  const advisory = rows1.find((c) => c.key === advisoryKey);
  check(
    "the long-course/short-course overlap is reported as severity 'advisory'",
    advisory?.severity === "advisory",
    JSON.stringify(rows1.map((c) => ({ key: c.key, severity: c.severity })))
  );
  check(
    "with no shared space, which is exactly why it is not a conflict",
    !!advisory && advisory.spaceIds.length === 0 && advisory.spaceNames.length === 0,
    JSON.stringify(advisory?.spaceNames)
  );
  check(
    "and both sides naming the configuration they need",
    !!advisory &&
      [advisory.sessionA, advisory.sessionB].every((p) => p.configurationNames.length === 1) &&
      [advisory.sessionA, advisory.sessionB]
        .flatMap((p) => p.configurationNames)
        .sort()
        .join("|") === ["Long Course (50m)", "Short Course (25m)"].sort().join("|"),
    JSON.stringify([advisory?.sessionA.configurationNames, advisory?.sessionB.configurationNames])
  );

  const tubKey = pairKeyOf(rental.body.sessionId, tubBlock.body.sessionId);
  check(
    "negative control — the hot tub (every configuration) overlapping the rental is NOT reported",
    !rows1.some((c) => c.key === tubKey),
    JSON.stringify(rows1.map((c) => c.key))
  );

  const sameConfigKey = pairKeyOf(rental.body.sessionId, lcProgram2.body.sessionId);
  check(
    "negative control — two lanes in the SAME configuration produce no row at all",
    !rows1.some((c) => c.key === sameConfigKey),
    JSON.stringify(rows1.map((c) => c.key))
  );

  // ---------------------------------------------------------------------
  console.log("\n5. A real double-booking still outranks the advisory");
  // Inserted directly, the way /api/import/commit does — the write-time gate
  // never runs, which is the whole reason findOrgConflicts exists.
  const clashA = (
    await admin
      .from("sessions")
      .insert({
        org_id: org.id,
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstart: "2026-08-10T14:00:00Z",
        dtend_time: "15:00",
        valid_from: "2026-08-10",
        valid_until: null,
        source: "imported",
        occupancy_kind: "program",
        disclosure: "public",
      })
      .select("id")
      .single()
  ).data;
  const clashB = (
    await admin
      .from("sessions")
      .insert({
        org_id: org.id,
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstart: "2026-08-10T14:30:00Z",
        dtend_time: "15:30",
        valid_from: "2026-08-10",
        valid_until: null,
        source: "imported",
        occupancy_kind: "rental",
        disclosure: "reserved",
      })
      .select("id")
      .single()
  ).data;
  await admin.from("session_spaces").insert([
    { session_id: clashA.id, space_id: laneS2.id, org_id: org.id },
    { session_id: clashB.id, space_id: laneS2.id, org_id: org.id },
  ]);

  const conflicts2 = await api("/api/conflicts", adminUser.cookie);
  const clashKey = pairKeyOf(clashA.id, clashB.id);
  const clash = (conflicts2.body.conflicts ?? []).find((c) => c.key === clashKey);
  check(
    "two exclusive claims on one lane are severity 'conflict', not 'advisory'",
    clash?.severity === "conflict",
    JSON.stringify((conflicts2.body.conflicts ?? []).map((c) => ({ key: c.key, severity: c.severity })))
  );
  check(
    "and it names the shared space",
    !!clash && clash.spaceNames.includes(laneS2.name),
    JSON.stringify(clash?.spaceNames)
  );

  // ---------------------------------------------------------------------
  console.log("\n6. Deleting a configuration relabels the building — it does not demolish it");
  const del = await api(`/api/facility-configurations/${shortCourse.id}`, adminUser.cookie, {
    method: "DELETE",
  });
  check("DELETE /api/facility-configurations/[id] 200", del.status === 200, JSON.stringify(del.body));

  const { data: freedLanes } = await admin
    .from("spaces")
    .select("id, configuration_id")
    .in("id", [laneS1.id, laneS2.id]);
  check(
    "its lanes come back as 'every configuration' rather than being deleted (ON DELETE SET NULL)",
    (freedLanes ?? []).length === 2 && (freedLanes ?? []).every((s) => s.configuration_id === null),
    JSON.stringify(freedLanes)
  );

  const { data: survivingSession } = await admin
    .from("sessions")
    .select("id, is_active")
    .eq("id", scProgram.body.sessionId)
    .single();
  const { data: survivingLink } = await admin
    .from("session_spaces")
    .select("space_id")
    .eq("session_id", scProgram.body.sessionId);
  check(
    "the session in those lanes is untouched — still active, still attached to its lane",
    survivingSession?.is_active === true &&
      (survivingLink ?? []).some((l) => l.space_id === laneS1.id),
    JSON.stringify({ session: survivingSession, links: survivingLink })
  );

  const conflicts3 = await api("/api/conflicts", adminUser.cookie);
  const rows3 = conflicts3.body.conflicts ?? [];
  check(
    "and the advisory it was causing is gone — with one configuration left there is nothing to disagree about",
    !rows3.some((c) => c.key === advisoryKey),
    JSON.stringify(rows3.map((c) => ({ key: c.key, severity: c.severity })))
  );
  check(
    "positive control — the real double-booking on the same lane is still reported",
    rows3.some((c) => c.key === clashKey && c.severity === "conflict"),
    JSON.stringify(rows3.map((c) => ({ key: c.key, severity: c.severity })))
  );
} catch (e) {
  console.error("FATAL:", e);
  fail++;
} finally {
  for (const id of ids.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of ids.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const { data: leftover } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftover?.length ?? 0} org(s) left over${
      leftover?.length ? ` — ${leftover.map((o) => o.name).join(", ")}` : ""
    }`
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
