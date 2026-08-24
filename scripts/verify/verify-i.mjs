/**
 * Per-week schedule review (migration 037): a week with no review row is
 * 'pending' and hidden from the public schedule/widget once its schedule is
 * published; staff (org members) must keep seeing every week regardless of
 * review status; only 'approved' shows publicly, not any status change.
 * Also checks the write route's role gate (owner|admin only, same tier as
 * publishing).
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, a
 * genuinely signed-in user (or anon, where the point is public visibility)
 * driving the real HTTP routes, positive controls alongside every negative
 * one, teardown in a finally.
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

const stamp = Date.now();
const ids = { users: [], orgs: [] };

// Monday 2026-08-10 -> Sunday-start week is 2026-08-09..2026-08-15.
const WEEK_START = "2026-08-09";
const rangeStart = "2026-08-09T00:00:00Z";
const rangeEnd = "2026-08-15T23:59:59Z";

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-i ${stamp}`, slug: `zz-verify-i-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const adminEmail = `zz-verify-i-admin-${stamp}@example.invalid`;
  const adminPassword = `Zi!${stamp}aA9`;
  const { data: adminUserData } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  ids.users.push(adminUserData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: adminUserData.user.id, role: "admin" });

  const memberEmail = `zz-verify-i-member-${stamp}@example.invalid`;
  const memberPassword = `Zi!${stamp}bB9`;
  const { data: memberUserData } = await admin.auth.admin.createUser({
    email: memberEmail,
    password: memberPassword,
    email_confirm: true,
  });
  ids.users.push(memberUserData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: memberUserData.user.id, role: "member" });

  const { data: adminSignIn, error: adminSignInErr } = await anon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (adminSignInErr) throw new Error(`admin signIn: ${adminSignInErr.message}`);
  const adminCookie = sessionCookies(adminSignIn.session);

  const { data: memberSignIn, error: memberSignInErr } = await anon.auth.signInWithPassword({
    email: memberEmail,
    password: memberPassword,
  });
  if (memberSignInErr) throw new Error(`member signIn: ${memberSignInErr.message}`);
  const memberCookie = sessionCookies(memberSignIn.session);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: "ZZ Verify-I Pool",
        slug: `zz-verify-i-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const scheduleGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Verify-I Drop-In",
        slug: `zz-verify-i-dropin-${stamp}`,
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

  await admin.from("sessions").insert({
    org_id: org.id,
    schedule_group_id: scheduleGroup.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: "2026-08-10T09:00:00Z",
    dtend_time: "10:00",
    valid_from: "2026-08-10",
    valid_until: null,
    source: "manual",
    is_active: true,
  });

  const expandUrl = `/api/sessions/expand?scheduleGroupId=${scheduleGroup.id}&rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}`;

  console.log("\n1. Staff (org admin) sees the week's session before any review exists");
  const staffBefore = await api(expandUrl, adminCookie);
  check(
    "admin sees the occurrence regardless of (missing) review status",
    staffBefore.body.data?.length === 1,
    JSON.stringify(staffBefore.body)
  );

  console.log("\n2. Public (anonymous) does NOT see a pending (unreviewed) week");
  const publicPending = await api(expandUrl, null);
  check(
    "anon sees zero occurrences for an unreviewed week of a published schedule",
    publicPending.body.data?.length === 0,
    JSON.stringify(publicPending.body)
  );

  console.log("\n3. Role gate — a plain member cannot approve a week (403)");
  const memberApprove = await api(`/api/schedule-groups/${scheduleGroup.id}/week-reviews`, memberCookie, {
    method: "PUT",
    body: JSON.stringify({ weekStart: WEEK_START, status: "approved" }),
  });
  check("member PUT is rejected with 403", memberApprove.status === 403, JSON.stringify(memberApprove.body));

  console.log("\n4. Admin approves the week");
  const adminApprove = await api(`/api/schedule-groups/${scheduleGroup.id}/week-reviews`, adminCookie, {
    method: "PUT",
    body: JSON.stringify({ weekStart: WEEK_START, status: "approved" }),
  });
  check("admin PUT approved succeeds (200)", adminApprove.status === 200, JSON.stringify(adminApprove.body));

  console.log("\n5. Public now sees the approved week's session");
  const publicApproved = await api(expandUrl, null);
  check(
    "anon now sees the occurrence once its week is approved",
    publicApproved.body.data?.length === 1,
    JSON.stringify(publicApproved.body)
  );

  console.log("\n6. Admin flags the week as needing changes — public visibility reverts to hidden");
  const adminNeedsChanges = await api(`/api/schedule-groups/${scheduleGroup.id}/week-reviews`, adminCookie, {
    method: "PUT",
    body: JSON.stringify({ weekStart: WEEK_START, status: "needs_changes", note: "ZZ wrong instructor listed" }),
  });
  check("admin PUT needs_changes succeeds (200)", adminNeedsChanges.status === 200, JSON.stringify(adminNeedsChanges.body));

  const publicNeedsChanges = await api(expandUrl, null);
  check(
    "anon sees zero occurrences again once the week is flagged needs_changes (only 'approved' is public)",
    publicNeedsChanges.body.data?.length === 0,
    JSON.stringify(publicNeedsChanges.body)
  );

  console.log("\n7. Positive control — staff still sees the session throughout, unaffected by public gating");
  const staffAfter = await api(expandUrl, adminCookie);
  check(
    "admin still sees the occurrence while the week is needs_changes",
    staffAfter.body.data?.length === 1,
    JSON.stringify(staffAfter.body)
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
