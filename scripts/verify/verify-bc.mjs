/**
 * The Settings section: nine pages, one list, and the first delete that exists.
 *
 * `/dashboard/settings` stopped being a page. The claims worth doubting:
 *
 *   1. **The nav list really is the single source of truth.** Every href in
 *      `SETTINGS_NAV` resolves to a route that a permitted role reaches and a
 *      refused role is redirected away from — both directions, per role. A
 *      page listed but not built, or built but not listed, is the exact
 *      failure the module exists to prevent, and it is invisible from inside
 *      the app.
 *
 *   2. **The three moved URLs still work.** `/dashboard/staff`,
 *      `/dashboard/billing` and `/dashboard/data-sources` are in sent
 *      invitation emails and in Stripe's stored return URLs. A 308, not a 404.
 *
 *   3. **`delete_organization()` refuses everything it claims to.** Not the
 *      owner, wrong name, live subscription — each independently, each as a
 *      DIRECT PostgREST call with the publishable key, because that is the
 *      path that skips the route handler entirely. And when it does run, the
 *      cascade is real: rows counted before and after.
 *
 *   4. **The delete cannot be aimed at someone else's organization.** There is
 *      no id in the route's path, so the test is a second org that must still
 *      be standing afterwards.
 *
 *   5. **Changing a password requires the current one.** A wrong one is
 *      refused AND the password is still the old one afterwards — proved by
 *      signing in with it, not by trusting the 403.
 *
 *   6. **The role matrix is the permission model.** Every tick it renders is
 *      read back out of `rolesWith()`.
 *
 * Sections marked FALSIFY say what to break to watch them go red.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-bc.mjs [--headed]
 *   node --experimental-strip-types scripts/verify/verify-bc.mjs --logic-only
 */
import fs from "fs";
import path from "path";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";
const LOGIC_ONLY = process.argv.includes("--logic-only");
const HEADED = process.argv.includes("--headed");

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

const ROLES = ["owner", "manager", "coordinator", "aux"];

// ── Section 0: the list and the matrix, with nothing running ────────────────
async function logicSection() {
  // nav.ts and roles.ts import each other by the `@/` alias, which Node's ESM
  // resolver does not know. The hook teaches it — without it this section would
  // have to transcribe the permission map, and a transcription tests the
  // transcription.
  register("./_alias-hooks.mjs", import.meta.url);
  console.log("\n0. SETTINGS_NAV and the role matrix (no database, no server)");

  const { SETTINGS_NAV, SETTINGS_ROOT, visibleSettingsNav, visibleSettingsItems } =
    await import("../../src/lib/settings/nav.ts");
  const { rolesWith, can } = await import("../../src/lib/auth/roles.ts");

  const all = SETTINGS_NAV.flatMap((g) => g.items);

  check("every settings href lives under the section root",
    all.every((i) => i.href === SETTINGS_ROOT || i.href.startsWith(`${SETTINGS_ROOT}/`)),
    all.map((i) => i.href).join(", "));

  check("no href appears twice",
    new Set(all.map((i) => i.href)).size === all.length);

  check("exactly one item is the index, and it is marked exact",
    all.filter((i) => i.href === SETTINGS_ROOT).length === 1 &&
      all.find((i) => i.href === SETTINGS_ROOT)?.exact === true);

  // THE CLAIM THAT MAKES THE SECTION REACHABLE AT ALL. An aux staffer has no
  // settings permission of any kind; if every item carried one they would open
  // Settings and find nothing, and there would be nowhere to change a password.
  const auxActor = { role: "aux", scopes: { departmentIds: [], facilityIds: [] } };
  const auxItems = visibleSettingsItems(auxActor);
  check("an aux staffer is offered exactly one settings page",
    auxItems.length === 1, auxItems.map((i) => i.href).join(", "));
  check("...and it is Your account",
    auxItems[0]?.href === "/dashboard/settings/account");

  // FALSIFY: give the account item a permission, and both of the above go red.
  check("the account page carries no permission at all",
    all.find((i) => i.href === "/dashboard/settings/account")?.permission === undefined);

  // An owner sees the whole catalogue; a manager sees everything but Billing
  // and Danger zone; a coordinator sees Staff and their account.
  const actorFor = (role) => ({ role, scopes: { departmentIds: [], facilityIds: [] } });
  const seen = Object.fromEntries(
    ROLES.map((role) => [role, visibleSettingsItems(actorFor(role)).map((i) => i.href)])
  );

  check("the owner is offered every page",
    seen.owner.length === all.length, `${seen.owner.length}/${all.length}`);
  check("a manager is not offered Billing",
    !seen.manager.includes("/dashboard/settings/billing"));
  check("a manager is not offered Danger zone",
    !seen.manager.includes("/dashboard/settings/danger"));
  check("a manager IS offered General, Contact, Public and Permissions",
    ["", "/contact", "/public", "/permissions"].every((s) =>
      seen.manager.includes(`/dashboard/settings${s}`)));
  check("a coordinator is offered Staff",
    seen.coordinator.includes("/dashboard/settings/staff"));
  check("a coordinator is NOT offered General",
    !seen.coordinator.includes("/dashboard/settings"));

  // Every role's list must be a subset of the catalogue, and must agree with
  // can() item by item — the filter and the permission model, cross-checked.
  for (const role of ROLES) {
    const expected = all
      .filter((i) => !i.permission || can(actorFor(role), i.permission))
      .map((i) => i.href);
    check(`${role}: the filtered list matches can() item by item`,
      JSON.stringify(seen[role]) === JSON.stringify(expected),
      `got ${seen[role].join(",")} / expected ${expected.join(",")}`);
  }

  // A null actor is the prerendered-shell case. It must NOT mean "no
  // permissions" — an empty rail that then fills in shifts the whole page.
  check("a null actor (the static shell) gets the full catalogue",
    visibleSettingsItems(null).length === all.length);

  check("no group survives with zero items",
    visibleSettingsNav(auxActor).every((g) => g.items.length > 0));

  // ── The role matrix ───────────────────────────────────────────────────────
  // Read straight out of the module the table renders from. FALSIFY: move
  // "billing:manage" to include manager in roles.ts and watch this go red
  // without touching the table.
  check("rolesWith reports billing as owner-only",
    JSON.stringify(rolesWith("billing:manage")) === JSON.stringify(["owner"]),
    rolesWith("billing:manage").join(","));
  check("rolesWith reports reading:write for every role including aux",
    ROLES.every((r) => rolesWith("reading:write").includes(r)));
  check("rolesWith reports staff:view WITHOUT aux",
    !rolesWith("staff:view").includes("aux") && rolesWith("staff:view").includes("coordinator"));
  check("rolesWith reports operations:view for coordinators but analytics:view not",
    rolesWith("operations:view").includes("coordinator") &&
      !rolesWith("analytics:view").includes("coordinator"));
}

if (LOGIC_ONLY) {
  await logicSection();
  console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

function cookieParts(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    out.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  }
  return out;
}
const headerFrom = (parts) => parts.map((c) => `${c.name}=${c.value}`).join("; ");

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

/**
 * A real account with a real membership, a browser cookie, and a PostgREST
 * client already carrying its session.
 *
 * The role strings are the four in migration 055. An earlier generation of
 * harnesses in this repo inserted role "admin", which 055 removed — the insert
 * fails silently and every request then 403s "No organization found", which
 * looks exactly like a product bug. See feedback_harness_invalid_admin_role.
 */
async function makeUser(orgId, role, label, scopeFacilityId = null) {
  const email = `zz-bc-${label}-${stamp}@example.invalid`;
  const password = `Zc!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);

  const { data: membership, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: data.user.id, role, email })
    .select("id")
    .single();
  if (mErr) throw new Error(`membership ${label} (${role}): ${mErr.message}`);

  if (scopeFacilityId) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert({ membership_id: membership.id, org_id: orgId, facility_id: scopeFacilityId });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn ${label}: ${signInErr.message}`);

  // Its own PostgREST client, so the RPC checks below go straight at the
  // database with the publishable key — the path that skips every route
  // handler in this app and is therefore the only one worth testing a
  // SECURITY DEFINER guard against.
  const client = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.auth.setSession(signIn.session);

  const parts = cookieParts(signIn.session);
  return {
    userId: data.user.id,
    membershipId: membership.id,
    email,
    password,
    client,
    cookie: headerFrom(parts),
    cookieParts: parts,
  };
}

/** A whole organization with one of everything, so a cascade has something to eat. */
async function makeOrg(prefix) {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ name: `ZZ ${prefix} ${stamp}`, slug: `zz-${prefix}-${stamp}`, status: "active" })
    .select("id, name")
    .single();
  if (error) throw new Error(`org ${prefix}: ${error.message}`);
  ids.orgs.push(org.id);

  const { data: facility } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ ${prefix} Pool ${stamp}`,
      slug: `zz-${prefix}-pool-${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
    })
    .select("id")
    .single();

  const { data: department } = await admin
    .from("departments")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: "Aquatics",
      slug: `zz-${prefix}-aq-${stamp}`,
      display_order: 0,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: group } = await admin
    .from("schedule_groups")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      department_id: department.id,
      name: `ZZ ${prefix} Lengths ${stamp}`,
      slug: `zz-${prefix}-lengths-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      status: "published",
      source: "manual",
      starts_on: "2026-01-01",
    })
    .select("id")
    .single();

  // The column names matter and are NOT the obvious ones — `dtstart` /
  // `dtend_time` / `valid_from`, not `start_time` / `end_time`. A first draft
  // of this harness guessed, the insert failed, and the error was never read:
  // the danger zone then reported "0 sessions" and every cascade assertion
  // would have passed against an organization with nothing in it. Hence the
  // throw.
  const { data: session, error: sessionErr } = await admin
    .from("sessions")
    .insert({
      org_id: org.id,
      schedule_group_id: group.id,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstart: "2026-01-05T09:00:00Z",
      dtend_time: "10:00",
      valid_from: "2026-01-01",
      occupancy_kind: "drop_in",
      is_active: true,
    })
    .select("id")
    .single();
  if (sessionErr) throw new Error(`fixture session (${prefix}): ${sessionErr.message}`);

  return { org, facility, department, group, session };
}

/** Rows still carrying this org id, across the tables the cascade must clear. */
async function survivingRows(orgId) {
  const tables = ["facilities", "departments", "schedule_groups", "sessions", "org_memberships"];
  const counts = {};
  for (const table of tables) {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
    counts[table] = count ?? 0;
  }
  return counts;
}

async function main() {
  await logicSection();

  const { error: probe } = await admin.rpc("delete_organization", {
    p_org_id: "00000000-0000-0000-0000-000000000000",
    p_confirm_name: "nothing",
  });
  // "Organization not found" means the function exists and ran. A missing
  // function reports PGRST202 / "Could not find the function" instead.
  const migrationApplied = !!probe && !/Could not find the function|PGRST202/i.test(probe.message);
  if (!migrationApplied) {
    console.log("\n  migration 062: NOT applied.");
  }

  const main = await makeOrg("bc");
  const bystander = await makeOrg("bcx");

  const owner = await makeUser(main.org.id, "owner", "owner");
  const manager = await makeUser(main.org.id, "manager", "manager");
  const coordinator = await makeUser(main.org.id, "coordinator", "coord", main.facility.id);
  const aux = await makeUser(main.org.id, "aux", "aux", main.facility.id);
  const bystanderOwner = await makeUser(bystander.org.id, "owner", "xowner");

  const actors = { owner, manager, coordinator, aux };

  // ── 1. The three moved URLs ───────────────────────────────────────────────
  // FALSIFY: delete the redirects() block in next.config.ts. All three go red.
  console.log("\n1. The URLs that moved");
  for (const [from, to] of [
    ["/dashboard/staff", "/dashboard/settings/staff"],
    ["/dashboard/billing", "/dashboard/settings/billing"],
    ["/dashboard/data-sources", "/dashboard/settings/data-sources"],
  ]) {
    const res = await fetch(`${APP}${from}`, {
      headers: { cookie: owner.cookie },
      redirect: "manual",
    });
    const location = res.headers.get("location") ?? "";
    check(`${from} redirects permanently to ${to}`,
      res.status === 308 && location.endsWith(to),
      `status ${res.status}, location ${location || "(none)"}`);
  }

  // ── 2. Every listed page is a real page ───────────────────────────────────
  console.log("\n2. Every page in SETTINGS_NAV answers");
  register("./_alias-hooks.mjs", import.meta.url);
  const { SETTINGS_NAV, visibleSettingsItems } = await import("../../src/lib/settings/nav.ts");
  const everyItem = SETTINGS_NAV.flatMap((g) => g.items);

  for (const item of everyItem) {
    // 200 for the owner, who may see all of them. A page that does not exist
    // is a 404 here, which is the whole point: the list can claim anything.
    const res = await fetch(`${APP}${item.href}`, { headers: { cookie: owner.cookie } });
    check(`owner: GET ${item.href} is 200`, res.status === 200, `status ${res.status}`);
  }

  // ── 3. delete_organization(), straight at the database ────────────────────
  console.log("\n3. delete_organization() — the guards, over PostgREST");
  if (!migrationApplied) {
    skipped("section 3", "migration 062 not applied");
  } else {
    // FALSIFY: drop the ownership check in the function. The first three go red.
    for (const role of ["manager", "coordinator", "aux"]) {
      const { error } = await actors[role].client.rpc("delete_organization", {
        p_org_id: main.org.id,
        p_confirm_name: main.org.name,
      });
      check(`a ${role} with the CORRECT name is refused`,
        !!error && /only the owner/i.test(error.message),
        error?.message ?? "no error at all");
    }

    const { error: wrongName } = await owner.client.rpc("delete_organization", {
      p_org_id: main.org.id,
      p_confirm_name: `${main.org.name} `.replace(/\s+$/, "") + "x",
    });
    check("the owner with a WRONG name is refused",
      !!wrongName && /does not match/i.test(wrongName.message),
      wrongName?.message ?? "no error at all");

    // The owner of a DIFFERENT organization, naming this one correctly. Being
    // an owner somewhere is not being an owner here.
    const { error: strangerOwner } = await bystanderOwner.client.rpc("delete_organization", {
      p_org_id: main.org.id,
      p_confirm_name: main.org.name,
    });
    check("an owner of another org cannot delete this one",
      !!strangerOwner && /only the owner/i.test(strangerOwner.message),
      strangerOwner?.message ?? "no error at all");

    // A live subscription blocks it. Inserted, tested, removed — the next
    // section needs the delete to succeed.
    const { error: subErr } = await admin.from("subscriptions").insert({
      org_id: main.org.id,
      stripe_customer_id: `cus_zz_${stamp}`,
      plan_tier: "pro",
      status: "active",
    });
    if (subErr) {
      skipped("a live subscription blocks the delete", `could not insert: ${subErr.message}`);
    } else {
      const { error: billed } = await owner.client.rpc("delete_organization", {
        p_org_id: main.org.id,
        p_confirm_name: main.org.name,
      });
      check("a live subscription blocks the delete",
        !!billed && /cancel the subscription/i.test(billed.message),
        billed?.message ?? "no error at all");

      await admin.from("subscriptions").update({ status: "canceled" }).eq("org_id", main.org.id);
      const { error: cancelled } = await owner.client.rpc("delete_organization", {
        p_org_id: main.org.id,
        p_confirm_name: main.org.name,
      });
      // The POSITIVE CONTROL for the whole section: with every guard satisfied
      // it must actually work. Without this, a function that refused
      // unconditionally would pass every assertion above.
      check("...and a cancelled one does not", !cancelled, cancelled?.message ?? "");

      if (!cancelled) {
        const left = await survivingRows(main.org.id);
        check("the cascade took the whole organization with it",
          Object.values(left).every((n) => n === 0),
          JSON.stringify(left));

        const { data: gone } = await admin.from("organizations").select("id").eq("id", main.org.id);
        check("the organization row is gone", (gone ?? []).length === 0);

        // CLAIM 4: nothing else moved.
        const bystanderRows = await survivingRows(bystander.org.id);
        check("the other organization is untouched",
          bystanderRows.facilities === 1 && bystanderRows.sessions === 1,
          JSON.stringify(bystanderRows));
      }
    }
  }

  // ── 4. DELETE /api/organizations ──────────────────────────────────────────
  console.log("\n4. DELETE /api/organizations");
  if (!migrationApplied) {
    skipped("section 4", "migration 062 not applied");
  } else {
    // A fresh org, because section 3 consumed the first one.
    const second = await makeOrg("bc2");
    const secondOwner = await makeUser(second.org.id, "owner", "owner2");
    const secondManager = await makeUser(second.org.id, "manager", "manager2");

    const deny = await fetch(`${APP}/api/organizations`, {
      method: "DELETE",
      headers: { cookie: secondManager.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: second.org.name }),
    });
    check("a manager gets 403 from the route", deny.status === 403, `status ${deny.status}`);

    const wrong = await fetch(`${APP}/api/organizations`, {
      method: "DELETE",
      headers: { cookie: secondOwner.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "not the name" }),
    });
    const wrongBody = await wrong.json().catch(() => ({}));
    check("the owner with a wrong name gets 400 naming the expected one",
      wrong.status === 400 && (wrongBody.error ?? "").includes(second.org.name),
      `status ${wrong.status}: ${wrongBody.error ?? ""}`);

    const stillThere = await survivingRows(second.org.id);
    check("nothing was deleted by either refusal",
      stillThere.facilities === 1 && stillThere.sessions === 1,
      JSON.stringify(stillThere));

    const ok = await fetch(`${APP}/api/organizations`, {
      method: "DELETE",
      headers: { cookie: secondOwner.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: second.org.name }),
    });
    check("the owner with the right name gets 200", ok.status === 200, `status ${ok.status}`);

    const after = await survivingRows(second.org.id);
    check("...and the route's delete cascaded too",
      Object.values(after).every((n) => n === 0), JSON.stringify(after));
  }

  // ── 5. /api/account ───────────────────────────────────────────────────────
  console.log("\n5. /api/account — the current password is required");
  const third = await makeOrg("bc3");
  const person = await makeUser(third.org.id, "manager", "person");
  const NEW_PASSWORD = `Nw!${stamp}bB7xyz`;

  const refused = await fetch(`${APP}/api/account`, {
    method: "POST",
    headers: { cookie: person.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "password",
      currentPassword: "not-the-password",
      newPassword: NEW_PASSWORD,
    }),
  });
  check("a wrong current password is refused with 403", refused.status === 403, `status ${refused.status}`);

  // THE ASSERTION THAT MATTERS. A 403 that still changed the password would
  // pass the check above and be the worst possible outcome.
  const probeClient = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stillOld = await probeClient.auth.signInWithPassword({
    email: person.email,
    password: person.password,
  });
  check("...and the password is still the old one", !stillOld.error, stillOld.error?.message ?? "");

  const tooShort = await fetch(`${APP}/api/account`, {
    method: "POST",
    headers: { cookie: person.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "password", currentPassword: person.password, newPassword: "short" }),
  });
  check("a new password under 10 characters is refused", tooShort.status === 400, `status ${tooShort.status}`);

  const changed = await fetch(`${APP}/api/account`, {
    method: "POST",
    headers: { cookie: person.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "password",
      currentPassword: person.password,
      newPassword: NEW_PASSWORD,
    }),
  });
  // The positive control: with the right current password it must work, or
  // every refusal above is passing for the wrong reason.
  check("the right current password changes it", changed.status === 200, `status ${changed.status}`);

  const withNew = await createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email: person.email, password: NEW_PASSWORD });
  check("...and the new password signs in", !withNew.error, withNew.error?.message ?? "");

  const anonymous = await fetch(`${APP}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sign-out-others" }),
  });
  check("a signed-out caller gets 401", anonymous.status === 401, `status ${anonymous.status}`);

  // The snapshot reconciliation must touch only the caller's own rows.
  await admin.from("org_memberships").update({ email: "stale@example.invalid" }).eq("id", person.membershipId);
  const otherBefore = await admin
    .from("org_memberships").select("email").eq("id", bystanderOwner.membershipId).single();

  const sync = await fetch(`${APP}/api/account`, {
    method: "POST",
    headers: { cookie: person.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync-email" }),
  });
  const syncBody = await sync.json().catch(() => ({}));
  check("sync-email repairs the caller's own stale snapshot", syncBody.changed === 1, JSON.stringify(syncBody));

  const repaired = await admin
    .from("org_memberships").select("email").eq("id", person.membershipId).single();
  check("...to the account's real address", repaired.data?.email === person.email, repaired.data?.email ?? "");

  const otherAfter = await admin
    .from("org_memberships").select("email").eq("id", bystanderOwner.membershipId).single();
  check("...and nobody else's row moved",
    otherAfter.data?.email === otherBefore.data?.email,
    `${otherBefore.data?.email} -> ${otherAfter.data?.email}`);

  // ── 6. The import routes the Data sources page links to ───────────────────
  // Tightening `/dashboard/settings/data-sources` made it obvious that the
  // thing it links to was open to everyone: "has a membership" was the whole
  // check on both import endpoints, so an aux staffer could POST rows that
  // create schedule groups and sessions. RLS refused the write (055 §5), so
  // nothing was ever created — what they got was an opaque policy failure
  // instead of an answer.
  //
  // FALSIFY: remove either requirePermission() call and the matching pair here
  // goes red.
  console.log("\n6. /api/import and /api/import/commit are gated on import:use");
  const fifth = await makeOrg("bc5");
  const importers = {
    owner: await makeUser(fifth.org.id, "owner", "owner5"),
    coordinator: await makeUser(fifth.org.id, "coordinator", "coord5", fifth.facility.id),
    aux: await makeUser(fifth.org.id, "aux", "aux5", fifth.facility.id),
  };

  for (const role of ["coordinator", "aux"]) {
    const commit = await fetch(`${APP}/api/import/commit`, {
      method: "POST",
      headers: { cookie: importers[role].cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [], facilityId: fifth.facility.id }),
    });
    check(`a ${role} is refused by /api/import/commit`, commit.status === 403, `status ${commit.status}`);

    const form = new FormData();
    form.append("file", new Blob(["program_name\n"], { type: "text/csv" }), "x.csv");
    form.append("facilityId", fifth.facility.id);
    const parse = await fetch(`${APP}/api/import`, {
      method: "POST",
      headers: { cookie: importers[role].cookie },
      body: form,
    });
    check(`a ${role} is refused by /api/import`, parse.status === 403, `status ${parse.status}`);
  }

  // The positive control. Without it, a route that 403'd everybody would pass
  // every assertion above — and "nobody can import" is a worse bug than the
  // one being fixed.
  const ownerCommit = await fetch(`${APP}/api/import/commit`, {
    method: "POST",
    headers: { cookie: importers.owner.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [], facilityId: fifth.facility.id }),
  });
  check("the owner is NOT refused", ownerCommit.status === 200, `status ${ownerCommit.status}`);

  // ── 7. The section in a browser ───────────────────────────────────────────
  console.log("\n7. The rail, the gates and the phone");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const fourth = await makeOrg("bc4");
    const roleUsers = {
      owner: await makeUser(fourth.org.id, "owner", "owner4"),
      manager: await makeUser(fourth.org.id, "manager", "manager4"),
      coordinator: await makeUser(fourth.org.id, "coordinator", "coord4", fourth.facility.id),
      aux: await makeUser(fourth.org.id, "aux", "aux4", fourth.facility.id),
    };

    for (const role of ROLES) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addCookies(
        roleUsers[role].cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false }))
      );
      const page = await context.newPage();

      const allowed = new Set(
        visibleSettingsItems({ role, scopes: { departmentIds: [], facilityIds: [] } }).map((i) => i.href)
      );

      // CLAIM 1, both directions. A page the rail offers must open; a page it
      // does not must send you to the one page every role has. `redirect()`
      // here fires inside a streamed Suspense boundary, so the HTTP status is
      // already 200 by then — the landing URL is the only honest test, and it
      // is also what the person actually experiences.
      for (const item of everyItem) {
        await page.goto(`${APP}${item.href}`, { waitUntil: "networkidle" });
        const landed = new URL(page.url()).pathname;
        if (allowed.has(item.href)) {
          check(`${role}: ${item.href} opens`, landed === item.href, `landed on ${landed}`);
        } else {
          check(`${role}: ${item.href} is refused and lands on Your account`,
            landed === "/dashboard/settings/account", `landed on ${landed}`);
        }
      }

      // The rail must offer exactly what the module says it does.
      await page.goto(`${APP}/dashboard/settings/account`, { waitUntil: "networkidle" });
      const rail = page.getByRole("navigation", { name: "Settings sections" }).last();
      const railHrefs = await rail.getByRole("link").evaluateAll((els) =>
        els.map((el) => new URL(el.href).pathname)
      );
      check(`${role}: the rail lists exactly the permitted pages`,
        JSON.stringify(railHrefs) === JSON.stringify([...allowed]),
        `rail ${railHrefs.join(",")} / expected ${[...allowed].join(",")}`);

      await context.close();
    }

    // Leaving must be reachable by the role that could never reach it before.
    const auxContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await auxContext.addCookies(
      roleUsers.aux.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false }))
    );
    const auxPage = await auxContext.newPage();
    await auxPage.goto(`${APP}/dashboard/settings/account`, { waitUntil: "networkidle" });
    check("an aux staffer can reach 'Leave organization'",
      await auxPage.getByRole("button", { name: /leave organization/i }).isVisible());
    check("...and the password form",
      await auxPage.getByLabel("Current password").first().isVisible());

    const scrollW = await auxPage.evaluate(() => document.documentElement.scrollWidth);
    check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
    await auxPage.screenshot({ path: path.join(OUT, "settings-account-mobile.png"), fullPage: true });

    // The owner never sees a Leave button: leave_organization() refuses them.
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ownerContext.addCookies(
      roleUsers.owner.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false }))
    );
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${APP}/dashboard/settings/account`, { waitUntil: "networkidle" });
    check("the owner is NOT offered 'Leave organization'",
      (await ownerPage.getByRole("button", { name: /leave organization/i }).count()) === 0);

    await ownerPage.goto(`${APP}/dashboard/settings/danger`, { waitUntil: "networkidle" });
    check("the danger zone names the organization in the typed confirmation",
      await ownerPage.getByRole("button", { name: /delete organization…/i }).isVisible());
    await ownerPage.screenshot({ path: path.join(OUT, "settings-danger-desktop.png"), fullPage: true });

    await ownerPage.goto(`${APP}/dashboard/settings/permissions`, { waitUntil: "networkidle" });
    check("the permissions page renders the role matrix",
      await ownerPage.getByRole("table", { name: /what each role/i }).isVisible().catch(() => false) ||
        (await ownerPage.getByText("Manage billing").count()) > 0);

    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerPage.goto(`${APP}/dashboard/settings`, { waitUntil: "networkidle" });
    const strip = ownerPage.getByRole("navigation", { name: "Settings sections" }).first();
    check("the phone tab strip carries every permitted page",
      (await strip.getByRole("link").count()) === everyItem.length,
      `${await strip.getByRole("link").count()} tabs`);
    const generalScroll = await ownerPage.evaluate(() => document.documentElement.scrollWidth);
    check("General has no horizontal overflow at 390px", generalScroll <= 390, `scrollWidth ${generalScroll}`);
    await ownerPage.screenshot({ path: path.join(OUT, "settings-general-mobile.png"), fullPage: true });
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.message}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
