/**
 * Facility status notices — migration 060.
 *
 * The claims under test, in the order a reviewer would doubt them:
 *
 *   1. **The public gate is the policy, not a filter in the query.** An
 *      unpublished notice, one whose window has closed, one whose window has
 *      not opened, and one on an unpublished facility are each invisible to a
 *      client that has never signed in — and a live one IS visible. Without
 *      that last assertion the other four pass just as well against a table
 *      nobody can read at all, which is the false green this repo has produced
 *      twice.
 *
 *   2. **`organizations.aux_can_post_notices` actually decides.** The same aux
 *      staffer, the same facility, the same payload: refused with the flag off,
 *      accepted with it on. One fixture, one variable.
 *
 *   3. **Scope still binds.** A coordinator and an aux staffer are both refused
 *      a facility outside their scope, with the flag ON — so the flag cannot be
 *      read as "aux may post anywhere".
 *
 *   4. **Clearing is not deleting.** PATCHing `ends_at` takes the notice off
 *      the public page and leaves the row where staff can still read it.
 *
 *   5. **A space must belong to the facility.** The database cannot express it
 *      (`space_id` references `spaces`, not "spaces here"), so the route must.
 *
 *   6. **The cache tag expires.** Posting a notice makes it appear on the built
 *      facility page. See the note on --app below: judge this on a PRODUCTION
 *      build, never on `next dev`.
 *
 * Two of these are asserted in both directions on purpose. Sections marked
 * FALSIFY in the source say what to break to watch them go red.
 *
 * Section 0 imports the app's real TypeScript modules, so the harness needs
 * `--experimental-strip-types` either way.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-az.mjs
 *   node --experimental-strip-types scripts/verify/verify-az.mjs --logic-only   # section 0 alone: no DB, no server
 *
 * `--app=` for a production build, which section 6 needs to mean anything:
 * `next dev` serves a cached segment for minutes regardless of a
 * `revalidateTag`, so a red there is the dev server and not the tag.
 *
 *   NEXT_DIST_DIR=.next-verify npx next build && NEXT_DIST_DIR=.next-verify npx next start -p 3001
 *   node scripts/verify/verify-az.mjs --app=http://localhost:3001
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const LOGIC_ONLY = process.argv.includes("--logic-only");

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

// ── Section 0: the predicates, with no database and no server ───────────────
//
// `isNoticeLive` is the JavaScript half of 060's read policy, and the two have
// to agree: the staff page decides what goes in "Live now" with this, while
// the public page gets whatever the policy hands it. A drift between them
// shows up as a notice staff cannot see but patrons can, which is the worst
// direction for it to fail in.
async function logicSection() {
  console.log("\n0. The live-window predicate (no database, no server)");

  const { isNoticeLive, isNoticeScheduled, isNoticeFinished, sortNotices, describeNoticeWindow } =
    await import("../../src/lib/status/notices.ts");
  const { NOTICE_PRESETS } = await import("../../src/lib/status/notice-presets.ts");

  const at = (offsetMinutes) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();
  const now = new Date();
  const notice = (over) => ({ is_published: true, starts_at: at(-60), ends_at: null, ...over });

  check("a published, open-ended notice that started an hour ago is live", isNoticeLive(notice(), now));
  check("an unpublished one is not", !isNoticeLive(notice({ is_published: false }), now));
  check("one starting in an hour is not live", !isNoticeLive(notice({ starts_at: at(60) }), now));
  check("...but it is scheduled", isNoticeScheduled(notice({ starts_at: at(60) }), now));
  check("one that ended a minute ago is not live", !isNoticeLive(notice({ ends_at: at(-1) }), now));
  check("...and it is finished", isNoticeFinished(notice({ ends_at: at(-1) }), now));
  check("one ending in an hour is still live", isNoticeLive(notice({ ends_at: at(60) }), now));

  // The boundary both ways. 060 uses `ends_at > NOW()`, so a notice ending at
  // exactly now is over — half-open, like every other interval in this app.
  const edge = new Date();
  check(
    "ends_at exactly now means finished, not live",
    !isNoticeLive({ is_published: true, starts_at: at(-60), ends_at: edge.toISOString() }, edge)
  );
  check(
    "starts_at exactly now means live, not scheduled",
    isNoticeLive({ is_published: true, starts_at: edge.toISOString(), ends_at: null }, edge)
  );

  // Ordering: worst first, whatever the clock says. The fixture deliberately
  // puts the NEWEST notice at the LOWEST severity, so a sort that only looked
  // at time would reverse it.
  const sorted = sortNotices([
    { id: "info-new", severity: "info", starts_at: at(-1) },
    { id: "closure-old", severity: "closure", starts_at: at(-600) },
    { id: "caution-mid", severity: "caution", starts_at: at(-300) },
  ]);
  check(
    "a closure sorts above a newer advisory",
    sorted.map((n) => n.id).join(",") === "closure-old,caution-mid,info-new",
    sorted.map((n) => n.id).join(",")
  );

  // FALSIFY: return the input array from sortNotices and this goes red.
  const input = [{ id: "a", severity: "info", starts_at: at(-1) }];
  check("sortNotices does not mutate its input", sortNotices(input) !== input);

  check(
    "a window with no end says when it started, never a duration",
    /^Since /.test(describeNoticeWindow({ starts_at: at(-30), ends_at: null }, now))
  );
  check(
    "a window with an end says when it ends",
    /^Until /.test(describeNoticeWindow({ starts_at: at(-30), ends_at: at(90) }, now))
  );

  // The presets are vocabulary that ships to patrons; two properties of the
  // whole catalogue are worth holding.
  check(
    "every preset headline fits the CHECK constraint",
    NOTICE_PRESETS.every((p) => p.headline.length <= 120)
  );
  check(
    "no preset promises a reopening time",
    !NOTICE_PRESETS.some((p) => /reopen(s|ing)? (at|by)|back (at|by) \d/i.test(p.body)),
    NOTICE_PRESETS.filter((p) => /reopen(s|ing)? (at|by)/i.test(p.body)).map((p) => p.id).join(",")
  );
  check(
    "preset ids are unique",
    new Set(NOTICE_PRESETS.map((p) => p.id)).size === NOTICE_PRESETS.length
  );
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
/**
 * A second anonymous client that is NEVER signed in.
 *
 * `anon` above is used to mint session cookies, and after
 * `signInWithPassword` it answers every read as that member — so a policy test
 * run through it reports "the public can see this" for rows only a member can.
 * That mistake produced two false reds in verify-at; this client exists so it
 * cannot happen here. Nothing may ever call `.auth` on it.
 */
const publicAnon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

function cookieHeaderFor(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE_NAME}=${value}`;
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    parts.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  }
  return parts.join("; ");
}

async function api(pathname, cookie, init = {}) {
  const res = await fetch(`${APP}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };
const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

/** Sign a fixture user in and return the Cookie header for HTTP calls. */
async function signIn(email, password) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return cookieHeaderFor(data.session);
}

async function makeUser(orgId, role, label, scopeFacilityId = null) {
  const email = `zz-az-${label}-${stamp}@example.invalid`;
  const password = `Zz!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  ids.users.push(data.user.id);

  const { data: membership, error: mErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgId, user_id: data.user.id, role })
    .select("id")
    .single();
  // Read the error. A membership insert that fails silently makes every later
  // request 403 "No organization found", which reads like a product bug — the
  // exact fixture trap scripts/verify/README.md rule 5 describes.
  if (mErr) throw new Error(`membership ${label} (${role}): ${mErr.message}`);

  if (scopeFacilityId) {
    const { error: sErr } = await admin
      .from("membership_scopes")
      .insert({ membership_id: membership.id, org_id: orgId, facility_id: scopeFacilityId });
    if (sErr) throw new Error(`scope ${label}: ${sErr.message}`);
  }

  return { userId: data.user.id, email, password, cookie: await signIn(email, password) };
}

async function main() {
  await logicSection();

  const { error: probe } = await admin.from("facility_notices").select("id").limit(1);
  if (probe) {
    console.log("\n  migration 060: NOT applied — everything below needs the table. Apply it and re-run.");
    skipped("sections 1-7", "migration 060 not applied");
    return;
  }
  console.log("\n  migration 060: applied");

  // ── The org, two facilities, one space ────────────────────────────────────
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ status ${stamp}`, slug: `zz-status-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.orgs.push(org.id);

  const mkFacility = async (name, published) =>
    (
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name: `ZZ ${name} ${stamp}`,
          slug: `zz-${name}-${stamp}`,
          address_line1: "1 Test St",
          city: "Victoria",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: published,
        })
        .select("id, slug")
        .single()
    ).data;

  const pool = await mkFacility("pool", true);
  // A second building, published, so the "outside your scope" refusals cannot
  // pass merely because the facility is unreachable.
  const arena = await mkFacility("arena", true);
  // A third, unpublished — the fourth way a notice must stay off the public page.
  const draftSite = await mkFacility("draftsite", false);

  const { data: lane } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: pool.id,
      name: `ZZ Lane 1 ${stamp}`,
      slug: `zz-lane-1-${stamp}`,
      is_published: true,
    })
    .select("id, name")
    .single();

  // A space at the OTHER building, for the cross-facility check in section 5.
  const { data: arenaIce } = await admin
    .from("spaces")
    .insert({
      org_id: org.id,
      facility_id: arena.id,
      name: `ZZ Ice ${stamp}`,
      slug: `zz-ice-${stamp}`,
      is_published: true,
    })
    .select("id")
    .single();

  const owner = await makeUser(org.id, "owner", "owner");
  const guard = await makeUser(org.id, "aux", "guard", pool.id);
  const coord = await makeUser(org.id, "coordinator", "coord", pool.id);

  const noticesPath = (facilityId) => `/api/facilities/${facilityId}/notices`;
  const payload = (over = {}) => ({
    category: "water_quality",
    severity: "closure",
    headline: `ZZ Pool closed ${stamp}`,
    body: "The pool is closed while staff treat the water.",
    is_published: true,
    ...over,
  });

  // ── 1. The owner can post, and the public sees it ─────────────────────────
  console.log("\n1. Posting, and what the public gets");

  const created = await api(noticesPath(pool.id), owner.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ space_id: lane.id })),
  });
  check("an owner can post a notice", created.status === 201, `${created.status} ${JSON.stringify(created.body)}`);
  const liveNotice = created.body.notice;

  // THE POSITIVE CONTROL. Every "invisible to the public" assertion below is
  // worthless without this one: four zero-row reads prove nothing if the
  // policy denies everything.
  const { data: publicRows } = await publicAnon
    .from("facility_notices")
    .select("id, headline")
    .eq("facility_id", pool.id);
  check(
    "a never-signed-in client CAN see the live notice (positive control)",
    (publicRows ?? []).some((n) => n.id === liveNotice?.id),
    `saw ${(publicRows ?? []).length} rows`
  );

  // ── 2. The four ways a notice stays off the public page ───────────────────
  console.log("\n2. The public gate");

  const hidden = {};
  for (const [label, over, facilityId] of [
    ["unpublished", { is_published: false, headline: `ZZ draft ${stamp}` }, pool.id],
    ["already finished", { starts_at: at(-120), ends_at: at(-60), headline: `ZZ over ${stamp}` }, pool.id],
    ["not started yet", { starts_at: at(60), headline: `ZZ later ${stamp}` }, pool.id],
    ["on an unpublished facility", { headline: `ZZ hidden site ${stamp}` }, draftSite.id],
  ]) {
    const res = await api(noticesPath(facilityId), owner.cookie, {
      method: "POST",
      body: JSON.stringify(payload(over)),
    });
    if (res.status !== 201) {
      check(`fixture: a ${label} notice was created`, false, `${res.status} ${JSON.stringify(res.body)}`);
      continue;
    }
    hidden[label] = res.body.notice;
  }

  const { data: allPublic } = await publicAnon
    .from("facility_notices")
    .select("id")
    .in("facility_id", [pool.id, draftSite.id]);
  const publicIds = new Set((allPublic ?? []).map((n) => n.id));

  for (const label of Object.keys(hidden)) {
    // FALSIFY: drop the matching clause from facility_notices_read and the
    // corresponding line goes red.
    check(`a ${label} notice is invisible to the public`, !publicIds.has(hidden[label].id));
  }
  check(
    "...while the live one still is (the control, re-asserted after four inserts)",
    publicIds.has(liveNotice.id)
  );

  // Staff see all of them. Without this, "invisible to the public" could be
  // "invisible to everyone", which is a different bug wearing the same result.
  const { data: staffRows } = await api(noticesPath(pool.id), owner.cookie).then((r) => ({
    data: r.body.notices,
  }));
  check(
    "staff see the drafts and the finished ones too",
    ["unpublished", "already finished", "not started yet"].every((k) =>
      (staffRows ?? []).some((n) => n.id === hidden[k]?.id)
    ),
    `${staffRows?.length ?? 0} rows`
  );

  // ── 3. The org switch, one variable at a time ─────────────────────────────
  console.log("\n3. aux_can_post_notices");

  const auxPost = () =>
    api(noticesPath(pool.id), guard.cookie, {
      method: "POST",
      body: JSON.stringify(payload({ headline: `ZZ guard ${stamp}` })),
    });

  await admin.from("organizations").update({ aux_can_post_notices: false }).eq("id", org.id);
  const refused = await auxPost();
  check("with the flag OFF, an aux staffer is refused", refused.status === 403, `${refused.status}`);
  check(
    "...and the refusal says how to fix it",
    /Organization settings/i.test(refused.body.error ?? ""),
    refused.body.error
  );

  await admin.from("organizations").update({ aux_can_post_notices: true }).eq("id", org.id);
  const allowed = await auxPost();
  // FALSIFY: make can_write_notice ignore o.aux_can_post_notices and the
  // first of these goes red while this one stays green.
  check(
    "with the flag ON, the same staffer, the same payload, is accepted",
    allowed.status === 201,
    `${allowed.status} ${JSON.stringify(allowed.body)}`
  );

  // The database is the control, not the route. If RLS were the thing
  // refusing, the route's 403 above would be indistinguishable from a policy
  // failure — this asks PostgREST directly, as the guard.
  const guardClient = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  await guardClient.auth.signInWithPassword({ email: guard.email, password: guard.password });
  await admin.from("organizations").update({ aux_can_post_notices: false }).eq("id", org.id);
  const { error: rlsRefusal } = await guardClient.from("facility_notices").insert({
    org_id: org.id,
    facility_id: pool.id,
    category: "staffing",
    severity: "closure",
    headline: `ZZ direct ${stamp}`,
  });
  check("RLS refuses the same insert made directly to PostgREST", !!rlsRefusal, "insert succeeded");
  await admin.from("organizations").update({ aux_can_post_notices: true }).eq("id", org.id);
  const { error: rlsAllowed } = await guardClient.from("facility_notices").insert({
    org_id: org.id,
    facility_id: pool.id,
    category: "staffing",
    severity: "closure",
    headline: `ZZ direct ok ${stamp}`,
  });
  check("...and accepts it once the org opts in", !rlsAllowed, rlsAllowed?.message);

  // ── 4. Scope still binds, with the flag on ────────────────────────────────
  console.log("\n4. Facility scope");

  const guardElsewhere = await api(noticesPath(arena.id), guard.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ wrong building ${stamp}` })),
  });
  check(
    "an aux staffer is refused a facility outside their scope, flag on",
    guardElsewhere.status === 403,
    `${guardElsewhere.status}`
  );

  const coordHere = await api(noticesPath(pool.id), coord.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ coord ${stamp}`, severity: "caution" })),
  });
  check("a coordinator can post at a facility in scope", coordHere.status === 201, `${coordHere.status}`);

  const coordElsewhere = await api(noticesPath(arena.id), coord.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ coord wrong ${stamp}` })),
  });
  check(
    "...and refused one outside it",
    coordElsewhere.status === 403,
    `${coordElsewhere.status}`
  );

  // ── 5. A space must be at this facility ───────────────────────────────────
  console.log("\n5. Cross-facility space");

  const wrongSpace = await api(noticesPath(pool.id), owner.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ wrong space ${stamp}`, space_id: arenaIce.id })),
  });
  check(
    "a notice cannot name a space at another building",
    wrongSpace.status === 400,
    `${wrongSpace.status} ${JSON.stringify(wrongSpace.body)}`
  );
  // The control: the same call with the right space is fine, so the 400 above
  // is about the facility and not about `space_id` being rejected wholesale.
  const rightSpace = await api(noticesPath(pool.id), owner.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ right space ${stamp}`, space_id: lane.id })),
  });
  check("...but it can name one of its own", rightSpace.status === 201, `${rightSpace.status}`);

  // ── 6. Clearing is not deleting ───────────────────────────────────────────
  console.log("\n6. Clear vs delete");

  const cleared = await api(`${noticesPath(pool.id)}/${liveNotice.id}`, owner.cookie, {
    method: "PATCH",
    body: JSON.stringify({ ends_at: new Date().toISOString() }),
  });
  check("clearing a notice succeeds", cleared.status === 200, `${cleared.status}`);

  const { data: afterClear } = await publicAnon
    .from("facility_notices")
    .select("id")
    .eq("id", liveNotice.id);
  check("the public no longer sees it", (afterClear ?? []).length === 0);

  const { data: staffAfterClear } = await admin
    .from("facility_notices")
    .select("id, ends_at")
    .eq("id", liveNotice.id)
    .maybeSingle();
  check("the row is still there, with an end time", !!staffAfterClear?.ends_at);

  const deleted = await api(`${noticesPath(pool.id)}/${hidden["unpublished"].id}`, owner.cookie, {
    method: "DELETE",
  });
  check("deleting one succeeds", deleted.status === 204, `${deleted.status}`);
  const { data: afterDelete } = await admin
    .from("facility_notices")
    .select("id")
    .eq("id", hidden["unpublished"].id)
    .maybeSingle();
  check("...and the row is gone", afterDelete === null);

  // A window that ends before it starts is refused by the CHECK, not by luck.
  const backwards = await api(noticesPath(pool.id), owner.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ backwards ${stamp}`, starts_at: at(60), ends_at: at(30) })),
  });
  check("a window that ends before it starts is refused", backwards.status === 400, `${backwards.status}`);

  // ── 7. It reaches the page ────────────────────────────────────────────────
  console.log("\n7. The public facility page");

  const fresh = await api(noticesPath(pool.id), owner.cookie, {
    method: "POST",
    body: JSON.stringify(payload({ headline: `ZZ ON THE PAGE ${stamp}` })),
  });
  check("fixture: a fresh live notice exists", fresh.status === 201, `${fresh.status}`);

  const pageRes = await fetch(`${APP}/facility/${pool.slug}`);
  const html = await pageRes.text();
  check("the facility page renders", pageRes.status === 200, `${pageRes.status}`);
  check(
    "the notice is in the SERVER-RENDERED html",
    html.includes(`ZZ ON THE PAGE ${stamp}`),
    "not found — on `next dev` this is the cached segment, not the tag; re-run with --app against a production build"
  );
  check(
    "a draft notice is not",
    !html.includes(`ZZ later ${stamp}`)
  );

  const widgetRes = await fetch(`${APP}/widget/${org.id}?facilityId=${pool.id}`);
  const widgetHtml = await widgetRes.text();
  check(
    "the widget carries it too",
    widgetHtml.includes(`ZZ ON THE PAGE ${stamp}`),
    `widget status ${widgetRes.status}`
  );
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
