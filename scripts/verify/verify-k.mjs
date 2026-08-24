/**
 * Session conflict manager (migration 039 + findOrgConflicts()): two active
 * sessions sharing a space with an overlapping occurrence show up as an
 * active conflict via GET /api/conflicts, including when both belong to a
 * *draft* schedule group and when they only exist because something bypassed
 * the write-time gate (simulated here the same way /api/import/commit does —
 * a direct insert, no findSessionConflict() call); a non-overlapping pair in
 * the same space is a negative control and does NOT show up; dismissing (as
 * a plain member, not just an admin) hides it, restoring brings it back;
 * reassigning one session to a different space via POST /api/sessions
 * resolves it for real (conflict disappears, not just dismissed);
 * deactivating a session resolves it the same way; the dismiss route 404s if
 * either session belongs to another org; and RLS keeps one org's dismissal
 * rows invisible to another org's admin querying the table directly.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, real
 * signed-in users driving the real HTTP routes (or a direct PostgREST query
 * for the RLS check itself), positive controls, teardown in a finally.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = "http://localhost:3000";

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

async function makeOrgWithAdmin(label, stamp) {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ ${label} ${stamp}`, slug: `zz-${label}-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;

  const email = `zz-${label}-admin-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

  const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label} admin signIn: ${error.message}`);

  return { orgId: org.id, userId: userData.user.id, cookie: sessionCookies(signIn.session) };
}

async function addMember(orgId, label, stamp) {
  const email = `zz-${label}-member-${stamp}@example.invalid`;
  const password = `Zk!${stamp}bB9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await admin.from("org_memberships").insert({ org_id: orgId, user_id: userData.user.id, role: "member" });
  const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label} member signIn: ${error.message}`);
  return { userId: userData.user.id, cookie: sessionCookies(signIn.session) };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org1 = await makeOrgWithAdmin("verify-k", stamp);
  ids.orgs.push(org1.orgId);
  ids.users.push(org1.userId);
  const org1Member = await addMember(org1.orgId, "verify-k", stamp);
  ids.users.push(org1Member.userId);

  const org2 = await makeOrgWithAdmin("verify-k2", stamp);
  ids.orgs.push(org2.orgId);
  ids.users.push(org2.userId);

  console.log("\n0. Fixture: a facility with two spaces, a draft schedule, and a pre-existing conflict");
  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org1.orgId,
        name: `ZZ Verify-K Pool ${stamp}`,
        slug: `zz-verify-k-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const spaceA = (
    await admin
      .from("spaces")
      .insert({ org_id: org1.orgId, facility_id: facility.id, name: `Lane A ${stamp}`, slug: `lane-a-${stamp}`, is_published: true })
      .select("id, name")
      .single()
  ).data;
  const spaceB = (
    await admin
      .from("spaces")
      .insert({ org_id: org1.orgId, facility_id: facility.id, name: `Lane B ${stamp}`, slug: `lane-b-${stamp}`, is_published: true })
      .select("id, name")
      .single()
  ).data;

  const scheduleGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org1.orgId,
        facility_id: facility.id,
        name: `ZZ Verify-K Schedule ${stamp}`,
        slug: `zz-verify-k-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  // Two sessions inserted directly (not through POST /api/sessions), the same
  // way /api/import/commit/route.ts does — this is exactly the bypass
  // findOrgConflicts() exists to catch, since the write-time gate never ran.
  const sessionX = (
    await admin
      .from("sessions")
      .insert({
        org_id: org1.orgId,
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstart: "2026-08-10T09:00:00Z",
        dtend_time: "10:00",
        valid_from: "2026-08-10",
        valid_until: null,
        source: "imported",
        is_active: true,
      })
      .select("id")
      .single()
  ).data;
  const sessionY = (
    await admin
      .from("sessions")
      .insert({
        org_id: org1.orgId,
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstart: "2026-08-10T09:30:00Z",
        dtend_time: "10:30",
        valid_from: "2026-08-10",
        valid_until: null,
        source: "imported",
        is_active: true,
      })
      .select("id")
      .single()
  ).data;
  await admin.from("session_spaces").insert([
    { session_id: sessionX.id, space_id: spaceA.id, org_id: org1.orgId },
    { session_id: sessionY.id, space_id: spaceA.id, org_id: org1.orgId },
  ]);

  // Negative control: a third session in the SAME space but a non-overlapping
  // time (11:00-12:00, well clear of 9-10:30) — must never appear as a conflict.
  const sessionZ = (
    await admin
      .from("sessions")
      .insert({
        org_id: org1.orgId,
        schedule_group_id: scheduleGroup.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstart: "2026-08-10T11:00:00Z",
        dtend_time: "12:00",
        valid_from: "2026-08-10",
        valid_until: null,
        source: "imported",
        is_active: true,
      })
      .select("id")
      .single()
  ).data;
  await admin.from("session_spaces").insert([{ session_id: sessionZ.id, space_id: spaceA.id, org_id: org1.orgId }]);

  console.log("\n1. GET /api/conflicts finds the X/Y overlap, including a draft schedule group");
  const list1 = await api("/api/conflicts", org1.cookie);
  check("200", list1.status === 200, JSON.stringify(list1.body));
  const pairKey = sessionX.id < sessionY.id ? `${sessionX.id}_${sessionY.id}` : `${sessionY.id}_${sessionX.id}`;
  const found1 = (list1.body.conflicts ?? []).find((c) => c.key === pairKey);
  check("X/Y conflict reported", !!found1, JSON.stringify(list1.body.conflicts?.map((c) => c.key)));
  check("not dismissed yet", found1 && found1.dismissed === false);
  check(
    "reports the shared space's name",
    found1 && found1.spaceNames.includes(spaceA.name),
    JSON.stringify(found1?.spaceNames)
  );
  check(
    "both sides carry the draft schedule group's status",
    found1 &&
      found1.sessionA.scheduleGroupStatus === "draft" &&
      found1.sessionB.scheduleGroupStatus === "draft"
  );

  console.log("\n2. Negative control — the non-overlapping Z session never pairs with X or Y");
  const zPairKeys = [sessionX.id, sessionY.id].map((id) =>
    id < sessionZ.id ? `${id}_${sessionZ.id}` : `${sessionZ.id}_${id}`
  );
  const zFound = (list1.body.conflicts ?? []).some((c) => zPairKeys.includes(c.key));
  check("Z (non-overlapping, same space) is not reported as a conflict with X or Y", !zFound);

  console.log("\n3. A plain member (not admin) can dismiss the conflict");
  const dismiss = await api("/api/conflicts/dismiss", org1Member.cookie, {
    method: "POST",
    // Deliberately reversed order — the route must normalize it the same
    // way findOrgConflicts()'s pairKey does.
    body: JSON.stringify({ sessionAId: sessionY.id, sessionBId: sessionX.id, note: "Known, fine" }),
  });
  check("member dismiss succeeds (200)", dismiss.status === 200, JSON.stringify(dismiss.body));

  const list2 = await api("/api/conflicts", org1.cookie);
  const found2 = (list2.body.conflicts ?? []).find((c) => c.key === pairKey);
  check("now shows as dismissed", found2 && found2.dismissed === true, JSON.stringify(found2));
  check("dismissal note round-trips", found2 && found2.dismissalNote === "Known, fine");

  console.log("\n4. Restoring (DELETE) brings it back as an active conflict");
  const restore = await api("/api/conflicts/dismiss", org1Member.cookie, {
    method: "DELETE",
    body: JSON.stringify({ sessionAId: sessionX.id, sessionBId: sessionY.id }),
  });
  check("restore succeeds (200)", restore.status === 200, JSON.stringify(restore.body));
  const list3 = await api("/api/conflicts", org1.cookie);
  const found3 = (list3.body.conflicts ?? []).find((c) => c.key === pairKey);
  check("active again", found3 && found3.dismissed === false, JSON.stringify(found3));

  console.log("\n5. Reassigning Y to Space B via POST /api/sessions resolves the conflict for real");
  const reassign = await api("/api/sessions", org1.cookie, {
    method: "POST",
    body: JSON.stringify({
      sessionId: sessionY.id,
      schedule_group_id: scheduleGroup.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: "2026-08-10T09:30:00Z",
      dtend_time: "10:30",
      valid_from: "2026-08-10",
      valid_until: null,
      space_ids: [spaceB.id],
    }),
  });
  check("reassign succeeds (200) — the new space is free", reassign.status === 200, JSON.stringify(reassign.body));
  const list4 = await api("/api/conflicts", org1.cookie);
  const found4 = (list4.body.conflicts ?? []).find((c) => c.key === pairKey);
  check("conflict is gone entirely, not just dismissed", !found4, JSON.stringify(found4));

  console.log("\n6. Put X and Z into direct conflict (Y moved away in step 5, freeing X back up)");
  await admin.from("sessions").update({ dtstart: "2026-08-10T09:00:00Z", dtend_time: "10:00" }).eq("id", sessionZ.id);
  const list5 = await api("/api/conflicts", org1.cookie);
  const xzKey = sessionX.id < sessionZ.id ? `${sessionX.id}_${sessionZ.id}` : `${sessionZ.id}_${sessionX.id}`;
  check("positive control — X/Z now conflict", (list5.body.conflicts ?? []).some((c) => c.key === xzKey));

  console.log("\n7. Dismiss route rejects a pair where one session belongs to another org");
  const org2Session = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org2.orgId,
        facility_id: (
          await admin
            .from("facilities")
            .insert({
              org_id: org2.orgId,
              name: `ZZ Verify-K2 Pool ${stamp}`,
              slug: `zz-verify-k2-pool-${stamp}`,
              address_line1: "1 Test St",
              city: "Vancouver",
              province: "BC",
              postal_code: "V0V 0V0",
              is_published: true,
            })
            .select("id")
            .single()
        ).data.id,
        name: `ZZ Verify-K2 Schedule ${stamp}`,
        slug: `zz-verify-k2-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;
  const org2SessionRow = (
    await admin
      .from("sessions")
      .insert({
        org_id: org2.orgId,
        schedule_group_id: org2Session.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstart: "2026-08-10T09:00:00Z",
        dtend_time: "10:00",
        valid_from: "2026-08-10",
        valid_until: null,
        source: "manual",
        is_active: true,
      })
      .select("id")
      .single()
  ).data;

  const crossOrgDismiss = await api("/api/conflicts/dismiss", org1.cookie, {
    method: "POST",
    body: JSON.stringify({ sessionAId: sessionX.id, sessionBId: org2SessionRow.id }),
  });
  check(
    "cross-org dismiss rejected (404)",
    crossOrgDismiss.status === 404,
    JSON.stringify(crossOrgDismiss.body)
  );

  console.log("\n8. RLS — org2's admin cannot read org1's dismissal rows via a direct table query");
  const dismissXZ = await api("/api/conflicts/dismiss", org1.cookie, {
    method: "POST",
    body: JSON.stringify({ sessionAId: sessionX.id, sessionBId: sessionZ.id }),
  });
  check("dismiss X/Z for the RLS check succeeds", dismissXZ.status === 200, JSON.stringify(dismissXZ.body));

  const org2Fresh = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: org2SignIn } = await org2Fresh.auth.signInWithPassword({
    email: `zz-verify-k2-admin-${stamp}@example.invalid`,
    password: `Zk!${stamp}aA9`,
  });
  check("org2 admin signed in for the RLS check", !!org2SignIn?.session);
  const { data: crossOrgRead, error: crossOrgErr } = await org2Fresh
    .from("session_conflict_dismissals")
    .select("id")
    .eq("org_id", org1.orgId);
  check(
    "org2 admin reads zero rows of org1's dismissals",
    !crossOrgErr && (crossOrgRead?.length ?? 0) === 0,
    JSON.stringify({ crossOrgErr, count: crossOrgRead?.length })
  );

  console.log("\n9. Positive control — org1's own admin CAN read that same dismissal via the API");
  const list7 = await api("/api/conflicts", org1.cookie);
  const found7 = (list7.body.conflicts ?? []).find((c) => c.key === xzKey);
  check("org1 admin's own list shows X/Z dismissed", found7 && found7.dismissed === true, JSON.stringify(found7));

  console.log("\n10. Deactivating Z resolves the (dismissed) X/Z conflict too — it drops out entirely");
  const deactivate = await api(`/api/sessions?sessionId=${sessionZ.id}`, org1.cookie, { method: "DELETE" });
  check("deactivate succeeds (200)", deactivate.status === 200, JSON.stringify(deactivate.body));
  const list8 = await api("/api/conflicts", org1.cookie);
  check(
    "X/Z no longer appears at all once Z is inactive",
    !(list8.body.conflicts ?? []).some((c) => c.key === xzKey)
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
