/**
 * Activity log (migration 038): facilities create logs an insert row with
 * the actor's email and a label, editing logs an update with changed_fields,
 * a pure updated_at bump from migration 035's session-write touch trigger
 * does NOT get logged, revert_activity() actually restores data (update,
 * undo-create, undo-delete), only owner/admin can revert (member gets 403),
 * an already-reverted entry can't be reverted twice, and RLS keeps one org's
 * log invisible to another org's admin querying the table directly.
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
  const password = `Zj!${stamp}aA9`;
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

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org1 = await makeOrgWithAdmin("verify-j", stamp);
  ids.orgs.push(org1.orgId);
  ids.users.push(org1.userId);

  const org2 = await makeOrgWithAdmin("verify-j2", stamp);
  ids.orgs.push(org2.orgId);
  ids.users.push(org2.userId);

  // A plain member of org1, to exercise the revert role gate.
  const memberEmail = `zz-verify-j-member-${stamp}@example.invalid`;
  const memberPassword = `Zj!${stamp}bB9`;
  const { data: memberUserData } = await admin.auth.admin.createUser({
    email: memberEmail,
    password: memberPassword,
    email_confirm: true,
  });
  ids.users.push(memberUserData.user.id);
  await admin.from("org_memberships").insert({ org_id: org1.orgId, user_id: memberUserData.user.id, role: "member" });
  const { data: memberSignIn, error: memberSignInErr } = await anon.auth.signInWithPassword({
    email: memberEmail,
    password: memberPassword,
  });
  if (memberSignInErr) throw new Error(`member signIn: ${memberSignInErr.message}`);
  const memberCookie = sessionCookies(memberSignIn.session);

  const baseFacility = {
    name: `ZZ Verify-J Pool ${stamp}`,
    address_line1: "1 Test St",
    city: "Vancouver",
    province: "BC",
    postal_code: "V0V 0V0",
    is_published: true,
  };

  console.log("\n1. Creating a facility logs an insert row (actor, label)");
  const created = await api("/api/facilities", org1.cookie, { method: "POST", body: JSON.stringify(baseFacility) });
  check("facility create succeeds", created.status === 200, JSON.stringify(created.body));
  const facilityId = created.body.facilityId;

  const { data: insertLog } = await admin
    .from("activity_log")
    .select("*")
    .eq("table_name", "facilities")
    .eq("row_id", facilityId)
    .eq("action", "insert")
    .maybeSingle();
  check("insert row logged", !!insertLog, JSON.stringify(insertLog));
  check(
    "insert row has the creating admin's email and the facility's name as label",
    insertLog?.actor_email === `zz-verify-j-admin-${stamp}@example.invalid` && insertLog?.entity_label === baseFacility.name,
    JSON.stringify(insertLog)
  );

  console.log("\n2. Editing the facility logs an update row with changed_fields");
  const newName = `ZZ Verify-J Pool RENAMED ${stamp}`;
  const edited = await api("/api/facilities", org1.cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseFacility, name: newName, facilityId }),
  });
  check("facility edit succeeds", edited.status === 200, JSON.stringify(edited.body));

  const { data: updateLog } = await admin
    .from("activity_log")
    .select("*")
    .eq("table_name", "facilities")
    .eq("row_id", facilityId)
    .eq("action", "update")
    .maybeSingle();
  check("update row logged", !!updateLog, JSON.stringify(updateLog));
  check(
    "changed_fields includes name, not updated_at",
    Array.isArray(updateLog?.changed_fields) &&
      updateLog.changed_fields.includes("name") &&
      !updateLog.changed_fields.includes("updated_at"),
    JSON.stringify(updateLog?.changed_fields)
  );

  console.log("\n3. A pure updated_at bump (session-write touch trigger, migration 035) is NOT logged");
  const scheduleGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org1.orgId,
        facility_id: facilityId,
        name: `ZZ Verify-J Schedule ${stamp}`,
        slug: `zz-verify-j-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  const { count: sgLogCountBefore } = await admin
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "schedule_groups")
    .eq("row_id", scheduleGroup.id);

  await admin.from("sessions").insert({
    org_id: org1.orgId,
    schedule_group_id: scheduleGroup.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: "2026-08-10T09:00:00Z",
    dtend_time: "10:00",
    valid_from: "2026-08-10",
    valid_until: null,
    source: "manual",
    is_active: true,
  });

  const { count: sgLogCountAfter } = await admin
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "schedule_groups")
    .eq("row_id", scheduleGroup.id);
  check(
    "schedule_groups activity_log count unchanged after a session insert only bumps its updated_at",
    sgLogCountBefore === sgLogCountAfter,
    `before=${sgLogCountBefore} after=${sgLogCountAfter}`
  );

  const { count: sessionLogCount } = await admin
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "sessions")
    .eq("action", "insert");
  check("positive control — the session insert itself was logged", (sessionLogCount ?? 0) >= 1);

  console.log("\n4. Revert role gate — a plain member cannot revert (403), admin can (200)");
  const memberRevert = await api(`/api/activity/${updateLog.id}/revert`, memberCookie, { method: "POST" });
  check("member revert rejected with 403", memberRevert.status === 403, JSON.stringify(memberRevert.body));

  const adminRevert = await api(`/api/activity/${updateLog.id}/revert`, org1.cookie, { method: "POST" });
  check("admin revert succeeds (200)", adminRevert.status === 200, JSON.stringify(adminRevert.body));

  const { data: revertedFacility } = await admin.from("facilities").select("name").eq("id", facilityId).single();
  check("reverting the update actually restored the original name", revertedFacility?.name === baseFacility.name, revertedFacility?.name);

  console.log("\n5. Reverting an already-reverted entry fails");
  const doubleRevert = await api(`/api/activity/${updateLog.id}/revert`, org1.cookie, { method: "POST" });
  check("second revert of the same entry is rejected", doubleRevert.status === 400, JSON.stringify(doubleRevert.body));

  console.log("\n6. Undo-create removes the row");
  const second = await api("/api/facilities", org1.cookie, {
    method: "POST",
    body: JSON.stringify({ ...baseFacility, name: `ZZ Verify-J Undo-Create ${stamp}` }),
  });
  const secondFacilityId = second.body.facilityId;
  const { data: secondInsertLog } = await admin
    .from("activity_log")
    .select("id")
    .eq("table_name", "facilities")
    .eq("row_id", secondFacilityId)
    .eq("action", "insert")
    .single();

  const undoCreate = await api(`/api/activity/${secondInsertLog.id}/revert`, org1.cookie, { method: "POST" });
  check("undo-create succeeds (200)", undoCreate.status === 200, JSON.stringify(undoCreate.body));

  const { data: goneFacility } = await admin.from("facilities").select("id").eq("id", secondFacilityId).maybeSingle();
  check("the created facility no longer exists after undo-create", !goneFacility);

  console.log("\n7. Undo-delete restores the row as it was");
  const deleted = await api(`/api/facilities/${facilityId}`, org1.cookie, { method: "DELETE" });
  check("facility delete succeeds", deleted.status === 200, JSON.stringify(deleted.body));

  const { data: deleteLog } = await admin
    .from("activity_log")
    .select("id")
    .eq("table_name", "facilities")
    .eq("row_id", facilityId)
    .eq("action", "delete")
    .single();

  const undoDelete = await api(`/api/activity/${deleteLog.id}/revert`, org1.cookie, { method: "POST" });
  check("undo-delete succeeds (200)", undoDelete.status === 200, JSON.stringify(undoDelete.body));

  const { data: restoredFacility } = await admin.from("facilities").select("id, name").eq("id", facilityId).maybeSingle();
  check(
    "the deleted facility is back with its original id and name",
    restoredFacility?.id === facilityId && restoredFacility?.name === baseFacility.name,
    JSON.stringify(restoredFacility)
  );

  console.log("\n8. RLS — org2's admin cannot read org1's activity log via a direct table query");
  // A fresh client with org2's admin session in place, querying the table
  // directly (not through /api/activity, which already scopes by the
  // caller's own org) — this is what actually proves the RLS policy itself,
  // not just that the route remembers to filter.
  const org2Fresh = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: org2SignIn } = await org2Fresh.auth.signInWithPassword({
    email: `zz-verify-j2-admin-${stamp}@example.invalid`,
    password: `Zj!${stamp}aA9`,
  });
  check("org2 admin signed in for the RLS check", !!org2SignIn?.session);
  const { data: crossOrgRead, error: crossOrgErr } = await org2Fresh
    .from("activity_log")
    .select("id")
    .eq("org_id", org1.orgId);
  check(
    "org2 admin reads zero rows of org1's activity log",
    !crossOrgErr && (crossOrgRead?.length ?? 0) === 0,
    JSON.stringify({ crossOrgErr, count: crossOrgRead?.length })
  );

  console.log("\n9. Positive control — org1's own admin CAN read those same rows via the API route");
  const org1List = await api("/api/activity", org1.cookie);
  check(
    "org1 admin's own activity list is non-empty",
    org1List.status === 200 && (org1List.body.entries?.length ?? 0) > 0,
    JSON.stringify({ status: org1List.status, count: org1List.body.entries?.length })
  );

  console.log("\n10. Deleting the whole org (with a live facility under it, and activity_log rows referencing it) doesn't FK-violate on itself");
  // The trigger fires again for every row the cascade removes — this is what
  // exposed the org_id FK bug against activity_log's own org_id column
  // (fixed by the NOT EXISTS guard in log_activity()).
  const { error: orgDeleteError } = await admin.from("organizations").delete().eq("id", org1.orgId);
  check("org1 delete succeeds despite its own cascading activity_log writes", !orgDeleteError, JSON.stringify(orgDeleteError));
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
