/**
 * Departments page (/dashboard/departments) and the Facilities list's edit
 * link: both the department edit form (name/description/publish) and the
 * facility edit form (details + danger zone) existed already, but nothing in
 * the UI linked to either once the facility/department detail pages became
 * redirects into the schedule command centre. This checks the department
 * page's wiring to the existing /api/departments routes: the rendered list
 * shows a department's name/description/publish state, POST creates one and
 * it appears, PATCH (via the edit form's route) updates name/description/
 * publish and the rendered page reflects it, DELETE removes it and it's gone
 * from a re-fetch, and a plain member is rejected (403) from create/update/
 * delete per the existing owner/admin-only gate — a signed-in admin does the
 * acting throughout, not the service role, per docs/SECURITY.md's pattern.
 * It also checks that /dashboard/facilities now links each card to its edit
 * page and that the edit page itself renders and is org-scoped.
 *
 * Same pattern as the other verify-*.mjs: service-role fixtures, a real
 * signed-in cookie session against the live HTTP routes, a positive control
 * (org2's own department/facility, and the facility's *other* department
 * that must survive the delete), teardown in a finally.
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

  return { orgId: org.id, userId: userData.user.id, cookie: sessionCookies(signIn.session) };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org1Admin = await makeOrgWithUser("verify-m", stamp, "admin");
  ids.orgs.push(org1Admin.orgId);
  ids.users.push(org1Admin.userId);

  const org1Member = await makeOrgWithUser("verify-m", stamp, "member");
  // Same org as org1Admin — re-parent the membership to org1 first (its own
  // throwaway org has ON DELETE CASCADE on org_memberships, so deleting it
  // before this update would silently wipe the membership row too).
  await admin
    .from("org_memberships")
    .update({ org_id: org1Admin.orgId })
    .eq("user_id", org1Member.userId);
  await admin.from("organizations").delete().eq("id", org1Member.orgId);
  ids.users.push(org1Member.userId);

  const org2Admin = await makeOrgWithUser("verify-m2", stamp, "admin");
  ids.orgs.push(org2Admin.orgId);
  ids.users.push(org2Admin.userId);

  console.log("\n0. Fixture: a facility in org1, and a second org's facility (negative control)");
  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org1Admin.orgId,
        name: `ZZ Verify-M Pool ${stamp}`,
        slug: `zz-verify-m-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const org2Facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org2Admin.orgId,
        name: `ZZ Verify-M2 Pool ${stamp}`,
        slug: `zz-verify-m2-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  // A second department that must survive everything below — proves delete
  // and edits are scoped to the one department under test, not the facility.
  const survivor = (
    await admin
      .from("departments")
      .insert({
        org_id: org1Admin.orgId,
        facility_id: facility.id,
        name: `ZZ Verify-M Survivor ${stamp}`,
        slug: `zz-verify-m-survivor-${stamp}`,
        is_published: false,
      })
      .select("id")
      .single()
  ).data;

  console.log("\n1. A plain member is rejected (403) from creating a department");
  const memberCreate = await api("/api/departments", org1Member.cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: facility.id, name: "Should not be created" }),
  });
  check("403", memberCreate.status === 403, JSON.stringify(memberCreate.body));

  console.log("\n2. Org1 admin creates a department via POST /api/departments");
  const created = await api("/api/departments", org1Admin.cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: `ZZ Verify-M Aquatics ${stamp}`,
      description: "Lane swim and lessons",
    }),
  });
  check("201", created.status === 201, JSON.stringify(created.body));
  const deptId = created.body?.department?.id;
  check("created department starts unpublished (draft)", created.body?.department?.is_published === false);

  console.log("\n3. GET /dashboard/departments (rendered) lists the new department as Draft, with its description");
  const listPage1 = await fetch(`${APP}/dashboard/departments?facility=${facility.id}`, {
    headers: { Cookie: org1Admin.cookie },
  });
  const listHtml1 = await listPage1.text();
  check("200", listPage1.status === 200, `status=${listPage1.status}`);
  check("page contains the department name", listHtml1.includes(`ZZ Verify-M Aquatics ${stamp}`));
  check("page contains the description", listHtml1.includes("Lane swim and lessons"));
  check("page shows Draft (not yet published)", listHtml1.includes("Draft"));
  check("page contains the edit link for this department", listHtml1.includes(`/departments/${deptId}/edit`));
  check("page also contains the survivor department (both listed)", listHtml1.includes(`ZZ Verify-M Survivor ${stamp}`));
  check("page does NOT leak org2's facility name", !listHtml1.includes("ZZ Verify-M2"));

  console.log("\n4. GET the edit page — server-rendered form is prefilled with current values");
  const editPage = await fetch(`${APP}/dashboard/facilities/${facility.id}/departments/${deptId}/edit`, {
    headers: { Cookie: org1Admin.cookie },
  });
  const editHtml = await editPage.text();
  check("200", editPage.status === 200, `status=${editPage.status}`);
  check("edit page contains the current name as a form value", editHtml.includes(`ZZ Verify-M Aquatics ${stamp}`));

  console.log("\n5. A plain member is rejected (403) from updating the department");
  const memberUpdate = await api(`/api/departments/${deptId}`, org1Member.cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: "Member should not rename this" }),
  });
  check("403", memberUpdate.status === 403, JSON.stringify(memberUpdate.body));

  console.log("\n6. Org1 admin publishes + renames via PATCH /api/departments/[id] (what the edit form calls)");
  const updated = await api(`/api/departments/${deptId}`, org1Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({
      name: `ZZ Verify-M Aquatics Renamed ${stamp}`,
      is_published: true,
    }),
  });
  check("200", updated.status === 200, JSON.stringify(updated.body));
  check("is_published now true", updated.body?.department?.is_published === true);

  console.log("\n7. Cross-org PATCH 404s — org2 admin can't touch org1's department");
  const crossOrgUpdate = await api(`/api/departments/${deptId}`, org2Admin.cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: "org2 should not be able to do this" }),
  });
  check("404", crossOrgUpdate.status === 404, JSON.stringify(crossOrgUpdate.body));

  console.log("\n8. Re-fetch the list — reflects the rename and the Published badge, still shows the survivor");
  const listPage2 = await fetch(`${APP}/dashboard/departments?facility=${facility.id}`, {
    headers: { Cookie: org1Admin.cookie },
  });
  const listHtml2 = await listPage2.text();
  check("renamed department now appears", listHtml2.includes(`ZZ Verify-M Aquatics Renamed ${stamp}`));
  check("old name no longer appears", !listHtml2.includes(`ZZ Verify-M Aquatics ${stamp}<`));
  check("page shows Published", listHtml2.includes("Published"));
  check("survivor still present", listHtml2.includes(`ZZ Verify-M Survivor ${stamp}`));

  console.log("\n9. A plain member is rejected (403) from deleting the department");
  const memberDelete = await api(`/api/departments/${deptId}`, org1Member.cookie, { method: "DELETE" });
  check("403", memberDelete.status === 403, JSON.stringify(memberDelete.body));

  console.log("\n10. Org1 admin deletes it via DELETE /api/departments/[id]");
  const deleted = await api(`/api/departments/${deptId}`, org1Admin.cookie, { method: "DELETE" });
  check("200 ok:true", deleted.status === 200 && deleted.body?.ok === true, JSON.stringify(deleted.body));

  console.log("\n11. Re-fetch the list — deleted department is gone, survivor (positive control) remains");
  const listPage3 = await fetch(`${APP}/dashboard/departments?facility=${facility.id}`, {
    headers: { Cookie: org1Admin.cookie },
  });
  const listHtml3 = await listPage3.text();
  check("deleted department no longer appears", !listHtml3.includes(`ZZ Verify-M Aquatics Renamed ${stamp}`));
  check("survivor still present after delete", listHtml3.includes(`ZZ Verify-M Survivor ${stamp}`));

  console.log("\n12. Direct table read — org2 admin sees zero of org1's departments (RLS, not just route filtering)");
  const org2Fresh = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await org2Fresh.auth.signInWithPassword({
    email: `zz-verify-m2-admin-${stamp}@example.invalid`,
    password: `Zk!${stamp}aA9`,
  });
  const { data: crossOrgRead, error: crossOrgErr } = await org2Fresh
    .from("departments")
    .select("id")
    .eq("org_id", org1Admin.orgId);
  check(
    "org2 admin reads zero rows of org1's departments",
    !crossOrgErr && (crossOrgRead?.length ?? 0) === 0,
    JSON.stringify({ crossOrgErr, count: crossOrgRead?.length })
  );

  console.log("\n13. GET /dashboard/facilities (rendered) lists the facility and links to its edit page");
  const facilitiesListPage = await fetch(`${APP}/dashboard/facilities`, { headers: { Cookie: org1Admin.cookie } });
  const facilitiesListHtml = await facilitiesListPage.text();
  check("200", facilitiesListPage.status === 200, `status=${facilitiesListPage.status}`);
  check("page contains the facility name", facilitiesListHtml.includes(`ZZ Verify-M Pool ${stamp}`));
  check("page contains the edit link for this facility", facilitiesListHtml.includes(`/facilities/${facility.id}/edit`));
  check("page does NOT leak org2's facility name", !facilitiesListHtml.includes(`ZZ Verify-M2`));

  console.log("\n14. GET the facility edit page — server-rendered form is prefilled, danger zone present");
  const facilityEditPage = await fetch(`${APP}/dashboard/facilities/${facility.id}/edit`, {
    headers: { Cookie: org1Admin.cookie },
  });
  const facilityEditHtml = await facilityEditPage.text();
  check("200", facilityEditPage.status === 200, `status=${facilityEditPage.status}`);
  check("edit page contains the current facility name as a form value", facilityEditHtml.includes(`ZZ Verify-M Pool ${stamp}`));

  console.log("\n15. Cross-org facility edit page: org2's admin gets notFound()'s content, no data leak");
  // Soft-404, not a bug introduced here — same mechanism as [[feedback_soft404_cache_components]]:
  // the loading.tsx Suspense boundary above this route commits HTTP 200 before
  // notFound() resolves, on every route that must stay prerenderable under
  // cacheComponents (PPR). The route-level org_id filter is still what matters:
  // it correctly returns zero rows and no facility data reaches the response.
  const crossOrgFacilityEdit = await fetch(`${APP}/dashboard/facilities/${facility.id}/edit`, {
    headers: { Cookie: org2Admin.cookie },
  });
  const crossOrgFacilityEditHtml = await crossOrgFacilityEdit.text();
  check(
    "200 with not-found body (soft-404), not org1's facility data",
    crossOrgFacilityEdit.status === 200 && !crossOrgFacilityEditHtml.includes(`ZZ Verify-M Pool ${stamp}`),
    `status=${crossOrgFacilityEdit.status}`
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
