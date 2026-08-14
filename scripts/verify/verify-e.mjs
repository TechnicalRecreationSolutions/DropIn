/**
 * Facility delete + organization settings verification.
 *
 * Same pattern as verify-b/c/d: service-role fixtures, real HTTP routes driven
 * as genuinely signed-in users over cookies, everything torn down in a finally.
 *
 * Two users, because both features draw an owner/admin-vs-member line and
 * testing one side of a role split proves half a decision.
 *
 * The mechanism under test for the delete is the **cascade**, not the 200. The
 * route deletes one row and lets six foreign keys do the rest, so an assertion
 * that only checked the facility is gone would pass even if every schedule it
 * contained had been orphaned or left behind.
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

/** Serialize a supabase session the way @supabase/ssr writes it, chunking as it does. */
function sessionCookies(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [`${COOKIE_NAME}=${value}`];
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  }
  return chunks;
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

/**
 * GET a dashboard page as a signed-in user and return its HTML.
 *
 * Both features add a Server Component that queries on render, which is the
 * failure mode a route-handler test cannot see: the API can be perfect while
 * the page that calls it throws. This project has shipped two launch-blocking
 * bugs that only appeared when the UI was actually rendered.
 */
async function page(path, cookie) {
  const res = await fetch(`${APP}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

/** Counts rows in `table` for a facility — used as both fixture proof and cascade proof. */
async function countFor(table, facilityId) {
  const { count } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId);
  return count ?? 0;
}

async function sessionCount(scheduleGroupId) {
  const { count } = await admin
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("schedule_group_id", scheduleGroupId);
  return count ?? 0;
}

/**
 * A facility with departments, a schedule group, sessions and spaces under it.
 *
 * The counts are configurable and deliberately distinct from each other for
 * org A: the deletion-impact assertions read them back out of the rendered
 * page, and four fields that all say "1" would pass even if the helper mixed
 * them up.
 */
async function buildTree(orgId, tag, counts = {}) {
  const { departments = 1, spaces = 1, sessions = 1 } = counts;
  const { data: fac, error: facErr } = await admin
    .from("facilities")
    .insert({
      org_id: orgId,
      name: `ZZ ${tag} Centre`,
      slug: `zz-${tag}-centre-${stamp}`,
      address_line1: "1 Test St",
      city: "Edmonton",
      province: "AB",
      postal_code: "T0T0T0",
      is_published: true,
    })
    .select("id, name")
    .single();
  if (facErr) throw new Error(`facility ${tag}: ${facErr.message}`);

  const { data: depts, error: deptErr } = await admin
    .from("departments")
    .insert(
      Array.from({ length: departments }, (_, i) => ({
        org_id: orgId,
        facility_id: fac.id,
        name: `ZZ ${tag} Aquatics ${i}`,
        slug: `zz-${tag}-aquatics-${i}-${stamp}`,
      }))
    )
    .select("id");
  if (deptErr) throw new Error(`department ${tag}: ${deptErr.message}`);
  const dept = depts[0];

  const { data: sg, error: sgErr } = await admin
    .from("schedule_groups")
    .insert({
      org_id: orgId,
      facility_id: fac.id,
      department_id: dept.id,
      name: `ZZ ${tag} Swim`,
      slug: `zz-${tag}-swim-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      cost_cents: 0,
      is_published: true,
    })
    .select("id")
    .single();
  if (sgErr) throw new Error(`schedule_group ${tag}: ${sgErr.message}`);

  const { error: sessErr } = await admin.from("sessions").insert(
    Array.from({ length: sessions }, () => ({
      org_id: orgId,
      schedule_group_id: sg.id,
      rrule: "FREQ=WEEKLY;BYDAY=WE",
      dtstart: "2026-08-05T18:00:00Z",
      dtend_time: "21:00",
      valid_from: "2026-08-01",
      valid_until: "2026-08-31",
      is_active: true,
    }))
  );
  if (sessErr) throw new Error(`session ${tag}: ${sessErr.message}`);

  const { error: spaceErr } = await admin.from("spaces").insert(
    Array.from({ length: spaces }, (_, i) => ({
      org_id: orgId,
      facility_id: fac.id,
      name: `ZZ ${tag} Lane ${i}`,
      slug: `zz-${tag}-lane-${i}-${stamp}`,
    }))
  );
  if (spaceErr) throw new Error(`space ${tag}: ${spaceErr.message}`);

  return { id: fac.id, name: fac.name, scheduleGroup: sg.id, department: dept.id };
}

async function mkUser(tag, orgId, role) {
  const email = `verify-e-${tag}-${stamp}@example.invalid`;
  const password = `Ve!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  ids.users.push(data.user.id);
  await admin.from("org_memberships").insert({ org_id: orgId, user_id: data.user.id, role });

  const c = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signErr } = await c.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`signIn ${tag}: ${signErr.message}`);
  return sessionCookies(signIn.session).join("; ");
}

try {
  // ------------------------------------------------------------------ setup
  const mkOrg = async (tag) => {
    const { data, error } = await admin
      .from("organizations")
      .insert({
        name: `ZZ ${tag} ${stamp}`,
        slug: `zz-${tag}-${stamp}`,
        status: "active",
        description: "original description",
        logo_url: "https://example.invalid/original.png",
      })
      .select("id, slug")
      .single();
    if (error) throw new Error(`org ${tag}: ${error.message}`);
    ids.orgs.push(data.id);
    return data;
  };

  const orgA = await mkOrg("alpha");
  const orgB = await mkOrg("bravo");

  const adminCookie = await mkUser("admin", orgA.id, "admin");
  const memberCookie = await mkUser("member", orgA.id, "member");

  // Four distinct numbers, so a helper that transposed two fields fails.
  const facA = await buildTree(orgA.id, "alpha", { departments: 2, spaces: 3, sessions: 4 });
  const facB = await buildTree(orgB.id, "bravo");

  console.log(`\nOrgs ${orgA.id} / ${orgB.id}; an admin and a member signed in\n`);

  // ============================================================ FACILITY DELETE
  console.log("1. Fixture is real (positive control for the cascade below)");
  check("facility has 2 departments", (await countFor("departments", facA.id)) === 2);
  check("facility has 1 schedule group", (await countFor("schedule_groups", facA.id)) === 1);
  check("facility has 3 spaces", (await countFor("spaces", facA.id)) === 3);
  check("schedule group has 4 sessions", (await sessionCount(facA.scheduleGroup)) === 4);

  // ------------------------------------------------------------ page renders
  console.log("\n1b. The pages actually render (Server Components query on render)");
  const editPage = await page(`/dashboard/facilities/${facA.id}/edit`, adminCookie);
  check("facility edit page is 200", editPage.status === 200, `got ${editPage.status}`);
  check("...renders the danger zone", editPage.html.includes("Danger zone"));
  check("...offers the delete", editPage.html.includes("Delete facility"));

  // The dialog is closed on first render so its copy is not in the DOM, but
  // Next serializes the client component's props into the flight payload. That
  // is where the impact counts are, and it is the only end-to-end proof that
  // getFacilityDeletionImpact returned the right numbers — in particular that
  // `sessions` was counted through the schedule group rather than being 0.
  for (const [field, want] of [
    ["departments", 2],
    ["scheduleGroups", 1],
    ["sessions", 4],
    ["spaces", 3],
    ["brochures", 0],
  ]) {
    check(
      `...deletion impact reports ${field}: ${want}`,
      new RegExp(`\\\\?"${field}\\\\?":${want}`).test(editPage.html),
      "not found in the flight payload"
    );
  }

  const settingsAdmin = await page("/dashboard/settings", adminCookie);
  check("org settings page is 200", settingsAdmin.status === 200, `got ${settingsAdmin.status}`);
  check("...shows the fixed public address", settingsAdmin.html.includes(`/org/${orgA.slug}`));
  check("...prefills the org name", settingsAdmin.html.includes(`ZZ alpha ${stamp}`));
  check("...offers to save", settingsAdmin.html.includes("Save changes"));

  const settingsMember = await page("/dashboard/settings", memberCookie);
  check("member can open org settings", settingsMember.status === 200, `got ${settingsMember.status}`);
  check("...but is told it is read-only", settingsMember.html.includes("Only owners and admins"));
  check("...and gets no save button", !settingsMember.html.includes("Save changes"));

  const editAsMember = await page(`/dashboard/facilities/${facA.id}/edit`, memberCookie);
  check("member sees no danger zone", !editAsMember.html.includes("Danger zone"), "danger zone rendered for a member");

  console.log("\n2. Guards");
  const anon = await api(`/api/facilities/${facA.id}`, null, { method: "DELETE" });
  check("anonymous DELETE is 401", anon.status === 401, `got ${anon.status}`);

  const asMember = await api(`/api/facilities/${facA.id}`, memberCookie, { method: "DELETE" });
  check("member DELETE is 403", asMember.status === 403, `got ${asMember.status}`);
  // Positive control: a 403 that had deleted the row anyway would look identical
  // from the response alone.
  const { data: stillThere } = await admin
    .from("facilities")
    .select("id")
    .eq("id", facA.id)
    .maybeSingle();
  check("...and the facility still exists", !!stillThere);

  const missing = await api(`/api/facilities/${crypto.randomUUID()}`, adminCookie, {
    method: "DELETE",
  });
  check("unknown id is 404", missing.status === 404, `got ${missing.status}`);

  console.log("\n3. Cross-org isolation");
  // Org A's admin naming org B's facility. The org_id predicate should make this
  // indistinguishable from a non-existent row.
  const crossOrg = await api(`/api/facilities/${facB.id}`, adminCookie, { method: "DELETE" });
  check("admin cannot delete another org's facility (404)", crossOrg.status === 404, `got ${crossOrg.status}`);
  const { data: bStillThere } = await admin
    .from("facilities")
    .select("id")
    .eq("id", facB.id)
    .maybeSingle();
  check("...and org B's facility still exists", !!bStillThere);

  console.log("\n4. Admin delete, and the cascade it relies on");
  const del = await api(`/api/facilities/${facA.id}`, adminCookie, { method: "DELETE" });
  check("admin DELETE is 200", del.status === 200, `got ${del.status} ${JSON.stringify(del.body)}`);

  const { data: gone } = await admin
    .from("facilities")
    .select("id")
    .eq("id", facA.id)
    .maybeSingle();
  check("facility row is gone", !gone);

  // The point of the whole exercise: the route deletes one row and the schema
  // takes the rest. If any of these survive they are orphans nothing can reach.
  check("departments cascaded", (await countFor("departments", facA.id)) === 0);
  check("schedule groups cascaded", (await countFor("schedule_groups", facA.id)) === 0);
  check("spaces cascaded", (await countFor("spaces", facA.id)) === 0);
  check("sessions cascaded via their schedule group", (await sessionCount(facA.scheduleGroup)) === 0);

  // Negative control on the cascade: org B's identical tree must be untouched.
  check("org B's department survived", (await countFor("departments", facB.id)) === 1);
  check("org B's sessions survived", (await sessionCount(facB.scheduleGroup)) === 1);

  // ============================================================== ORG SETTINGS
  console.log("\n5. Org settings guards");
  const orgAnon = await api("/api/organizations", null, {
    method: "PATCH",
    body: JSON.stringify({ name: "hijacked" }),
  });
  check("anonymous PATCH is 401", orgAnon.status === 401, `got ${orgAnon.status}`);

  const orgMember = await api("/api/organizations", memberCookie, {
    method: "PATCH",
    body: JSON.stringify({ name: "member rename" }),
  });
  check("member PATCH is 403", orgMember.status === 403, `got ${orgMember.status}`);

  const { data: unchanged } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgA.id)
    .single();
  check("...and the name is unchanged", unchanged.name.startsWith("ZZ alpha"), unchanged.name);

  const badEmail = await api("/api/organizations", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ email: "not-an-email" }),
  });
  check("invalid email is 400", badEmail.status === 400, `got ${badEmail.status}`);

  console.log("\n6. Admin PATCH writes what it claims to");
  const saved = await api("/api/organizations", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({
      name: `ZZ alpha renamed ${stamp}`,
      description: "a new description",
      logo_url: "https://example.invalid/new-logo.png",
      city: "Calgary",
      province: "AB",
      // Posted deliberately: `slug` is absent from the zod schema, so this must
      // be stripped rather than written. A changed slug 404s every embed the
      // centre has already published.
      slug: "hijacked-slug",
      // Ditto: not a settable field, and the org's own subscription state.
      status: "suspended",
    }),
  });
  check("admin PATCH is 200", saved.status === 200, `got ${saved.status} ${JSON.stringify(saved.body)}`);

  const { data: after } = await admin
    .from("organizations")
    .select("name, description, logo_url, city, province, slug, status")
    .eq("id", orgA.id)
    .single();

  check("name saved", after.name === `ZZ alpha renamed ${stamp}`, after.name);
  check("description saved", after.description === "a new description", String(after.description));
  check("logo_url saved", after.logo_url === "https://example.invalid/new-logo.png", String(after.logo_url));
  check("city saved", after.city === "Calgary", String(after.city));
  check("slug NOT changed by the request", after.slug === orgA.slug, after.slug);
  check("status NOT changed by the request", after.status === "active", after.status);

  console.log("\n7. Clearing a field stores NULL, not an empty string");
  // `OrgImage` and anchor hrefs read these. An empty string renders a broken
  // image and a link to the current page; null is the "unset" they handle.
  await api("/api/organizations", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ logo_url: "", description: "", website_url: "" }),
  });
  const { data: cleared } = await admin
    .from("organizations")
    .select("logo_url, description, website_url")
    .eq("id", orgA.id)
    .single();
  check("logo_url is null", cleared.logo_url === null, JSON.stringify(cleared.logo_url));
  check("description is null", cleared.description === null, JSON.stringify(cleared.description));
  check("website_url is null", cleared.website_url === null, JSON.stringify(cleared.website_url));

  console.log("\n8. One org's settings do not touch another's");
  const { data: bOrg } = await admin
    .from("organizations")
    .select("name, description, logo_url")
    .eq("id", orgB.id)
    .single();
  check("org B name untouched", bOrg.name.startsWith("ZZ bravo"), bOrg.name);
  check("org B description untouched", bOrg.description === "original description", String(bOrg.description));
  check("org B logo untouched", bOrg.logo_url === "https://example.invalid/original.png", String(bOrg.logo_url));
} finally {
  // ---------------------------------------------------------------- teardown
  for (const id of ids.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of ids.users) {
    await admin.auth.admin.deleteUser(id);
  }

  const { data: leftoverOrgs } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftoverOrgs?.length ?? 0} org(s) left over${
      leftoverOrgs?.length ? ` — ${leftoverOrgs.map((o) => o.name).join(", ")}` : ""
    }`
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
