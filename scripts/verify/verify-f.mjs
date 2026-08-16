/**
 * Recurrence/conflict correctness verification.
 *
 * Same pattern as verify-b/c/d/e: service-role fixtures (org, user,
 * membership, facility, space, schedule group — none of these are the thing
 * under test), a genuinely signed-in user driving the real HTTP routes over
 * cookies, everything torn down in a finally.
 *
 * The mechanism under test is src/lib/rrule/expand.ts via two real callers:
 * POST /api/sessions (findSessionConflict) and GET /api/sessions/expand
 * (the same expansion the public schedule page and dashboard grid render).
 *
 * `dtstart` holds local wall-clock digits directly, with no real instant
 * meaning and no timezone column to convert through (see
 * dropin/docs/RESUME-timezone-removal.md) — every dtstart below is a literal
 * "Z"-suffixed digit string, not a real-instant conversion of some local
 * time. Section 3 is a direct regression test for the pre-removal "evening
 * session lands on the day before" bug class: it now asserts there is no
 * conversion at all, rather than that a conversion was done correctly.
 * Every assertion here has a positive control alongside it — a conflict
 * check that never fires isn't proof a false positive is gone, it might
 * just be broken.
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
  // ------------------------------------------------------------- fixtures
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-f ${stamp}`, slug: `zz-verify-f-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-f-${stamp}@example.invalid`;
  const password = `Zf!${stamp}aA9`;
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
        name: "ZZ Verify Pool",
        slug: `zz-verify-pool-${stamp}`,
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
      .insert({ org_id: org.id, facility_id: facility.id, name: "Test Pool", slug: `test-pool-${stamp}` })
      .select("id")
      .single()
  ).data;

  // A second, isolated space for section 2 — section 1 deliberately leaves a
  // 9:00-11:00am session behind in `space`, which section 2's 9:15am-12:00pm
  // touching-boundary case would otherwise (correctly) conflict with.
  const space2 = (
    await admin
      .from("spaces")
      .insert({ org_id: org.id, facility_id: facility.id, name: "Test Pool 2", slug: `test-pool-2-${stamp}` })
      .select("id")
      .single()
  ).data;

  const scheduleGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Verify Schedule",
        slug: `zz-verify-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  // ------------------------------------------------------- test payloads
  // All sessions: weekly Monday, starting 2026-08-10 (a real Monday), no
  // valid_until — the open-ended case that walks the full 2-year lookahead
  // in findSessionConflict. dtstart digits are literal local wall-clock time
  // (see the header comment) — "09:00" below means 9am at the facility,
  // full stop, not a UTC offset to be reasoned about.
  const base = {
    schedule_group_id: scheduleGroup.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    valid_from: "2026-08-10",
    valid_until: null,
  };

  async function createSession(overrides) {
    return api("/api/sessions", cookie, {
      method: "POST",
      body: JSON.stringify({ ...base, space_ids: [space.id], ...overrides }),
    });
  }

  console.log("\n1. Positive control — genuinely overlapping sessions still conflict");
  const morningA = await createSession({
    dtstart: "2026-08-10T09:00:00Z",
    dtend_time: "11:00",
  });
  check("first session creates (201/200)", morningA.status < 300, JSON.stringify(morningA.body));

  const morningOverlap = await createSession({
    dtstart: "2026-08-10T10:00:00Z", // overlaps the above
    dtend_time: "12:00",
  });
  check("genuinely overlapping session is rejected with 409", morningOverlap.status === 409, JSON.stringify(morningOverlap.body));

  console.log("\n2. Touching-boundary sessions, recurring over the full 2-year lookahead, do not conflict");
  const block1 = await createSession({
    dtstart: "2026-08-10T09:15:00Z",
    dtend_time: "12:00",
    space_ids: [space2.id],
  });
  check("block1 (9:15am-12:00pm) creates", block1.status < 300, JSON.stringify(block1.body));

  const block2 = await createSession({
    dtstart: "2026-08-10T12:00:00Z", // touches block1's end exactly
    dtend_time: "13:00",
    space_ids: [space2.id],
  });
  check(
    "block2 (12:00pm-1:00pm, touches block1's end) is accepted",
    block2.status < 300,
    JSON.stringify(block2.body)
  );

  console.log("\n3. An evening session's occurrence has byte-identical digits to what was submitted — no conversion happens");
  const evening = await createSession({
    dtstart: "2026-08-10T20:00:00Z", // 8pm Monday
    dtend_time: "22:00",
    space_ids: [], // isolate from the conflict check entirely for this assertion
  });
  check("evening session creates", evening.status < 300, JSON.stringify(evening.body));

  const expandRes = await api(
    `/api/sessions/expand?facilityId=${facility.id}&rangeStart=2026-08-10T00:00:00.000Z&rangeEnd=2026-08-17T00:00:00.000Z`,
    cookie
  );
  const eveningOccurrence = (expandRes.body.data ?? []).find((s) => s.sessionId === evening.body.sessionId);
  check("evening session has an occurrence in the queried week", !!eveningOccurrence, JSON.stringify(expandRes.body));
  if (eveningOccurrence) {
    check(
      `evening occurrence's digits are byte-identical to the submitted dtstart (got ${eveningOccurrence.start})`,
      eveningOccurrence.start === "2026-08-10T20:00:00.000Z"
    );
  }

  console.log("\n4. A session attached to an unpublished space doesn't crash the public schedule");
  // A space still in Draft, on an otherwise-published schedule — the exact
  // shape that 500'd in production: RLS nulls the embedded `spaces` object
  // for an anonymous read, and expandSessions() used to sort that null.
  const draftSpace = (
    await admin
      .from("spaces")
      .insert({ org_id: org.id, facility_id: facility.id, name: "Draft Space", slug: `draft-space-${stamp}`, is_published: false })
      .select("id")
      .single()
  ).data;
  await admin
    .from("schedule_groups")
    .update({ status: "published", starts_on: "2026-08-10", ends_on: "2026-12-31" })
    .eq("id", scheduleGroup.id);

  const draftSpaceSession = await createSession({
    dtstart: "2026-08-10T15:00:00.000Z",
    dtend_time: "16:00",
    space_ids: [draftSpace.id],
  });
  check("session on a draft space creates", draftSpaceSession.status < 300, JSON.stringify(draftSpaceSession.body));

  // No cookie — anonymous, the same way the public facility page and widget read.
  const publicExpand = await api(
    `/api/sessions/expand?facilityId=${facility.id}&rangeStart=2026-08-10T00:00:00.000Z&rangeEnd=2026-08-17T00:00:00.000Z`
  );
  check(
    "public (anonymous) expand does not 500",
    publicExpand.status === 200,
    `status=${publicExpand.status} body=${JSON.stringify(publicExpand.body)}`
  );
  const publicOccurrence = (publicExpand.body.data ?? []).find((s) => s.sessionId === draftSpaceSession.body.sessionId);
  check(
    "the session still appears publicly, with the unpublished space silently omitted rather than crashing",
    !!publicOccurrence && Array.isArray(publicOccurrence.spaceIds) && publicOccurrence.spaceIds.length === 0,
    JSON.stringify(publicOccurrence)
  );
} catch (e) {
  console.error("FATAL:", e);
  fail++;
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
