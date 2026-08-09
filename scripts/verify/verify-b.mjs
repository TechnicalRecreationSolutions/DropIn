/**
 * Phase B end-to-end verification harness.
 *
 * Follows the pattern documented in docs/SECURITY.md: a service-role client
 * builds a throwaway org + member user + facility + schedule group + session,
 * the real HTTP routes are driven as that signed-in user over cookies, then
 * everything is deleted in a finally block. Touches no existing org's data.
 *
 * The one rule this repo keeps relearning: an empty result proves nothing.
 * Every assertion below has a positive control.
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

const ids = {};
let cookieHeader = "";

async function api(path, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.anon ? {} : { Cookie: cookieHeader }),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const stamp = Date.now();
const email = `verify-b-${stamp}@example.invalid`;
const password = `Vb!${stamp}aA9`;

try {
  // ---------------------------------------------------------------- setup
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ Verify ${stamp}`, slug: `zz-verify-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.org = org.id;

  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);
  ids.user = user.user.id;

  const { error: memErr } = await admin
    .from("org_memberships")
    .insert({ org_id: ids.org, user_id: ids.user, role: "admin" });
  if (memErr) throw new Error(`membership: ${memErr.message}`);

  const { data: fac, error: facErr } = await admin
    .from("facilities")
    .insert({
      org_id: ids.org,
      name: "ZZ Verify Centre",
      slug: `zz-verify-centre-${stamp}`,
      address_line1: "1 Test St",
      city: "Edmonton",
      province: "AB",
      postal_code: "T0T0T0",
      is_published: true,
    })
    .select("id")
    .single();
  if (facErr) throw new Error(`facility: ${facErr.message}`);
  ids.facility = fac.id;

  const { data: sg, error: sgErr } = await admin
    .from("schedule_groups")
    .insert({
      org_id: ids.org,
      facility_id: ids.facility,
      name: "ZZ Verify Swim",
      slug: `zz-verify-swim-${stamp}`,
      sport_category: "swimming",
      activity_type: "drop_in",
      cost_cents: 0,
      is_published: true,
    })
    .select("id")
    .single();
  if (sgErr) throw new Error(`schedule_group: ${sgErr.message}`);
  ids.scheduleGroup = sg.id;

  // A weekly Wednesday session inside August 2026, and a genuine one-off
  // (FREQ=DAILY;COUNT=1) so B3 and B4/B5 finally meet.
  const { data: sess, error: sessErr } = await admin
    .from("sessions")
    .insert([
      {
        org_id: ids.org,
        schedule_group_id: ids.scheduleGroup,
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        dtstart: "2026-08-05T18:00:00Z",
        dtend_time: "21:00",
        valid_from: "2026-08-01",
        valid_until: "2026-08-31",
        is_active: true,
      },
      {
        org_id: ids.org,
        schedule_group_id: ids.scheduleGroup,
        rrule: "FREQ=DAILY;COUNT=1",
        dtstart: "2026-08-20T18:00:00Z",
        dtend_time: "21:00",
        valid_from: "2026-08-20",
        valid_until: "2026-08-20",
        is_active: true,
      },
    ])
    .select("id");
  if (sessErr) throw new Error(`sessions: ${sessErr.message}`);
  ids.weekly = sess[0].id;
  ids.oneOff = sess[1].id;

  // Sign in as the member and build the cookie the routes read.
  const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  cookieHeader = sessionCookies(signIn.session).join("; ");

  console.log(`\nTemp org ${ids.org} — 2 sessions, signed in as admin member\n`);

  // ------------------------------------------------- 0. positive control
  console.log("0. Positive control — the harness can see its own data");
  const week = await api(
    `/api/sessions/expand?scheduleGroupId=${ids.scheduleGroup}&rangeStart=2026-08-03T00:00:00Z&rangeEnd=2026-08-09T23:59:59Z`
  );
  check("week expand returns 200", week.status === 200, JSON.stringify(week.body).slice(0, 200));
  check(
    "week expand is NOT empty (this is the control)",
    (week.body.data?.length ?? 0) > 0,
    `got ${week.body.data?.length ?? 0}`
  );
  const wed = week.body.data?.[0];
  check("occurrence carries isEvent=false by default", wed?.isEvent === false, String(wed?.isEvent));
  check("occurrence carries feature=null when never featured", wed?.feature === null, JSON.stringify(wed?.feature));

  // ------------------------------------------------- 1. gate starts closed
  console.log("\n1. Widget gate before anything is featured");
  const gate0 = await api("/api/sessions/events");
  check("GET /api/sessions/events → 200", gate0.status === 200);
  check("hasEvents is false", gate0.body.hasEvents === false, JSON.stringify(gate0.body));

  // ------------------------------------------------- 2. feature a session
  console.log("\n2. Feature the one-off (the B3 × B5 crossover)");
  const feat = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({
      session_id: ids.oneOff,
      is_event: true,
      in_brochure: true,
      title: "Halloween Howl",
      summary: "Costumes encouraged",
      description: "A long description that must survive un-featuring.",
      accent_color: "#B4472A",
      link_url: "https://example.com/register",
      link_label: "Register",
      event_category: "Aquatics Feature",
    }),
  });
  check("POST /api/sessions/features → 200", feat.status === 200, JSON.stringify(feat.body));

  const gate1 = await api("/api/sessions/events");
  check("widget gate now open (hasEvents true)", gate1.body.hasEvents === true, JSON.stringify(gate1.body));
  check("gate count is 1", gate1.body.count === 1, String(gate1.body.count));

  // --------------------------------------- 3. it reaches the calendar path
  console.log("\n3. The events calendar fetch (month grid + eventsOnly)");
  const monthAll = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-07-27T00:00:00Z&rangeEnd=2026-09-06T23:59:59Z`
  );
  const monthEvents = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-07-27T00:00:00Z&rangeEnd=2026-09-06T23:59:59Z&eventsOnly=true`
  );
  check("month (all) returns 200", monthAll.status === 200);
  check(
    "month (all) has more than the events-only set",
    monthAll.body.data.length > monthEvents.body.data.length,
    `all=${monthAll.body.data.length} events=${monthEvents.body.data.length}`
  );
  check("eventsOnly returns exactly the 1 flagged occurrence", monthEvents.body.data.length === 1, `got ${monthEvents.body.data.length}`);

  const ev = monthEvents.body.data[0];
  check("occurrence isEvent=true", ev?.isEvent === true);
  check("feature.summary reaches the cell", ev?.feature?.summary === "Costumes encouraged", JSON.stringify(ev?.feature?.summary));
  check("feature.accentColor reaches the chip", ev?.feature?.accentColor === "#B4472A", String(ev?.feature?.accentColor));
  check("feature.title overrides the group name", ev?.feature?.title === "Halloween Howl", String(ev?.feature?.title));
  check("one-off expanded to exactly one occurrence", ev?.start?.startsWith("2026-08-20"), String(ev?.start));

  // ----------------------------------- 4. un-feature keeps the copy (028 #3)
  console.log("\n4. Un-feature — flags clear, copy survives");
  const unfeat = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({
      session_id: ids.oneOff,
      is_event: false,
      in_brochure: false,
      title: "Halloween Howl",
      summary: "Costumes encouraged",
      description: "A long description that must survive un-featuring.",
      accent_color: "#B4472A",
      link_url: "https://example.com/register",
      link_label: "Register",
      event_category: "Aquatics Feature",
    }),
  });
  check("un-feature → 200", unfeat.status === 200, JSON.stringify(unfeat.body));

  const gate2 = await api("/api/sessions/events");
  check("widget gate closes again", gate2.body.hasEvents === false, JSON.stringify(gate2.body));

  const afterEvents = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-07-27T00:00:00Z&rangeEnd=2026-09-06T23:59:59Z&eventsOnly=true`
  );
  check("it leaves the events calendar", afterEvents.body.data.length === 0, `got ${afterEvents.body.data.length}`);

  const { data: kept } = await admin
    .from("session_features")
    .select("title, description, accent_color")
    .eq("session_id", ids.oneOff)
    .maybeSingle();
  check("session_features row still exists", !!kept);
  check("description survived un-featuring", kept?.description?.startsWith("A long description"), JSON.stringify(kept?.description));
  check("accent colour survived", kept?.accent_color === "#B4472A", String(kept?.accent_color));

  const stillThere = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-08-17T00:00:00Z&rangeEnd=2026-08-23T23:59:59Z`
  );
  const unfeatured = stillThere.body.data.find((s) => s.sessionId === ids.oneOff);
  check("session still on the normal schedule", !!unfeatured);
  check("feature payload still readable while un-featured", unfeatured?.feature?.title === "Halloween Howl", JSON.stringify(unfeatured?.feature?.title));

  // ------------------------------------------------------ 5. input guards
  console.log("\n5. Validation and authorization");
  const badLink = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.oneOff, is_event: true, in_brochure: false, link_url: "javascript:alert(1)" }),
  });
  check("javascript: link rejected with 400", badLink.status === 400, `got ${badLink.status}`);

  const badColor = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.oneOff, is_event: true, in_brochure: false, accent_color: "red" }),
  });
  check("non-hex accent rejected with 400", badColor.status === 400, `got ${badColor.status}`);

  const foreign = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: "eaf737e3-73ce-40aa-8af8-064c78ba5054", is_event: true, in_brochure: false }),
  });
  check("another org's session → 404", foreign.status === 404, `got ${foreign.status}`);

  const anonWrite = await api("/api/sessions/features", {
    method: "POST",
    anon: true,
    body: JSON.stringify({ session_id: ids.oneOff, is_event: true, in_brochure: false }),
  });
  check("anonymous write → 401", anonWrite.status === 401, `got ${anonWrite.status}`);

  const anonGate = await api("/api/sessions/events", { anon: true });
  check("anonymous gate read → 401", anonGate.status === 401, `got ${anonGate.status}`);

  // ------------------------------------------------ 6. blank-to-null clearing
  console.log("\n6. Clearing a field");
  await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.oneOff, is_event: true, in_brochure: false, title: "   ", summary: "Kept" }),
  });
  const cleared = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-08-17T00:00:00Z&rangeEnd=2026-08-23T23:59:59Z&eventsOnly=true`
  );
  const c = cleared.body.data[0];
  check("blank title normalized to null", c?.feature?.title === null, JSON.stringify(c?.feature?.title));
  check("so the display name falls back to the group", c?.scheduleGroupName === "ZZ Verify Swim", String(c?.scheduleGroupName));

  // ------------------------------------ 7. partial update / the one-click path
  // The whole point of the endpoint being a PATCH. A one-click toggle sends
  // nothing but the flag; if omitted fields defaulted to null it would erase
  // everything the org wrote, which is the failure this section exists to catch.
  console.log("\n7. One-click toggle must not erase the copy");
  await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({
      session_id: ids.oneOff,
      is_event: false,
      in_brochure: false,
      title: "Halloween Howl",
      summary: "Costumes encouraged",
      description: "Long copy.",
      accent_color: "#B4472A",
      link_url: "https://example.com/register",
      link_label: "Register",
      event_category: "Aquatics Feature",
    }),
  });

  const oneClick = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.oneOff, is_event: true }),
  });
  check("flag-only POST → 200", oneClick.status === 200, JSON.stringify(oneClick.body));
  check("response reports the new flag", oneClick.body.isEvent === true, String(oneClick.body.isEvent));
  check(
    "the untouched flag is reported, not guessed",
    oneClick.body.inBrochure === false,
    String(oneClick.body.inBrochure)
  );

  const { data: survived } = await admin
    .from("session_features")
    .select("title, summary, description, accent_color, link_url, event_category")
    .eq("session_id", ids.oneOff)
    .maybeSingle();
  check("title survived the one-click toggle", survived?.title === "Halloween Howl", JSON.stringify(survived?.title));
  check("summary survived", survived?.summary === "Costumes encouraged", JSON.stringify(survived?.summary));
  check("description survived", survived?.description === "Long copy.", JSON.stringify(survived?.description));
  check("accent survived", survived?.accent_color === "#B4472A", String(survived?.accent_color));
  check("link survived", survived?.link_url === "https://example.com/register", String(survived?.link_url));
  check("category survived", survived?.event_category === "Aquatics Feature", String(survived?.event_category));

  // Explicit null still clears — "absent" and "null" must not collapse.
  await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.oneOff, summary: null }),
  });
  const { data: nulled } = await admin
    .from("session_features")
    .select("summary, title")
    .eq("session_id", ids.oneOff)
    .maybeSingle();
  check("explicit null clears the field", nulled?.summary === null, JSON.stringify(nulled?.summary));
  check("...without touching its neighbours", nulled?.title === "Halloween Howl", JSON.stringify(nulled?.title));

  const empty = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.oneOff }),
  });
  check("a POST that changes nothing → 400", empty.status === 400, `got ${empty.status}`);

  // A content-only save on a session that has never been featured must create
  // the row without turning any flag on by accident.
  const contentOnly = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: ids.weekly, summary: "Just a note" }),
  });
  check("content-only save on an unfeatured session → 200", contentOnly.status === 200, JSON.stringify(contentOnly.body));
  check("...leaves is_event false", contentOnly.body.isEvent === false, String(contentOnly.body.isEvent));
  check("...leaves in_brochure false", contentOnly.body.inBrochure === false, String(contentOnly.body.inBrochure));

  // ------------------------------------------- 8. the SessionForm save path
  // SessionForm chains two requests: POST /api/sessions, then POST
  // /api/sessions/features keyed on the id that came back. That contract only
  // holds if /api/sessions returns sessionId on BOTH create and update — on
  // update it's the branch nobody exercises, and a missing id there would send
  // `session_id: undefined` and 400 with the session already saved.
  console.log("\n8. SessionForm's two-request save");
  const created = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: ids.scheduleGroup,
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      dtstart: "2026-08-07T18:00:00Z",
      dtend_time: "20:00",
      valid_from: "2026-08-01",
      valid_until: "2026-08-31",
      space_ids: [],
    }),
  });
  check("create returns 200", created.status === 200, JSON.stringify(created.body));
  check("create returns a sessionId", !!created.body.sessionId, JSON.stringify(created.body));

  const formFeature = await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({
      session_id: created.body.sessionId,
      is_event: true,
      in_brochure: false,
      summary: "Written from the session form",
    }),
  });
  check("featuring the just-created session → 200", formFeature.status === 200, JSON.stringify(formFeature.body));
  check("and it is flagged", formFeature.body.isEvent === true, String(formFeature.body.isEvent));

  const updated2 = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      sessionId: created.body.sessionId,
      schedule_group_id: ids.scheduleGroup,
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      dtstart: "2026-08-07T19:00:00Z",
      dtend_time: "21:00",
      valid_from: "2026-08-01",
      valid_until: "2026-08-31",
      space_ids: [],
    }),
  });
  check("update returns a sessionId too", updated2.body.sessionId === created.body.sessionId, JSON.stringify(updated2.body));

  // Editing time must not disturb featuring — /api/sessions doesn't know about
  // these columns, and the form's second request only fires when they changed.
  const { data: afterEdit } = await admin
    .from("sessions")
    .select("is_event")
    .eq("id", created.body.sessionId)
    .single();
  const { data: afterEditFeature } = await admin
    .from("session_features")
    .select("summary")
    .eq("session_id", created.body.sessionId)
    .maybeSingle();
  check("editing the session left is_event alone", afterEdit?.is_event === true, String(afterEdit?.is_event));
  check("editing the session left the summary alone", afterEditFeature?.summary === "Written from the session form", JSON.stringify(afterEditFeature?.summary));

  // -------------------------------------- 9. the Events workspace tab is org-wide
  // The tab exists because the command centre's scope is always ONE facility,
  // so its scoped events layout structurally cannot show the org-wide sheet.
  // Prove that with a second building: the org-wide fetch must see both, the
  // facility-scoped fetch only one. Without a second facility this assertion
  // would pass vacuously.
  console.log("\n9. Events tab spans facilities; the scoped view does not");
  const { data: fac2 } = await admin
    .from("facilities")
    .insert({
      org_id: ids.org,
      name: "ZZ Verify Arena",
      slug: `zz-verify-arena-${stamp}`,
      address_line1: "2 Test St",
      city: "Edmonton",
      province: "AB",
      postal_code: "T0T0T0",
      is_published: true,
    })
    .select("id")
    .single();
  ids.facility2 = fac2.id;

  const { data: sg2 } = await admin
    .from("schedule_groups")
    .insert({
      org_id: ids.org,
      facility_id: ids.facility2,
      name: "ZZ Verify Skate",
      slug: `zz-verify-skate-${stamp}`,
      sport_category: "skating",
      activity_type: "drop_in",
      cost_cents: 0,
      is_published: true,
    })
    .select("id")
    .single();

  const { data: sess2 } = await admin
    .from("sessions")
    .insert({
      org_id: ids.org,
      schedule_group_id: sg2.id,
      rrule: "FREQ=DAILY;COUNT=1",
      dtstart: "2026-08-21T18:00:00Z",
      dtend_time: "20:00",
      valid_from: "2026-08-21",
      valid_until: "2026-08-21",
      is_active: true,
      is_event: true,
    })
    .select("id")
    .single();
  ids.session2 = sess2.id;

  const RANGE = "rangeStart=2026-07-27T00:00:00Z&rangeEnd=2026-09-06T23:59:59Z&eventsOnly=true";
  const orgWide = await api(`/api/sessions/expand?orgId=${ids.org}&${RANGE}`);
  const scoped = await api(`/api/sessions/expand?facilityId=${ids.facility}&${RANGE}`);

  const orgFacilities = new Set(orgWide.body.data.map((s) => s.facilityId));
  const scopedFacilities = new Set(scoped.body.data.map((s) => s.facilityId));

  check("org-wide fetch returns 200", orgWide.status === 200, JSON.stringify(orgWide.body).slice(0, 200));
  check("org-wide spans both buildings", orgFacilities.size === 2, `saw ${orgFacilities.size}`);
  check("scoped fetch sees only its own", scopedFacilities.size === 1, `saw ${scopedFacilities.size}`);
  check(
    "org-wide strictly contains the scoped set",
    orgWide.body.data.length > scoped.body.data.length,
    `org=${orgWide.body.data.length} scoped=${scoped.body.data.length}`
  );
  check(
    "the second building's event is the one the scoped view misses",
    orgWide.body.data.some((s) => s.sessionId === ids.session2) &&
      !scoped.body.data.some((s) => s.sessionId === ids.session2)
  );

  // The tab is reachable: ?tab=events must survive the server's isWorkspaceTab
  // validation rather than silently falling back to the schedule tab.
  const tabPage = await api("/dashboard/schedule?tab=events");
  check("/dashboard/schedule?tab=events → 200", tabPage.status === 200, `got ${tabPage.status}`);

  // ------------------------------- 10. adding an event on a specific day cell
  // What the month grid's "+" produces. The failure this guards against is
  // subtle and silent: sending a weekly rule for a dated placement creates an
  // every-Thursday series that *looks* right on the day clicked and wrong on
  // four other days of the month.
  console.log("\n10. A dated placement is a one-off, not a weekly series");
  const dated = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: ids.scheduleGroup,
      // Exactly what handleConfirmCreate sends when values.once is true.
      rrule: "FREQ=DAILY;COUNT=1",
      dtstart: "2026-08-13T18:00:00Z",
      dtend_time: "21:00",
      valid_from: "2026-08-13",
      valid_until: "2026-08-13",
      space_ids: [],
    }),
  });
  check("dated placement created", dated.status === 200 && !!dated.body.sessionId, JSON.stringify(dated.body));

  await api("/api/sessions/features", {
    method: "POST",
    body: JSON.stringify({ session_id: dated.body.sessionId, is_event: true }),
  });

  const monthOfDated = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-07-27T00:00:00Z&rangeEnd=2026-09-06T23:59:59Z&eventsOnly=true`
  );
  const occurrences = monthOfDated.body.data.filter((s) => s.sessionId === dated.body.sessionId);
  check("it appears exactly once in the whole month", occurrences.length === 1, `got ${occurrences.length}`);
  check("on the day that was clicked", occurrences[0]?.start?.startsWith("2026-08-13"), String(occurrences[0]?.start));

  // The same rule over a full quarter — a COUNT=1 that silently repeated would
  // show up here even when a single month looked correct.
  const quarter = await api(
    `/api/sessions/expand?facilityId=${ids.facility}&rangeStart=2026-08-01T00:00:00Z&rangeEnd=2026-10-31T23:59:59Z&eventsOnly=true`
  );
  const overQuarter = quarter.body.data.filter((s) => s.sessionId === dated.body.sessionId);
  check("still exactly one occurrence across three months", overQuarter.length === 1, `got ${overQuarter.length}`);
} catch (err) {
  fail++;
  console.log(`\n  HARNESS ERROR — ${err.message}\n${err.stack}`);
} finally {
  // Teardown, deepest first. Cascades cover most of it; explicit anyway.
  if (ids.org) {
    await admin.from("session_features").delete().eq("org_id", ids.org);
    await admin.from("sessions").delete().eq("org_id", ids.org);
    await admin.from("schedule_groups").delete().eq("org_id", ids.org);
    await admin.from("facilities").delete().eq("org_id", ids.org);
    await admin.from("org_memberships").delete().eq("org_id", ids.org);
    await admin.from("organizations").delete().eq("id", ids.org);
  }
  if (ids.user) await admin.auth.admin.deleteUser(ids.user);

  const { data: leftoverOrg } = await admin.from("organizations").select("id").eq("id", ids.org ?? "").maybeSingle();
  console.log(`\nTeardown: org removed = ${!leftoverOrg}`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
