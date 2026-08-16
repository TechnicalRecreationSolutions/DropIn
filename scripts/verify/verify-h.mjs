/**
 * The schedule list build: migration 035 (schedule_groups.published_at +
 * session-write triggers that bump updated_at), the PATCH route now setting
 * updated_at/published_at explicitly, and the new duplicate/delete routes.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, a
 * genuinely signed-in user driving the real HTTP routes, positive controls
 * alongside every negative one, teardown in a finally.
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

async function signIn(email, password) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return sessionCookies(data.session);
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-h ${stamp}`, slug: `zz-verify-h-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const otherOrg = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-h-other ${stamp}`, slug: `zz-verify-h-other-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(otherOrg.id);

  const adminEmail = `zz-verify-h-admin-${stamp}@example.invalid`;
  const adminPassword = `Zh!${stamp}aA9`;
  const { data: adminUser } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  ids.users.push(adminUser.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: adminUser.user.id, role: "admin" });

  const memberEmail = `zz-verify-h-member-${stamp}@example.invalid`;
  const memberPassword = `Zh!${stamp}bB9`;
  const { data: memberUser } = await admin.auth.admin.createUser({
    email: memberEmail,
    password: memberPassword,
    email_confirm: true,
  });
  ids.users.push(memberUser.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: memberUser.user.id, role: "member" });

  const adminCookie = await signIn(adminEmail, adminPassword);
  const memberCookie = await signIn(memberEmail, memberPassword);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: "ZZ Verify-H Pool",
        slug: `zz-verify-h-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  // ---------------------------------------------------------------------
  console.log("\n1. published_at is set on POST when created already-published");
  const createdPublished = await api("/api/schedule-groups", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: "ZZ Create Published",
      sport_category: "swimming",
      status: "published",
      starts_on: "2026-01-01",
    }),
  });
  check("creates (201)", createdPublished.status === 201, JSON.stringify(createdPublished.body));
  check(
    "published_at is set",
    !!createdPublished.body.scheduleGroup?.published_at,
    JSON.stringify(createdPublished.body.scheduleGroup)
  );

  console.log("\n2. Negative control — published_at stays NULL for a draft creation");
  const createdDraft = await api("/api/schedule-groups", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: "ZZ Create Draft",
      sport_category: "swimming",
      status: "draft",
    }),
  });
  check("creates (201)", createdDraft.status === 201, JSON.stringify(createdDraft.body));
  check(
    "published_at is NULL",
    createdDraft.body.scheduleGroup?.published_at === null,
    JSON.stringify(createdDraft.body.scheduleGroup)
  );

  console.log("\n3. PATCH draft->published sets published_at; a later ordinary edit does not move it");
  const patchToPublished = await api(`/api/schedule-groups/${createdDraft.body.scheduleGroup.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "published", starts_on: "2026-01-01" }),
  });
  check("PATCH publish succeeds", patchToPublished.status === 200, JSON.stringify(patchToPublished.body));
  const firstPublishedAt = patchToPublished.body.scheduleGroup?.published_at;
  check("published_at set on the transition", !!firstPublishedAt);

  await new Promise((r) => setTimeout(r, 1100)); // ensure a distinguishable timestamp
  const ordinaryEdit = await api(`/api/schedule-groups/${createdDraft.body.scheduleGroup.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ cost_notes: "ZZ updated cost note" }),
  });
  check("ordinary edit succeeds", ordinaryEdit.status === 200, JSON.stringify(ordinaryEdit.body));
  check(
    "published_at unchanged by an ordinary edit (still published, not re-publishing)",
    ordinaryEdit.body.scheduleGroup?.published_at === firstPublishedAt
  );
  check(
    "updated_at moved forward — this is the MODIFIED signal (updated_at > published_at)",
    ordinaryEdit.body.scheduleGroup?.updated_at > firstPublishedAt,
    `updated_at=${ordinaryEdit.body.scheduleGroup?.updated_at} published_at=${firstPublishedAt}`
  );

  // ---------------------------------------------------------------------
  console.log("\n4. Session-write trigger bumps schedule_groups.updated_at (migration 035)");
  const beforeSession = (
    await admin.from("schedule_groups").select("updated_at").eq("id", createdPublished.body.scheduleGroup.id).single()
  ).data;

  await new Promise((r) => setTimeout(r, 1100));
  const sessionRes = await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: createdPublished.body.scheduleGroup.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: "2026-01-05T09:00:00Z",
      dtend_time: "10:00",
      valid_from: "2026-01-05",
      valid_until: null,
      space_ids: [],
    }),
  });
  check("fixture session creates", sessionRes.status < 300, JSON.stringify(sessionRes.body));

  const afterSession = (
    await admin.from("schedule_groups").select("updated_at").eq("id", createdPublished.body.scheduleGroup.id).single()
  ).data;
  check(
    "updated_at moved forward purely from a session write, no schedule_groups PATCH involved",
    afterSession.updated_at > beforeSession.updated_at,
    `before=${beforeSession.updated_at} after=${afterSession.updated_at}`
  );

  console.log("\n5. Positive control — a session under a DIFFERENT schedule group does not touch this one's updated_at");
  const untouchedGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Untouched",
        slug: `zz-untouched-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        starts_on: "2026-01-01",
        published_at: new Date().toISOString(),
        source: "manual",
      })
      .select("id, updated_at")
      .single()
  ).data;

  await new Promise((r) => setTimeout(r, 1100));
  await api("/api/sessions", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: createdPublished.body.scheduleGroup.id,
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      dtstart: "2026-01-06T09:00:00Z",
      dtend_time: "10:00",
      valid_from: "2026-01-06",
      valid_until: null,
      space_ids: [],
    }),
  });
  const untouchedAfter = (
    await admin.from("schedule_groups").select("updated_at").eq("id", untouchedGroup.id).single()
  ).data;
  check(
    "a sibling schedule group's updated_at is unaffected",
    untouchedAfter.updated_at === untouchedGroup.updated_at,
    `before=${untouchedGroup.updated_at} after=${untouchedAfter.updated_at}`
  );

  // ---------------------------------------------------------------------
  console.log("\n6. Duplicate copies schedule fields + templates, not sessions, and starts as draft");
  await admin.from("session_templates").insert({
    org_id: org.id,
    schedule_group_id: createdPublished.body.scheduleGroup.id,
    name: "ZZ Lap Swim",
    color: "#3B82F6",
    default_duration_minutes: 60,
  });

  const duplicateRes = await api(`/api/schedule-groups/${createdPublished.body.scheduleGroup.id}/duplicate`, adminCookie, {
    method: "POST",
    body: JSON.stringify({ name: "ZZ Duplicated Schedule" }),
  });
  check("duplicate succeeds (201)", duplicateRes.status === 201, JSON.stringify(duplicateRes.body));
  check("duplicate starts as draft", duplicateRes.body.scheduleGroup?.status === "draft");
  check("duplicate has no published_at", duplicateRes.body.scheduleGroup?.published_at === null);
  check(
    "duplicate carries the source's sport_category",
    duplicateRes.body.scheduleGroup?.sport_category === "swimming"
  );

  const { data: dupTemplates } = await admin
    .from("session_templates")
    .select("name, color, default_duration_minutes")
    .eq("schedule_group_id", duplicateRes.body.scheduleGroup.id);
  check("template was copied", dupTemplates?.length === 1, JSON.stringify(dupTemplates));
  check("copied template kept its name/color/duration", dupTemplates?.[0]?.name === "ZZ Lap Swim");

  const { data: dupSessions } = await admin
    .from("sessions")
    .select("id")
    .eq("schedule_group_id", duplicateRes.body.scheduleGroup.id);
  check("sessions were NOT copied", (dupSessions?.length ?? 0) === 0, JSON.stringify(dupSessions));

  console.log("\n7. Negative control — a member (not admin/owner) cannot duplicate or delete");
  const memberDuplicate = await api(`/api/schedule-groups/${createdPublished.body.scheduleGroup.id}/duplicate`, memberCookie, {
    method: "POST",
    body: JSON.stringify({ name: "ZZ Should Not Exist" }),
  });
  check("member duplicate forbidden (403)", memberDuplicate.status === 403, JSON.stringify(memberDuplicate.body));

  const memberDelete = await api(`/api/schedule-groups/${createdPublished.body.scheduleGroup.id}`, memberCookie, {
    method: "DELETE",
  });
  check("member delete forbidden (403)", memberDelete.status === 403, JSON.stringify(memberDelete.body));

  // ---------------------------------------------------------------------
  console.log("\n8. Delete cascades to sessions; cross-org delete 404s instead of succeeding");
  const toDelete = duplicateRes.body.scheduleGroup.id;
  await admin.from("sessions").insert({
    org_id: org.id,
    schedule_group_id: toDelete,
    rrule: "FREQ=WEEKLY;BYDAY=WE",
    dtstart: "2026-01-07T09:00:00Z",
    dtend_time: "10:00",
    valid_from: "2026-01-07",
    valid_until: null,
    source: "manual",
    is_active: true,
  });

  const crossOrgUser = await admin.auth.admin
    .createUser({ email: `zz-verify-h-cross-${stamp}@example.invalid`, password: adminPassword, email_confirm: true })
    .then((r) => r.data.user);
  ids.users.push(crossOrgUser.id);
  await admin.from("org_memberships").insert({ org_id: otherOrg.id, user_id: crossOrgUser.id, role: "admin" });
  const crossOrgCookie = await signIn(`zz-verify-h-cross-${stamp}@example.invalid`, adminPassword);

  const crossOrgDelete = await api(`/api/schedule-groups/${toDelete}`, crossOrgCookie, { method: "DELETE" });
  check("cross-org delete 404s, not 200", crossOrgDelete.status === 404, JSON.stringify(crossOrgDelete.body));

  const realDelete = await api(`/api/schedule-groups/${toDelete}`, adminCookie, { method: "DELETE" });
  check("owner's own delete succeeds", realDelete.status === 200, JSON.stringify(realDelete.body));

  const { data: sessionsAfterDelete } = await admin.from("sessions").select("id").eq("schedule_group_id", toDelete);
  check("sessions cascade-deleted with the schedule group", (sessionsAfterDelete?.length ?? 0) === 0);
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
