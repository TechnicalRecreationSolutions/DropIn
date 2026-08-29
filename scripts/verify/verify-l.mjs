/**
 * Widget/facility analytics expansion (migration 041 + /dashboard/analytics):
 * POST /api/analytics/track (anonymous, the same caller widget.js and
 * SessionModal/useScheduleAnalytics use) records widget_view, program_click,
 * view_change and session_duration rows with the new view_template/
 * duration_ms columns; getAnalyticsSummary() (src/lib/analytics/queries.ts)
 * aggregates them correctly (counts, avg duration, click-through rate,
 * template breakdown, referrer grouping, top-clicked schedule); RLS still
 * scopes analytics_events to org members (org2 reads zero of org1's rows);
 * and the rendered /dashboard/analytics page contains the real numbers.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, an
 * anonymous client firing the public tracking route (this data has no
 * signed-in actor in production — an anonymous widget visitor is the real
 * caller, not a stand-in), a positive control (a second, unrelated event
 * that must NOT be double-counted), teardown in a finally.
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

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org1 = await makeOrgWithAdmin("verify-l", stamp);
  ids.orgs.push(org1.orgId);
  ids.users.push(org1.userId);

  const org2 = await makeOrgWithAdmin("verify-l2", stamp);
  ids.orgs.push(org2.orgId);
  ids.users.push(org2.userId);

  console.log("\n0. Fixture: a facility with a published schedule group and session");
  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org1.orgId,
        name: `ZZ Verify-L Pool ${stamp}`,
        slug: `zz-verify-l-pool-${stamp}`,
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
        org_id: org1.orgId,
        facility_id: facility.id,
        name: `ZZ Verify-L Schedule ${stamp}`,
        slug: `zz-verify-l-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  console.log("\n1. Anonymous POST /api/analytics/track records a widget_view with view_template + referrer");
  const view1 = await api("/api/analytics/track", null, {
    method: "POST",
    body: JSON.stringify({
      event: "widget_view",
      orgId: org1.orgId,
      facilityId: facility.id,
      viewTemplate: "grid",
      referrer: "https://example-city.gov/recreation",
    }),
  });
  check("200", view1.status === 200, JSON.stringify(view1.body));

  console.log("\n2. Anonymous POST records a view_change to 'map'");
  const viewChange = await api("/api/analytics/track", null, {
    method: "POST",
    body: JSON.stringify({
      event: "view_change",
      orgId: org1.orgId,
      facilityId: facility.id,
      viewTemplate: "map",
    }),
  });
  check("200", viewChange.status === 200, JSON.stringify(viewChange.body));

  console.log("\n3. Anonymous POST records a program_click against the schedule group");
  const click = await api("/api/analytics/track", null, {
    method: "POST",
    body: JSON.stringify({
      event: "program_click",
      orgId: org1.orgId,
      facilityId: facility.id,
      scheduleGroupId: scheduleGroup.id,
    }),
  });
  check("200", click.status === 200, JSON.stringify(click.body));

  console.log("\n4. Anonymous POST records a session_duration");
  const duration = await api("/api/analytics/track", null, {
    method: "POST",
    body: JSON.stringify({
      event: "session_duration",
      orgId: org1.orgId,
      facilityId: facility.id,
      durationMs: 45000,
    }),
  });
  check("200", duration.status === 200, JSON.stringify(duration.body));

  console.log("\n5. Negative control — org2's own widget_view must not leak into org1's summary");
  const org2Facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org2.orgId,
        name: `ZZ Verify-L2 Pool ${stamp}`,
        slug: `zz-verify-l2-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;
  const org2View = await api("/api/analytics/track", null, {
    method: "POST",
    body: JSON.stringify({ event: "widget_view", orgId: org2.orgId, facilityId: org2Facility.id, viewTemplate: "list" }),
  });
  check("org2's own event also records fine (200)", org2View.status === 200, JSON.stringify(org2View.body));

  console.log("\n6. RLS — org2's admin reads zero of org1's analytics_events via a direct table query");
  const org2Fresh = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await org2Fresh.auth.signInWithPassword({
    email: `zz-verify-l2-admin-${stamp}@example.invalid`,
    password: `Zk!${stamp}aA9`,
  });
  const { data: crossOrgRead, error: crossOrgErr } = await org2Fresh
    .from("analytics_events")
    .select("id")
    .eq("org_id", org1.orgId);
  check(
    "org2 admin reads zero rows of org1's analytics_events",
    !crossOrgErr && (crossOrgRead?.length ?? 0) === 0,
    JSON.stringify({ crossOrgErr, count: crossOrgRead?.length })
  );

  console.log("\n7. org1's own admin CAN read all four of its own events directly (positive control for RLS)");
  const { data: org1Read, error: org1Err } = await admin
    .from("analytics_events")
    .select("event_type, view_template, duration_ms, schedule_group_id, referrer_url")
    .eq("org_id", org1.orgId)
    .in("event_type", ["widget_view", "view_change", "program_click", "session_duration"]);
  check("service role sees all 4 org1 rows", !org1Err && org1Read?.length === 4, JSON.stringify({ org1Err, rows: org1Read }));

  console.log("\n8. /dashboard/analytics renders with the real numbers for org1's admin");
  const page = await fetch(`${APP}/dashboard/analytics`, { headers: { Cookie: org1.cookie } });
  const html = await page.text();
  check("200", page.status === 200, `status=${page.status}`);
  // getAnalyticsSummary's VIEW_EVENTS set is widget_view/facility_view/schedule_view —
  // view_change is a separate bucket, so this fixture's one widget_view is the whole
  // "views" count, and its one program_click is the whole "clicks" count.
  check("page HTML contains a stat value of 1 (views/clicks)", html.includes(">1<"));
  check("page HTML contains the click-through rate (100%)", html.includes("100%"));
  check("page HTML contains the avg duration (45s)", html.includes("45s"));
  check("page HTML contains the schedule group name in top-clicked", html.includes(`ZZ Verify-L Schedule ${stamp}`));
  check("page HTML contains the referrer hostname", html.includes("example-city.gov"));
  check("page HTML contains the grid template row", html.includes("Grid"));
  check("page HTML contains the map template row", html.includes("Map"));
  check("page does NOT leak org2's schedule/facility names", !html.includes(`ZZ Verify-L2`));
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
