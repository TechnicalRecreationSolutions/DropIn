/**
 * Schedule-group publish gate: P1 relaxation from "needs both a start and
 * end date to publish" to "needs a start date" (see
 * dropin/docs/RESUME-schedule-input-fixes.md, P1 item 3). An indefinite
 * weekly drop-in with no planned end is the common case for this kind of
 * schedule, not a half-filled-out exception.
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

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-g ${stamp}`, slug: `zz-verify-g-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-g-${stamp}@example.invalid`;
  const password = `Zg!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: "ZZ Verify-G Pool",
        slug: `zz-verify-g-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const space = (
    await admin
      .from("spaces")
      .insert({ org_id: org.id, facility_id: facility.id, name: "Test Space", slug: `test-space-${stamp}` })
      .select("id")
      .single()
  ).data;

  console.log("\n1. A schedule group with a start date but no end date can publish");
  const openEnded = await api("/api/schedule-groups", cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: "ZZ Open-Ended Drop-In",
      sport_category: "swimming",
      status: "published",
      starts_on: "2026-08-10",
      // ends_on omitted entirely — the whole point being tested
    }),
  });
  check("creates published with no end date (not 400)", openEnded.status === 201, JSON.stringify(openEnded.body));

  console.log("\n2. Negative control — a schedule group with no start date still cannot publish");
  const noStart = await api("/api/schedule-groups", cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: "ZZ No Start Date",
      sport_category: "swimming",
      status: "published",
    }),
  });
  check("still rejected with 400 (start date remains required)", noStart.status === 400, JSON.stringify(noStart.body));

  console.log("\n3. PATCH: an existing draft schedule can publish open-ended too");
  const draftGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Draft To Publish",
        slug: `zz-draft-to-publish-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  const patched = await api(`/api/schedule-groups/${draftGroup.id}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "published", starts_on: "2026-08-10" }),
  });
  check("PATCH publish with only starts_on succeeds", patched.status === 200, JSON.stringify(patched.body));

  console.log("\n4. Positive control — publishing an open-ended schedule still catches a genuine space overlap");
  // openEnded above is published, open-ended, but has no sessions yet — give
  // it one claiming `space`, then try to publish a second open-ended
  // schedule at the same facility/space starting inside its range.
  const sessionRes = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: openEnded.body.scheduleGroup.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: "2026-08-10T09:00:00Z",
      dtend_time: "10:00",
      valid_from: "2026-08-10",
      valid_until: null,
      space_ids: [space.id],
    }),
  });
  check("fixture session for the overlap check creates", sessionRes.status < 300, JSON.stringify(sessionRes.body));

  const overlappingGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Overlapping Open-Ended",
        slug: `zz-overlapping-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;
  await admin.from("sessions").insert({
    org_id: org.id,
    schedule_group_id: overlappingGroup.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: "2026-08-24T10:00:00Z", // starts after openEnded's start, well inside its open-ended range
    dtend_time: "11:00",
    valid_from: "2026-08-24",
    valid_until: null,
    source: "manual",
    is_active: true,
  }).select("id").single()
    .then(async ({ data: s }) => {
      await admin.from("session_spaces").insert({ session_id: s.id, space_id: space.id, org_id: org.id });
    });

  const blockedPublish = await api(`/api/schedule-groups/${overlappingGroup.id}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "published", starts_on: "2026-08-24" }), // open-ended, no ends_on
  });
  check(
    "publishing an open-ended schedule that genuinely overlaps another open-ended one is still blocked (409)",
    blockedPublish.status === 409,
    JSON.stringify(blockedPublish.body)
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
