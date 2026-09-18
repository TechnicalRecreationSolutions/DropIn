/**
 * Staff roles, scopes and invitations (migrations 055 + 056).
 *
 *   npm run dev
 *   node scripts/verify/verify-al.mjs
 *
 * ## What makes this one different
 *
 * Almost every DENY here is asserted **against PostgREST directly**, not
 * through an API route.
 *
 * That is the whole point. The publishable key ships in the browser bundle, so
 * a lifeguard can skip this app entirely and talk to the database. Migration
 * 024 exists because exactly that gap was found once already — the API checked
 * `owner|admin` on nine tables while RLS let any member write them. A test that
 * only proves a button is hidden, or that a route answers 403, proves nothing
 * about the control that actually holds.
 *
 * So: the service role builds fixtures, and four genuinely signed-in users —
 * owner, manager, coordinator, aux — do the acting. Every deny has a matching
 * positive control, because `[]` from a working policy and `[]` from an empty
 * table are the same two characters.
 *
 * ## Fixture shape
 *
 *   ZZ Roles Org
 *     └── ZZ Pool ─── Aquatics  ── Lap Swim  ── session A   ← coordinator's
 *     │            └─ Fitness   ── Spin      ── session B   ← sibling dept
 *     └── ZZ Arena ── (no dept) ── Open Gym  ── session C   ← NULL department
 *
 * The coordinator holds Aquatics only. The aux staffer holds ZZ Pool only.
 * `Open Gym` has `department_id IS NULL`, which is a real state in production
 * (`Pickleball Open Play`) and must stay owner/manager-only.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP ?? "http://localhost:3000";
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
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0,
  fail = 0;
const check = (l, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${l}`);
  } else {
    fail++;
    console.log(`  FAIL  ${l}${d ? ` — ${d}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

/** A client bound to a real signed-in session — never the service role. */
async function signedInAs(email, password) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function makeUser(orgId, role, scopeRows, label = role) {
  // `label`, not `role`: there are TWO coordinators in this fixture — one
  // scoped and one deliberately stranded — so an address derived from the role
  // alone collides on the second createUser.
  const email = `zz-${label}-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: u, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${role}: ${error.message}`);
  ids.users.push(u.user.id);

  const { data: m, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: u.user.id, role, email })
    .select("id")
    .single();
  if (mErr) throw new Error(`membership ${role}: ${mErr.message}`);

  if (scopeRows?.length) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert(scopeRows.map((r) => ({ membership_id: m.id, org_id: orgId, ...r })));
    if (sErr) throw new Error(`scopes ${role}: ${sErr.message}`);
  }

  return { email, password, userId: u.user.id, membershipId: m.id };
}

async function main() {
  // ── Fixtures, built with the service role ────────────────────────────────
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ Roles ${stamp}`, slug: `zz-roles-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const facility = async (name, slug) =>
    (
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name,
          slug,
          address_line1: "1 Test St",
          city: "Victoria",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: true,
        })
        .select("id")
        .single()
    ).data;

  const pool = await facility(`ZZ Pool ${stamp}`, `zz-pool-${stamp}`);
  const arena = await facility(`ZZ Arena ${stamp}`, `zz-arena-${stamp}`);

  const department = async (facilityId, name) =>
    (
      await admin
        .from("departments")
        .insert({
          org_id: org.id,
          facility_id: facilityId,
          name,
          slug: `zz-${name.toLowerCase()}-${stamp}`,
          is_published: true,
        })
        .select("id")
        .single()
    ).data;

  const aquatics = await department(pool.id, "Aquatics");
  const fitness = await department(pool.id, "Fitness");

  const group = async (facilityId, departmentId, name, slug) =>
    (
      await admin
        .from("schedule_groups")
        .insert({
          org_id: org.id,
          facility_id: facilityId,
          department_id: departmentId,
          name,
          slug,
          sport_category: "swimming",
          activity_type: "drop_in",
          status: "published",
          source: "manual",
          starts_on: "2026-01-01",
        })
        .select("id")
        .single()
    ).data;

  const lapSwim = await group(pool.id, aquatics.id, `ZZ Lap ${stamp}`, `zz-lap-${stamp}`);
  const spin = await group(pool.id, fitness.id, `ZZ Spin ${stamp}`, `zz-spin-${stamp}`);
  // department_id NULL — the production shape this must keep refusing.
  const openGym = await group(arena.id, null, `ZZ Gym ${stamp}`, `zz-gym-${stamp}`);

  const session = async (groupId) =>
    (
      await admin
        .from("sessions")
        .insert({
          org_id: org.id,
          schedule_group_id: groupId,
          rrule: "FREQ=WEEKLY;BYDAY=MO",
          dtstart: "2026-01-05T06:00:00Z",
          dtend_time: "08:00",
          valid_from: "2026-01-01",
          is_active: true,
        })
        .select("id")
        .single()
    ).data;

  const sessionA = await session(lapSwim.id); // Aquatics — coordinator's own
  const sessionB = await session(spin.id); // Fitness   — sibling department
  const sessionC = await session(openGym.id); // no department at all

  await admin
    .from("session_internal")
    .insert({ session_id: sessionA.id, org_id: org.id, holder_name: "ZZ Island Swimming" });
  await admin
    .from("session_internal")
    .insert({ session_id: sessionC.id, org_id: org.id, holder_name: "ZZ Arena Rental" });

  const owner = await makeUser(org.id, "owner");
  const manager = await makeUser(org.id, "manager");
  const coordinator = await makeUser(org.id, "coordinator", [{ department_id: aquatics.id }]);
  const aux = await makeUser(org.id, "aux", [{ facility_id: pool.id }]);
  // The §4 case: a coordinator with NOTHING assigned must reach nothing.
  const stranded = await makeUser(org.id, "coordinator", [], "stranded");

  const asOwner = await signedInAs(owner.email, owner.password);
  const asManager = await signedInAs(manager.email, manager.password);
  const asCoordinator = await signedInAs(coordinator.email, coordinator.password);
  const asAux = await signedInAs(aux.email, aux.password);
  const asStranded = await signedInAs(stranded.email, stranded.password);

  // A write is REFUSED when it changes no rows: RLS filters the UPDATE's own
  // USING clause, so PostgREST returns 0 rows rather than an error.
  const wroteSession = async (client, sessionId, detail) => {
    const { data } = await client
      .from("sessions")
      .update({ location_detail: detail })
      .eq("id", sessionId)
      .select("id");
    return (data ?? []).length > 0;
  };

  // ══ 1. Coordinator: their own department, and nowhere else ═══════════════
  section("Coordinator — department scope (direct PostgREST)");

  check(
    "CAN edit a session in their own department  [positive control]",
    await wroteSession(asCoordinator, sessionA.id, `zz-own-${stamp}`)
  );
  check(
    "CANNOT edit a session in a sibling department",
    !(await wroteSession(asCoordinator, sessionB.id, `zz-sib-${stamp}`))
  );
  check(
    "CANNOT edit a session whose schedule has NO department",
    !(await wroteSession(asCoordinator, sessionC.id, `zz-null-${stamp}`))
  );

  {
    const { data } = await asCoordinator
      .from("schedule_groups")
      .update({ description: `zz-${stamp}` })
      .eq("id", lapSwim.id)
      .select("id");
    check("CAN edit their own schedule group  [positive control]", (data ?? []).length > 0);
  }
  {
    const { data } = await asCoordinator
      .from("schedule_groups")
      .update({ description: `zz-${stamp}` })
      .eq("id", spin.id)
      .select("id");
    check("CANNOT edit a sibling department's schedule group", (data ?? []).length === 0);
  }
  {
    const { error } = await asCoordinator.from("facilities").insert({
      org_id: org.id,
      name: `ZZ Sneaky ${stamp}`,
      slug: `zz-sneaky-${stamp}`,
      address_line1: "1 X",
      city: "V",
      province: "BC",
      postal_code: "V0V 0V0",
    });
    check("CANNOT create a facility", !!error, "insert succeeded");
  }
  {
    const { error } = await asCoordinator.from("departments").insert({
      org_id: org.id,
      facility_id: pool.id,
      name: `ZZ New ${stamp}`,
      slug: `zz-new-${stamp}`,
    });
    check("CANNOT create a department", !!error, "insert succeeded");
  }
  {
    const { data } = await asCoordinator
      .from("widget_configs")
      .update({ primary_color: "#123456" })
      .eq("org_id", org.id)
      .select("org_id");
    check("CANNOT edit the org's widget config", (data ?? []).length === 0);
  }

  // ══ 2. The fail-closed rule (§4) ═════════════════════════════════════════
  section("Coordinator with ZERO scopes — empty grants nothing");

  check(
    "CANNOT edit any session at all",
    !(await wroteSession(asStranded, sessionA.id, `zz-str-${stamp}`)) &&
      !(await wroteSession(asStranded, sessionB.id, `zz-str-${stamp}`))
  );
  {
    // The control that proves the check above is not passing for some
    // unrelated reason: this user CAN still read, so they are really signed in.
    const { data } = await asStranded.from("sessions").select("id").eq("id", sessionA.id);
    check("…but is genuinely signed in and can still read  [positive control]", (data ?? []).length === 1);
  }

  // ══ 3. Aux staff: read the internal schedule, write nothing ══════════════
  section("Aux staff — read-only, facility-scoped");

  {
    const { data } = await asAux.from("sessions").select("id").eq("id", sessionA.id);
    check("CAN read their facility's internal schedule  [positive control]", (data ?? []).length === 1);
  }
  check(
    "CANNOT edit a session — the hole migration 024 left open",
    !(await wroteSession(asAux, sessionA.id, `zz-aux-${stamp}`))
  );
  {
    const { data } = await asAux.from("sessions").delete().eq("id", sessionA.id).select("id");
    check("CANNOT delete a session", (data ?? []).length === 0);
  }
  {
    const { error } = await asAux.from("sessions").insert({
      org_id: org.id,
      schedule_group_id: lapSwim.id,
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      dtstart: "2026-01-06T06:00:00Z",
      dtend_time: "07:00",
      valid_from: "2026-01-01",
    });
    check("CANNOT create a session", !!error, "insert succeeded");
  }
  {
    const { data } = await asAux
      .from("session_exceptions")
      .insert({
        session_id: sessionA.id,
        org_id: org.id,
        exception_date: "2026-01-12",
        exception_type: "cancelled",
      })
      .select("id");
    check("CANNOT cancel an occurrence", (data ?? []).length === 0);
  }
  {
    const { data } = await asAux
      .from("schedule_week_reviews")
      .insert({
        org_id: org.id,
        schedule_group_id: lapSwim.id,
        week_start: "2026-01-05",
        status: "approved",
      })
      .select("id");
    check("CANNOT approve a week", (data ?? []).length === 0);
  }

  section("Aux staff — session_internal is facility-scoped (rental PII)");
  {
    const { data } = await asAux
      .from("session_internal")
      .select("session_id")
      .eq("session_id", sessionA.id);
    check("CAN read their own facility's rental holder  [positive control]", (data ?? []).length === 1);
  }
  {
    const { data } = await asAux
      .from("session_internal")
      .select("session_id")
      .eq("session_id", sessionC.id);
    check("CANNOT read another facility's rental holder", (data ?? []).length === 0);
  }

  // ══ 4. Manager vs Owner ══════════════════════════════════════════════════
  section("Manager — everything operational, none of the four owner powers");

  check(
    "CAN edit a session in ANY department  [positive control]",
    (await wroteSession(asManager, sessionB.id, `zz-mgr-${stamp}`)) &&
      (await wroteSession(asManager, sessionC.id, `zz-mgr-${stamp}`))
  );
  {
    const { data } = await asManager
      .from("org_memberships")
      .delete()
      .eq("id", owner.membershipId)
      .select("id");
    check("CANNOT remove the owner", (data ?? []).length === 0);
  }
  {
    const { data } = await asManager
      .from("org_memberships")
      .update({ role: "aux" })
      .eq("id", owner.membershipId)
      .select("id");
    check("CANNOT demote the owner", (data ?? []).length === 0);
  }
  {
    const { data } = await asManager
      .from("org_memberships")
      .delete()
      .eq("id", coordinator.membershipId)
      .select("id");
    // Managers CAN prune peers and juniors — the ratchet argument in §2.
    check("CAN remove a coordinator  [positive control]", (data ?? []).length === 1);
    // Put it back; later assertions still need this membership.
    await admin
      .from("org_memberships")
      .insert({
        id: coordinator.membershipId,
        org_id: org.id,
        user_id: coordinator.userId,
        role: "coordinator",
        email: coordinator.email,
      });
    await admin
      .from("membership_scopes")
      .insert({ membership_id: coordinator.membershipId, org_id: org.id, department_id: aquatics.id });
  }

  section("Nobody edits their own row");
  {
    const { data } = await asManager
      .from("org_memberships")
      .update({ role: "owner" })
      .eq("id", manager.membershipId)
      .select("id");
    check("Manager CANNOT promote themselves to owner", (data ?? []).length === 0);
  }
  {
    const { data } = await asCoordinator
      .from("membership_scopes")
      .insert({
        membership_id: coordinator.membershipId,
        org_id: org.id,
        department_id: fitness.id,
      })
      .select("id");
    check("Coordinator CANNOT widen their own scope", (data ?? []).length === 0);
  }

  // ══ 5. Invitations ═══════════════════════════════════════════════════════
  section("Invitations — migration 023's finding stays closed");

  const { data: inv } = await admin
    .from("staff_invitations")
    .insert({
      org_id: org.id,
      email: `zz-invitee-${stamp}@example.invalid`,
      role: "aux",
      invited_by: owner.userId,
    })
    .select("id, token")
    .single();
  await admin
    .from("invitation_scopes")
    .insert({ invitation_id: inv.id, org_id: org.id, facility_id: pool.id });

  {
    const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
    const { data } = await anon.from("staff_invitations").select("id, token, email");
    check(
      "anon reading staff_invitations directly gets NOTHING",
      (data ?? []).length === 0,
      `${(data ?? []).length} rows leaked`
    );
  }
  {
    // The positive control for the assertion above: the row definitely exists,
    // so "0 rows" is the policy working and not an empty table.
    const { data } = await admin.from("staff_invitations").select("id").eq("id", inv.id);
    check("…and the invitation really does exist  [positive control]", (data ?? []).length === 1);
  }
  {
    const res = await fetch(`${APP}/api/invitations/${inv.token}`);
    const body = await res.json().catch(() => ({}));
    check("GET /api/invitations/[token] returns the invitation", res.ok, `${res.status}`);
    check(
      "…and leaks neither the token nor the full email",
      !JSON.stringify(body).includes(inv.token) &&
        !JSON.stringify(body).includes(`zz-invitee-${stamp}@example.invalid`)
    );
  }
  {
    const res = await fetch(`${APP}/api/invitations/definitely-not-a-real-token`);
    check("a bogus token answers 404", res.status === 404, `${res.status}`);
  }

  section("Accepting — the email must match");
  {
    // Signed in as the WRONG person: a forwarded link must not work.
    const { error } = await asManager.rpc("accept_invitation", { p_token: inv.token });
    check("wrong address is refused", !!error, "accepted anyway");
  }

  const invitee = {
    email: `zz-invitee-${stamp}@example.invalid`,
    password: `Zk!${stamp}aA9`,
  };
  const { data: iu } = await admin.auth.admin.createUser({
    email: invitee.email,
    password: invitee.password,
    email_confirm: true,
  });
  ids.users.push(iu.user.id);
  const asInvitee = await signedInAs(invitee.email, invitee.password);

  {
    const { error } = await asInvitee.rpc("accept_invitation", { p_token: inv.token });
    check("the right address is accepted  [positive control]", !error, error?.message);
  }
  {
    const { data: m } = await admin
      .from("org_memberships")
      .select("role, email, membership_scopes(facility_id)")
      .eq("org_id", org.id)
      .eq("user_id", iu.user.id)
      .single();
    check("…landing the invited ROLE", m?.role === "aux", m?.role);
    check("…the email snapshot", m?.email === invitee.email, m?.email);
    check(
      "…and the invited SCOPE, copied across",
      (m?.membership_scopes ?? []).length === 1 &&
        m.membership_scopes[0].facility_id === pool.id
    );
  }
  {
    const { error } = await asInvitee.rpc("accept_invitation", { p_token: inv.token });
    check("a token cannot be redeemed twice", !!error, "accepted twice");
  }

  section("Expired invitations");
  {
    const { data: old } = await admin
      .from("staff_invitations")
      .insert({
        org_id: org.id,
        email: `zz-late-${stamp}@example.invalid`,
        role: "aux",
        invited_by: owner.userId,
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .select("token")
      .single();

    const { data } = await admin.rpc("invitation_by_token", { p_token: old.token });
    check("an expired token resolves to nothing", (data ?? []).length === 0);
  }

  // ══ 6. Ownership transfer ════════════════════════════════════════════════
  section("Ownership transfer");
  {
    const { error } = await asManager.rpc("transfer_ownership", {
      p_org_id: org.id,
      p_new_owner_id: manager.userId,
    });
    check("a manager cannot transfer ownership to themselves", !!error, "transfer succeeded");
  }
  {
    const { error } = await asOwner.rpc("transfer_ownership", {
      p_org_id: org.id,
      p_new_owner_id: manager.userId,
    });
    check("the owner can transfer it  [positive control]", !error, error?.message);
  }
  {
    const { data: rows } = await admin
      .from("org_memberships")
      .select("user_id, role")
      .eq("org_id", org.id)
      .in("user_id", [owner.userId, manager.userId]);
    const byUser = Object.fromEntries((rows ?? []).map((r) => [r.user_id, r.role]));
    check("…the recipient is now owner", byUser[manager.userId] === "owner");
    check("…the old owner is now manager", byUser[owner.userId] === "manager");
    const owners = (rows ?? []).filter((r) => r.role === "owner").length;
    check("…exactly one owner, never two", owners === 1, `${owners} owners`);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("\nHARNESS ERROR:", e.message);
  })
  .finally(async () => {
    // Teardown. Orgs cascade to everything; auth users are separate.
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
