/**
 * Widget multi-schedule filter (widget_config_scopes, migration 043): a
 * widget_configs row can now carry an ordered list of named facility/
 * department/schedule filter entries so one embed lets the visitor switch
 * between schedules instead of the org pasting a separate snippet per scope.
 *
 * Checks PATCH /api/widget-config's scope handling (org-membership
 * validation per entry, schedule→department auto-derivation, undefined vs []
 * semantics for "leave alone" vs "clear"), GET /api/widget-config returning
 * the saved list, the RLS split on widget_config_scopes itself (staff see
 * their own org's scopes regardless of publish state; the public read only
 * ever sees a fully-published chain — the same M1 shape migration 026 fixed
 * for widget_configs), and the live /widget/[orgId] embed actually rendering
 * the schedule switcher — a dropdown built into the colored header bar
 * (ScheduleHeaderBar's scopeOptions) — only once there are 2+ scopes, with
 * the header title always showing the active scope's own name. The dropdown
 * itself opens client-side (Radix Select, portal-rendered on click), which a
 * plain HTTP fetch can't exercise — these checks confirm the dropdown
 * affordance and the correct default selection, not actually picking a
 * different option. **`verify-p.mjs` covers that half**, driving a real
 * signed-out browser: it opens the dropdown, picks the other scope, and
 * asserts the rendered sessions change rather than just the header label.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, a real
 * signed-in cookie session against the live HTTP routes for the thing under
 * test, positive controls, teardown in a finally.
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

// The server component passes the whole `scopes` array to the client
// component as a prop, which Next embeds verbatim (as JSON) in the page's
// hydration payload regardless of what the client then chooses to render —
// so a plain HTML substring match on a label is true whether or not it's
// actually showing as visible text. `>label<` only appears when the label is
// real rendered text content (e.g. the header's current title) — that's the
// signal that means "visibly rendered", not just "known to the client".
function rendersAsText(html, label) {
  return html.includes(`>${label}<`);
}

// The header's schedule switcher is a Radix Select (ScheduleHeaderBar,
// scopeOptions prop) — a real dropdown, not a static row of buttons. Its
// closed-state SSR only renders the trigger (showing the *current* scope's
// label) plus this data-slot marker; the other options live inside
// SelectContent, which Radix doesn't mount into the DOM until the trigger is
// actually opened. A plain HTTP fetch can't click it open, so these checks
// can only prove the dropdown affordance exists and shows the right active
// label — not exercise picking a different option. That needs a real browser.
function hasScopeDropdown(html) {
  return html.includes('data-slot="select-trigger"');
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

async function makeOrgWithUser(label, stamp, role) {
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ ${label} ${role} ${stamp}`, slug: `zz-${label}-${role}-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`${label} ${role} org insert: ${orgErr.message}`);

  const email = `zz-${label}-${role}-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`${label} ${role} createUser: ${userErr.message}`);

  const { error: memberErr } = await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role });
  if (memberErr) throw new Error(`${label} ${role} org_memberships insert: ${memberErr.message}`);

  const { data: signIn, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label} ${role} signIn: ${error.message}`);

  return { orgId: org.id, userId: userData.user.id, email, password, cookie: sessionCookies(signIn.session) };
}

async function makeFacility(orgId, label, stamp, published) {
  const { data, error } = await admin
    .from("facilities")
    .insert({
      org_id: orgId,
      name: `ZZ Verify-N ${label} ${stamp}`,
      slug: `zz-verify-n-${label.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      address_line1: "1 Test St",
      city: "Vancouver",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: published,
    })
    .select("id, name")
    .single();
  if (error) throw new Error(`facility ${label}: ${error.message}`);
  return data;
}

async function makeDepartment(orgId, facilityId, label, stamp, published) {
  const { data, error } = await admin
    .from("departments")
    .insert({
      org_id: orgId,
      facility_id: facilityId,
      name: `ZZ Verify-N ${label} ${stamp}`,
      slug: `zz-verify-n-${label.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      is_published: published,
    })
    .select("id, name")
    .single();
  if (error) throw new Error(`department ${label}: ${error.message}`);
  return data;
}

async function makeScheduleGroup(orgId, facilityId, departmentId, label, stamp, status) {
  const { data, error } = await admin
    .from("schedule_groups")
    .insert({
      org_id: orgId,
      facility_id: facilityId,
      department_id: departmentId,
      name: `ZZ Verify-N ${label} ${stamp}`,
      slug: `zz-verify-n-${label.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status,
      source: "manual",
    })
    .select("id, name, department_id")
    .single();
  if (error) throw new Error(`schedule_group ${label}: ${error.message}`);
  return data;
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org1Admin = await makeOrgWithUser("verify-n", stamp, "admin");
  ids.orgs.push(org1Admin.orgId);
  ids.users.push(org1Admin.userId);

  const org1Member = await makeOrgWithUser("verify-n", stamp, "member");
  await admin.from("org_memberships").update({ org_id: org1Admin.orgId }).eq("user_id", org1Member.userId);
  await admin.from("organizations").delete().eq("id", org1Member.orgId);
  ids.users.push(org1Member.userId);

  const org2Admin = await makeOrgWithUser("verify-n2", stamp, "admin");
  ids.orgs.push(org2Admin.orgId);
  ids.users.push(org2Admin.userId);

  console.log("\n0. Fixture: two published facility/department/schedule chains in org1, one unpublished, one in org2");
  const pool = await makeFacility(org1Admin.orgId, "Pool", stamp, true);
  const poolDept = await makeDepartment(org1Admin.orgId, pool.id, "Aquatics", stamp, true);
  const poolSchedule = await makeScheduleGroup(org1Admin.orgId, pool.id, poolDept.id, "Lane Swim", stamp, "published");

  const gym = await makeFacility(org1Admin.orgId, "Gym", stamp, true);

  const otherFacility = await makeFacility(org1Admin.orgId, "OtherFacility", stamp, true);
  const otherDept = await makeDepartment(org1Admin.orgId, otherFacility.id, "OtherDept", stamp, true);

  const draft = await makeFacility(org1Admin.orgId, "Draft", stamp, false);

  const org2Facility = await makeFacility(org2Admin.orgId, "Cross", stamp, true);

  console.log("\n1. A plain member is rejected (403) from saving widget filters");
  const memberPatch = await api("/api/widget-config", org1Member.cookie, {
    method: "PATCH",
    body: JSON.stringify({ scopes: [{ label: "Pool", facilityId: pool.id }] }),
  });
  check("403", memberPatch.status === 403, JSON.stringify(memberPatch.body));

  console.log("\n2. Org1 admin saves two scopes — a facility-only entry and a schedule-level entry (no departmentId submitted)");
  const saved = await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({
      scopes: [
        { label: "Gym", facilityId: gym.id },
        { label: "Lane Swim", facilityId: pool.id, scheduleGroupId: poolSchedule.id },
      ],
    }),
  });
  check("200", saved.status === 200, JSON.stringify(saved.body));
  check("returns 2 scopes", saved.body?.scopes?.length === 2, JSON.stringify(saved.body?.scopes));
  const scheduleScope = saved.body?.scopes?.find((s) => s.schedule_group_id === poolSchedule.id);
  check(
    "schedule-level scope's department_id auto-derived from the schedule (not left null)",
    scheduleScope?.department_id === poolDept.id,
    JSON.stringify(scheduleScope)
  );
  const widgetConfigId = saved.body?.config?.id;
  check("config row has an id", !!widgetConfigId);

  console.log("\n3. A scope referencing another org's facility is rejected (404), not silently accepted");
  const crossOrgScope = await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ scopes: [{ label: "Should fail", facilityId: org2Facility.id }] }),
  });
  check("404", crossOrgScope.status === 404, JSON.stringify(crossOrgScope.body));

  console.log("\n4. A scope whose department doesn't actually belong to the named facility is rejected (404)");
  const mismatchedScope = await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ scopes: [{ label: "Mismatch", facilityId: pool.id, departmentId: otherDept.id }] }),
  });
  check("404", mismatchedScope.status === 404, JSON.stringify(mismatchedScope.body));

  console.log("\n5. That last (rejected) PATCH did not touch the previously-saved list — GET still shows the original 2");
  const getAfterReject = await api(`/api/widget-config?orgId=${org1Admin.orgId}`, org1Admin.cookie);
  check("still 2 scopes", getAfterReject.body?.scopes?.length === 2, JSON.stringify(getAfterReject.body?.scopes));

  console.log("\n6. Omitting `scopes` entirely (an appearance-only save) leaves the saved filter list untouched");
  const appearanceOnly = await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ primaryColor: "#112233" }),
  });
  check("200", appearanceOnly.status === 200, JSON.stringify(appearanceOnly.body));
  const getAfterAppearance = await api(`/api/widget-config?orgId=${org1Admin.orgId}`, org1Admin.cookie);
  check(
    "still 2 scopes after an appearance-only save",
    getAfterAppearance.body?.scopes?.length === 2,
    JSON.stringify(getAfterAppearance.body?.scopes)
  );

  console.log("\n7. `scopes: []` explicitly clears the list back to no filter UI");
  const cleared = await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ scopes: [] }),
  });
  check("200", cleared.status === 200, JSON.stringify(cleared.body));
  check("returns 0 scopes", cleared.body?.scopes?.length === 0, JSON.stringify(cleared.body?.scopes));
  const getAfterClear = await api(`/api/widget-config?orgId=${org1Admin.orgId}`, org1Admin.cookie);
  check("GET also shows 0 scopes", getAfterClear.body?.scopes?.length === 0, JSON.stringify(getAfterClear.body?.scopes));

  console.log("\n8. Re-save 2 published-chain scopes for the live-embed checks below, plus one scope on an unpublished facility");
  const resaved = await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({
      scopes: [
        { label: "ZZ Verify-N Gym Pill", facilityId: gym.id },
        { label: "ZZ Verify-N Lane Swim Pill", facilityId: pool.id, scheduleGroupId: poolSchedule.id },
        { label: "ZZ Verify-N Draft Pill", facilityId: draft.id },
      ],
    }),
  });
  check("200", resaved.status === 200, JSON.stringify(resaved.body));
  check("returns 3 scopes", resaved.body?.scopes?.length === 3, JSON.stringify(resaved.body?.scopes));
  const draftScopeId = resaved.body?.scopes?.find((s) => s.facility_id === draft.id)?.id;

  console.log("\n9. Direct RLS read of widget_config_scopes: org1 admin (staff) sees all 3, including the unpublished-facility one");
  const org1Fresh = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await org1Fresh.auth.signInWithPassword({ email: org1Admin.email, password: org1Admin.password });
  const { data: staffRead, error: staffReadErr } = await org1Fresh
    .from("widget_config_scopes")
    .select("id")
    .eq("widget_config_id", widgetConfigId);
  check(
    "staff read sees all 3 rows regardless of publish state",
    !staffReadErr && staffRead?.length === 3,
    JSON.stringify({ staffReadErr, count: staffRead?.length })
  );

  console.log("\n10. Direct RLS read as a signed-out (anon) client: only the 2 fully-published-chain scopes are visible, not the draft one");
  const { data: anonRead, error: anonReadErr } = await anon
    .from("widget_config_scopes")
    .select("id, facility_id")
    .eq("widget_config_id", widgetConfigId);
  check(
    "anon sees exactly 2 rows",
    !anonReadErr && anonRead?.length === 2,
    JSON.stringify({ anonReadErr, rows: anonRead })
  );
  check(
    "the unpublished-facility scope is not among them",
    !(anonRead ?? []).some((r) => r.id === draftScopeId)
  );

  console.log(
    "\n11. Direct RLS read: org2's admin is just 'the public' here — sees the same 2 published-chain rows as anon, proving the gate is publish-state (not org), and still never the unpublished-facility one"
  );
  const org2Fresh = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await org2Fresh.auth.signInWithPassword({ email: org2Admin.email, password: org2Admin.password });
  const { data: crossOrgRead, error: crossOrgErr } = await org2Fresh
    .from("widget_config_scopes")
    .select("id")
    .eq("widget_config_id", widgetConfigId);
  check(
    "org2 admin sees the 2 published-chain rows (same as anon — published data is meant to be public)",
    !crossOrgErr && crossOrgRead?.length === 2,
    JSON.stringify({ crossOrgErr, count: crossOrgRead?.length })
  );
  check(
    "the unpublished-facility scope is not among them for org2 either",
    !(crossOrgRead ?? []).some((r) => r.id === draftScopeId)
  );

  console.log(
    "\n12. Live embed, unauthenticated: /widget/[orgId] (org-wide default scope) shows the colored header's schedule dropdown, defaulted to the first published-chain scope"
  );
  const widgetPage = await fetch(`${APP}/widget/${org1Admin.orgId}`);
  const widgetHtml = await widgetPage.text();
  check("200", widgetPage.status === 200, `status=${widgetPage.status}`);
  check("header renders as a dropdown (2+ scopes)", hasScopeDropdown(widgetHtml));
  check(
    "header title shows the first scope's label (sort_order default)",
    rendersAsText(widgetHtml, "ZZ Verify-N Gym Pill")
  );
  check(
    "does NOT show the unpublished-facility scope's label anywhere",
    !widgetHtml.includes("ZZ Verify-N Draft Pill")
  );

  console.log(
    "\n13. Down to a single scope: the dropdown disappears (nothing to switch between) and the header falls back to a plain title — but showing that one scope's own name, not the generic 'Schedule', and it still has to drive the data rather than silently falling back to the unfiltered org-wide embed"
  );
  await api("/api/widget-config", org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ scopes: [{ label: "ZZ Verify-N Gym Pill", facilityId: gym.id }] }),
  });
  const widgetPageSingle = await fetch(`${APP}/widget/${org1Admin.orgId}`);
  const widgetHtmlSingle = await widgetPageSingle.text();
  check("200", widgetPageSingle.status === 200, `status=${widgetPageSingle.status}`);
  check(
    "no dropdown markup with only 1 scope (nothing to pick between)",
    !hasScopeDropdown(widgetHtmlSingle)
  );
  check(
    "header title is still the lone scope's own label, plainly rendered",
    rendersAsText(widgetHtmlSingle, "ZZ Verify-N Gym Pill")
  );

  console.log("\n14. A facility-scoped embed that was never given any filters keeps behaving exactly as before (regression check)");
  const plainWidgetPage = await fetch(`${APP}/widget/${org1Admin.orgId}?facilityId=${pool.id}`);
  const plainWidgetHtml = await plainWidgetPage.text();
  check("200", plainWidgetPage.status === 200, `status=${plainWidgetPage.status}`);
  check("shows the facility name in the page header", plainWidgetHtml.includes(pool.name));
  check("no schedule dropdown (this config has no scopes)", !hasScopeDropdown(plainWidgetHtml));
  check("the colored header's title is the plain, generic 'Schedule'", rendersAsText(plainWidgetHtml, "Schedule"));
  check(
    "no scope-filter labels leak in from the org-wide config",
    !plainWidgetHtml.includes("ZZ Verify-N Gym Pill")
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
