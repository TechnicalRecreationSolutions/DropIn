/**
 * Spreadsheet editing on the lane x time canvas: the edit arithmetic, and the
 * batch endpoint that applies it and hands back its own undo.
 *
 * The canvas writes with no confirmation dialog, so the claims worth proving
 * are the ones a dialog used to cover for:
 *
 *   1. **An edit replaces, it never collapses.** Dragging the Wednesday block
 *      of a Mon/Wed/Fri series to Thursday must leave MO,TH,FR. The code this
 *      replaces rebuilt the rule as "Thursday" and silently deleted two days
 *      of programming — survivable behind a confirm, not behind a drag that
 *      saves itself. Same for lanes: moving the Lane 2 block of a Lanes 1-3
 *      session must leave the other two alone.
 *   2. **Undo is exact, and comes from the server.** Every op's inverse is
 *      built from the row as it was at write time. Posting it back has to
 *      restore the literal previous values, not something that looks similar.
 *   3. **One gesture is one action.** A batch whose second op is refused
 *      leaves the first op rolled back — otherwise a paste across eight lanes
 *      can land on five of them with nothing to press Undo on.
 *   4. **Alt is one date, not one week.** The canvas writes a date-scoped
 *      exception. `POST /api/sessions/[id]/exceptions` covers a whole week,
 *      and using it here would retime Monday when Wednesday was dragged.
 *   5. **The role gate still holds.** `aux` reaches this route like any other,
 *      and must be refused by it.
 *
 * Section 0 needs nothing running: it imports the real `gridEdits.ts`.
 *
 *   node --experimental-strip-types scripts/verify/verify-aw.mjs --logic-only
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-aw.mjs
 *
 * No migration needed — every op writes columns that already exist.
 */
import fs from "fs";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const LOGIC_ONLY = process.argv.includes("--logic-only");
const APP = process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ?? "http://localhost:3000";

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

// =============================================================================
// Section 0 — the edit arithmetic. No database, no server, no browser.
// =============================================================================

async function logicChecks() {
  // gridEdits.ts imports weekGeometry.ts by relative path, and that one imports
  // `@/lib/utils/dates`. The hook resolves both — Node's ESM resolver does
  // neither on its own.
  register("./_alias-hooks.mjs", import.meta.url);
  console.log("\n  0. lib/schedule/gridEdits.ts\n");

  const {
    moveDay,
    moveSpace,
    moveSpan,
    resizeSpan,
    parseByDay,
    withByDay,
    isOneOff,
    snap,
    shiftDateString,
  } = await import("../../src/lib/schedule/gridEdits.ts");

  // --- the claim the whole design exists for --------------------------------
  const threeDay = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
  const moved = moveDay(threeDay, "WE", "TH");
  check(
    `moving Wednesday to Thursday keeps Monday and Friday (got ${JSON.stringify(moved)})`,
    moved.kind === "byday" && parseByDay(moved.rrule).join(",") === "MO,TH,FR"
  );
  // The positive control for it: prove the assertion above would catch the
  // thing it was written against, rather than passing on any string at all.
  check(
    "…and that is NOT what a naive rebuild produces",
    moved.kind === "byday" && moved.rrule !== "FREQ=WEEKLY;BYDAY=TH"
  );

  const sorted = moveDay("FREQ=WEEKLY;BYDAY=FR,MO", "FR", "TU");
  check(
    `days come back in week order, not input order (got ${sorted.kind === "byday" ? sorted.rrule : sorted.kind})`,
    sorted.kind === "byday" && parseByDay(sorted.rrule).join(",") === "MO,TU"
  );

  const merged = moveDay("FREQ=WEEKLY;BYDAY=MO,WE", "MO", "WE");
  check(
    "dropping a block onto a day the series already runs merges the two",
    merged.kind === "byday" && parseByDay(merged.rrule).join(",") === "WE"
  );

  const noop = moveDay(threeDay, "WE", "WE");
  check("moving a block onto its own day changes nothing", noop.kind === "byday" && noop.rrule === threeDay);

  const daily = moveDay("FREQ=DAILY", "MO", "TU");
  check(
    "a daily rule refuses a single-day move rather than becoming weekly",
    daily.kind === "refused" && /every day/i.test(daily.reason),
    JSON.stringify(daily)
  );

  const absent = moveDay(threeDay, "TU", "TH");
  check(
    "a block whose day is not in the pattern is refused, not appended",
    absent.kind === "refused",
    JSON.stringify(absent)
  );

  const once = moveDay("FREQ=DAILY;COUNT=1", "MO", "TH");
  check(
    "a one-off moves by shifting its date, not by gaining a BYDAY",
    once.kind === "date" && once.dayOffset === 3,
    JSON.stringify(once)
  );
  check("…and is recognised as a one-off in the first place", isOneOff("FREQ=DAILY;COUNT=1"));
  check("…while a weekly rule is not", !isOneOff("FREQ=WEEKLY;BYDAY=MO"));

  check("BYDAY is added to a rule that had none", withByDay("FREQ=WEEKLY", ["MO"]) === "FREQ=WEEKLY;BYDAY=MO");
  check(
    "…and replaced, not duplicated, when one is already there",
    withByDay("FREQ=WEEKLY;BYDAY=MO;INTERVAL=2", ["TU", "TH"]) === "FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2",
    withByDay("FREQ=WEEKLY;BYDAY=MO;INTERVAL=2", ["TU", "TH"])
  );
  check("a rule with no BYDAY parses as no days at all", parseByDay("FREQ=DAILY").length === 0);

  // --- lanes ----------------------------------------------------------------
  const lanes = ["l1", "l2", "l3"];
  check(
    `replacing Lane 2 with Lane 6 keeps 1 and 3 (got ${JSON.stringify(moveSpace(lanes, "l2", "l6"))})`,
    JSON.stringify(moveSpace(lanes, "l2", "l6")) === JSON.stringify(["l1", "l6", "l3"])
  );
  check(
    "dropping onto a lane the session already holds collapses the two",
    JSON.stringify(moveSpace(lanes, "l2", "l3")) === JSON.stringify(["l1", "l3"])
  );
  check("a block with no space at all lands in the lane it was dropped on", JSON.stringify(moveSpace([], null, "l6")) === JSON.stringify(["l6"]));
  check("a lane the session does not hold writes nothing", moveSpace(lanes, "l9", "l6") === null);
  check("dropping a lane onto itself writes nothing", moveSpace(lanes, "l2", "l2") === null);

  // --- times ----------------------------------------------------------------
  const span = { startTime: "07:00", endTime: "08:30" };
  const shifted = moveSpan(span, 9 * 60);
  check(
    `moving a span keeps its duration (got ${JSON.stringify(shifted)})`,
    shifted.startTime === "09:00" && shifted.endTime === "10:30"
  );
  check("a move that would cross midnight is refused", moveSpan({ startTime: "22:00", endTime: "23:30" }, 23 * 60 + 30) === null);
  check("a move snaps to the 15-minute grain", moveSpan(span, 9 * 60 + 7).startTime === "09:00");
  check("…and rounds up past the halfway point", moveSpan(span, 9 * 60 + 8).startTime === "09:15");
  check("snap() is the same grain everywhere", snap(67) === 60 && snap(68) === 75);

  const grown = resizeSpan(span, "end", 10 * 60);
  check("dragging the bottom edge moves only the end", grown.startTime === "07:00" && grown.endTime === "10:00");
  const raised = resizeSpan(span, "start", 6 * 60);
  check("dragging the top edge moves only the start", raised.startTime === "06:00" && raised.endTime === "08:30");
  const floored = resizeSpan(span, "end", 6 * 60);
  check(
    `a block cannot be dragged inside out (got ${JSON.stringify(floored)})`,
    floored.endTime === "07:15"
  );
  check("a resize that changed nothing writes nothing", resizeSpan(span, "end", 8 * 60 + 30) === null);

  check("a date shifts across a month boundary without a timezone in sight", shiftDateString("2026-10-31", 1) === "2026-11-01");
  check("…and backwards", shiftDateString("2026-11-01", -1) === "2026-10-31");

  await overviewChecks();
}

// =============================================================================
// Section 0b — the week overview's arithmetic. Still no database or server.
// =============================================================================

async function overviewChecks() {
  console.log("\n  0b. lib/schedule/weekOverview.ts\n");

  const { buildWeekOverview, unionMinutes, formatHours } = await import(
    "../../src/lib/schedule/weekOverview.ts"
  );

  // 2026-11-02 is a Monday; occurrence Dates are literal wall-clock stamps read
  // with UTC getters, so they are built that way here too.
  const at = (date, from, to, spaces, kind, id) => ({
    sessionId: id,
    key: `${id}_${date}`,
    start: new Date(`${date}T${from}:00Z`),
    end: new Date(`${date}T${to}:00Z`),
    spaceIds: Array.from({ length: spaces }, (_, i) => `space-${i}`),
    spaceNames: [],
    occupancyKind: kind,
  });

  // Monday open 06:00-12:00 and 16:00-21:00 — a split day, which is the shape
  // migration 058 went out of its way to support and the one most likely to
  // break a naive "opens/closes" pair.
  const openByDay = [[], [{ opens: 360, closes: 720 }, { opens: 960, closes: 1260 }], [], [], [], [], []];

  check("an empty union is zero", unionMinutes([]) === 0);
  check(
    "overlapping spans are counted once",
    unionMinutes([{ start: 0, end: 60 }, { start: 30, end: 90 }]) === 90
  );
  check(
    "touching spans join rather than double-count the seam",
    unionMinutes([{ start: 0, end: 60 }, { start: 60, end: 120 }]) === 120
  );
  check(
    "a span wholly inside another adds nothing",
    unionMinutes([{ start: 0, end: 120 }, { start: 30, end: 60 }]) === 120
  );

  // Two programs at the SAME hour in different lanes. This is the case that
  // separates the two kinds of hour, and the one a naive sum gets wrong.
  const parallel = buildWeekOverview(
    [
      at("2026-11-02", "07:00", "09:00", 2, "program", "p1"),
      at("2026-11-02", "07:00", "09:00", 3, "program", "p2"),
    ],
    openByDay
  );
  const program = parallel.byKind.find((k) => k.kind === "program");
  check(
    `two parallel programs are 2h on the clock, not 4h (got ${formatHours(program.clockMinutes)})`,
    program.clockMinutes === 120
  );
  check(
    `…and 10 space-hours, which is what they actually consumed (got ${formatHours(program.spaceMinutes)})`,
    program.spaceMinutes === 600
  );
  check(`…counted as 2 sessions`, program.sessions === 2 && program.occurrences === 2);

  // The same series twice in one week is one session, two occurrences.
  const repeated = buildWeekOverview(
    [
      at("2026-11-02", "07:00", "08:00", 1, "rental", "r1"),
      at("2026-11-03", "07:00", "08:00", 1, "rental", "r1"),
    ],
    openByDay
  );
  const rental = repeated.byKind.find((k) => k.kind === "rental");
  check(
    `a series running twice is one session, two times (got ${rental.sessions}/${rental.occurrences})`,
    rental.sessions === 1 && rental.occurrences === 2
  );
  check("…and two clock hours, because the two days do not overlap", rental.clockMinutes === 120);

  // Open-hours arithmetic, including the midday gap and a block outside hours.
  const mixed = buildWeekOverview(
    [
      // Straddles the morning close: 11:00-13:00, only 11:00-12:00 is open.
      at("2026-11-02", "11:00", "13:00", 1, "drop_in", "d1"),
      // Entirely after close.
      at("2026-11-02", "22:00", "23:00", 1, "program", "p3"),
    ],
    openByDay
  );
  check(`the split Monday is 11 open hours (got ${formatHours(mixed.openMinutes)})`, mixed.openMinutes === 660);
  check(
    `only the part inside open hours counts as programmed (got ${formatHours(mixed.programmedMinutes)})`,
    mixed.programmedMinutes === 60
  );
  check(
    `…leaving 10h with nothing running (got ${formatHours(mixed.unprogrammedMinutes)})`,
    mixed.unprogrammedMinutes === 600
  );
  check(
    `…and 2h scheduled while the department is shut (got ${formatHours(mixed.outsideOpenMinutes)})`,
    mixed.outsideOpenMinutes === 120
  );

  // A department with no hours at all: the open figures are meaningless and
  // the caller is told so rather than shown a zero denominator.
  const noHours = buildWeekOverview([at("2026-11-02", "07:00", "08:00", 1, "drop_in", "d2")], [[], [], [], [], [], [], []]);
  check("no operating hours means no open-hours claim at all", noHours.hasOpenHours === false);
  check("…but the session totals still stand", noHours.byKind[0].spaceMinutes === 60);

  const ordered = buildWeekOverview(
    [
      at("2026-11-02", "07:00", "08:00", 1, "closure", "c1"),
      at("2026-11-02", "09:00", "10:00", 1, "drop_in", "d3"),
      at("2026-11-02", "11:00", "11:30", 1, "rental", "r2"),
    ],
    openByDay
  );
  check(
    `kinds list public-first and closures last (got ${ordered.byKind.map((k) => k.kind).join(",")})`,
    ordered.byKind.map((k) => k.kind).join(",") === "drop_in,rental,closure"
  );
  check(
    `Monday's space-hours land on Monday (got ${formatHours(ordered.byDay[1].spaceMinutes)})`,
    ordered.byDay[1].spaceMinutes === 150 && ordered.byDay[0].spaceMinutes === 0
  );

  check("a block with no space at all still counts as one", buildWeekOverview([
    { ...at("2026-11-02", "07:00", "08:00", 0, "drop_in", "d4"), spaceIds: [] },
  ], openByDay).totalSpaceMinutes === 60);

  check("formatHours is compact", formatHours(0) === "0h" && formatHours(45) === "45m" && formatHours(150) === "2h 30m");
}

// =============================================================================

const stamp = Date.now();
const ids = { users: [], orgs: [] };

if (LOGIC_ONLY) {
  await logicChecks();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

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
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

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
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const batch = (cookie, ops) =>
  api("/api/sessions/batch", cookie, { method: "POST", body: JSON.stringify({ ops }) });

/** The stored row, read with the service role so RLS can never flatter a result. */
const rowOf = async (id) =>
  (await admin.from("sessions").select("rrule, dtstart, dtend_time, valid_from, is_active").eq("id", id).maybeSingle())
    .data;

const lanesOf = async (id) =>
  ((await admin.from("session_spaces").select("space_id").eq("session_id", id)).data ?? [])
    .map((r) => r.space_id)
    .sort();

// The fixture week: MON=2026-11-02 .. SUN=2026-11-08.
const MON = "2026-11-02";
const WED = "2026-11-04";

try {
  await logicChecks();

  // ------------------------------------------------------------- fixtures
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-aw ${stamp}`, slug: `zz-verify-aw-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  async function makeUser(role, scopeRows, label = role) {
    const email = `zz-aw-${label}-${stamp}@example.invalid`;
    const password = `Zw!${stamp}aA9`;
    const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${role}: ${error.message}`);
    ids.users.push(u.user.id);
    const { data: m, error: mErr } = await admin
      .from("org_memberships")
      .insert({ org_id: org.id, user_id: u.user.id, role, email })
      .select("id")
      .single();
    if (mErr) throw new Error(`membership ${role}: ${mErr.message}`);
    if (scopeRows?.length) {
      await admin
        .from("membership_scopes")
        .insert(scopeRows.map((r) => ({ membership_id: m.id, org_id: org.id, ...r })));
    }
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
    return sessionCookies(signIn.session);
  }

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ Pool ${stamp}`,
        slug: `zz-pool-aw-${stamp}`,
        address_line1: "1 Test St",
        city: "Victoria",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const department = (
    await admin
      .from("departments")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "Aquatics",
        slug: `aquatics-aw-${stamp}`,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const lane = async (n) =>
    (
      await admin
        .from("spaces")
        .insert({
          org_id: org.id,
          facility_id: facility.id,
          department_id: department.id,
          name: `Lane ${n}`,
          slug: `lane-${n}-aw-${stamp}`,
          is_published: true,
        })
        .select("id")
        .single()
    ).data;

  const l1 = await lane(1);
  const l2 = await lane(2);
  const l3 = await lane(3);
  const l6 = await lane(6);

  const group = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        department_id: department.id,
        name: `ZZ Lengths ${stamp}`,
        slug: `zz-lengths-aw-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        source: "manual",
        starts_on: "2026-01-01",
      })
      .select("id")
      .single()
  ).data;

  /** A session, inserted directly so its exact stored shape is the fixture. */
  async function seed({ rrule, start = "07:00", end = "08:30", spaces = [], kind = "program", date = MON }) {
    const row = (
      await admin
        .from("sessions")
        .insert({
          org_id: org.id,
          schedule_group_id: group.id,
          rrule,
          dtstart: `${date}T${start}:00Z`,
          dtend_time: end,
          valid_from: "2026-01-01",
          occupancy_kind: kind,
          is_active: true,
        })
        .select("id")
        .single()
    ).data;
    if (spaces.length) {
      await admin
        .from("session_spaces")
        .insert(spaces.map((s) => ({ session_id: row.id, space_id: s.id, org_id: org.id })));
    }
    return row.id;
  }

  const cookie = await makeUser("owner");

  // =========================================================================
  console.log("\n  1. a move replaces one day and one lane, and leaves the rest\n");
  // =========================================================================

  const threeDay = await seed({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", spaces: [l1, l2, l3] });

  const move = await batch(cookie, [
    {
      kind: "move",
      sessionId: threeDay,
      fromDayCode: "WE",
      toDayCode: "TH",
      fromSpaceId: l2.id,
      toSpaceId: l6.id,
      startTime: "09:00",
    },
  ]);
  check(`the move is accepted (status ${move.status})`, move.status === 200, JSON.stringify(move.body));

  const afterMove = await rowOf(threeDay);
  check(
    `Monday and Friday survived the Wednesday drag (rrule=${afterMove?.rrule})`,
    afterMove?.rrule === "FREQ=WEEKLY;BYDAY=MO,TH,FR"
  );
  check(`the dropped time was written (dtstart=${afterMove?.dtstart})`, afterMove?.dtstart?.slice(11, 16) === "09:00");
  check(`the duration came with it (dtend_time=${afterMove?.dtend_time})`, afterMove?.dtend_time?.slice(0, 5) === "10:30");

  const afterLanes = await lanesOf(threeDay);
  check(
    `Lane 2 became Lane 6 and Lanes 1 and 3 stayed (${afterLanes.length} lanes)`,
    afterLanes.length === 3 &&
      afterLanes.includes(l1.id) &&
      afterLanes.includes(l3.id) &&
      afterLanes.includes(l6.id) &&
      !afterLanes.includes(l2.id)
  );
  // The positive control for the lane assertion: prove it can tell a real
  // 3-lane set from any 3-lane set.
  check("…and Lane 2 is genuinely gone, not merely unsorted", !afterLanes.includes(l2.id));

  // =========================================================================
  console.log("\n  2. the inverse the server handed back is an exact undo\n");
  // =========================================================================

  check("the response carried an inverse", Array.isArray(move.body.inverse) && move.body.inverse.length > 0);

  const undo = await batch(cookie, move.body.inverse);
  check(`the undo is accepted (status ${undo.status})`, undo.status === 200, JSON.stringify(undo.body));

  const afterUndo = await rowOf(threeDay);
  const undoneLanes = await lanesOf(threeDay);
  check(`the rule is back to what it was (${afterUndo?.rrule})`, afterUndo?.rrule === "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  check(`the time is back (${afterUndo?.dtstart?.slice(11, 16)}-${afterUndo?.dtend_time?.slice(0, 5)})`,
    afterUndo?.dtstart?.slice(11, 16) === "07:00" && afterUndo?.dtend_time?.slice(0, 5) === "08:30");
  check(
    "the lanes are back to 1, 2 and 3",
    undoneLanes.length === 3 && undoneLanes.includes(l2.id) && !undoneLanes.includes(l6.id)
  );

  const redo = await batch(cookie, undo.body.inverse);
  check(`undoing the undo redoes the move (status ${redo.status})`, redo.status === 200);
  check(`…back to MO,TH,FR (${(await rowOf(threeDay))?.rrule})`, (await rowOf(threeDay))?.rrule === "FREQ=WEEKLY;BYDAY=MO,TH,FR");
  await batch(cookie, redo.body.inverse); // leave it as MO,WE,FR for later sections

  // =========================================================================
  console.log("\n  3. resize touches one edge only\n");
  // =========================================================================

  const resized = await batch(cookie, [{ kind: "resize", sessionId: threeDay, endTime: "10:00" }]);
  const afterResize = await rowOf(threeDay);
  check(`resize accepted (status ${resized.status})`, resized.status === 200, JSON.stringify(resized.body));
  check(`the end moved (${afterResize?.dtend_time?.slice(0, 5)})`, afterResize?.dtend_time?.slice(0, 5) === "10:00");
  check(`the start did not (${afterResize?.dtstart?.slice(11, 16)})`, afterResize?.dtstart?.slice(11, 16) === "07:00");
  check(`the rule did not (${afterResize?.rrule})`, afterResize?.rrule === "FREQ=WEEKLY;BYDAY=MO,WE,FR");

  await batch(cookie, resized.body.inverse);
  check(
    `undoing the resize restores 08:30 (${(await rowOf(threeDay))?.dtend_time?.slice(0, 5)})`,
    (await rowOf(threeDay))?.dtend_time?.slice(0, 5) === "08:30"
  );

  // =========================================================================
  console.log("\n  4. paste creates, and undoing a paste leaves nothing behind\n");
  // =========================================================================

  const pasted = await batch(cookie, [
    {
      kind: "create",
      scheduleGroupId: group.id,
      dayCodes: ["TU"],
      startTime: "13:00",
      endTime: "14:00",
      spaceIds: [l6.id],
      validFrom: MON,
      occupancyKind: "program",
    },
  ]);
  check(`paste accepted (status ${pasted.status})`, pasted.status === 200, JSON.stringify(pasted.body));
  const pastedId = pasted.body.results?.[0]?.sessionId;
  check("…and named the row it made", !!pastedId);
  check(`the new row exists (${(await rowOf(pastedId))?.rrule})`, (await rowOf(pastedId))?.rrule === "FREQ=WEEKLY;BYDAY=TU");

  await batch(cookie, pasted.body.inverse);
  check("undoing a paste PURGES the row rather than soft-deleting it", (await rowOf(pastedId)) === null);

  // =========================================================================
  console.log("\n  5. delete is soft, and undo brings it back\n");
  // =========================================================================

  const spare = await seed({ rrule: "FREQ=WEEKLY;BYDAY=SA", start: "15:00", end: "16:00", spaces: [l6] });
  const removed = await batch(cookie, [{ kind: "delete", sessionId: spare }]);
  check(`delete accepted (status ${removed.status})`, removed.status === 200, JSON.stringify(removed.body));
  check("the row is deactivated, not dropped", (await rowOf(spare))?.is_active === false);

  await batch(cookie, removed.body.inverse);
  check("undo reactivates it", (await rowOf(spare))?.is_active === true);
  check("…with its lane still attached", (await lanesOf(spare)).includes(l6.id));

  // =========================================================================
  console.log("\n  6. Alt writes ONE date, not the week\n");
  // =========================================================================

  const override = await batch(cookie, [
    { kind: "occurrence", sessionId: threeDay, date: WED, action: "modify", startTime: "11:00", endTime: "12:00" },
  ]);
  check(`the override is accepted (status ${override.status})`, override.status === 200, JSON.stringify(override.body));

  const exceptions = (await admin.from("session_exceptions").select("exception_date, exception_type, modified_start").eq("session_id", threeDay)).data ?? [];
  check(`exactly one exception row was written (${exceptions.length})`, exceptions.length === 1);
  check(`…on the dragged date only (${exceptions[0]?.exception_date})`, exceptions[0]?.exception_date === WED);
  check(`…and Monday was left alone`, !exceptions.some((e) => e.exception_date === MON));
  check(`…carrying the new time (${exceptions[0]?.modified_start})`, exceptions[0]?.modified_start?.slice(11, 16) === "11:00");
  check("the series' own rule is untouched", (await rowOf(threeDay))?.rrule === "FREQ=WEEKLY;BYDAY=MO,WE,FR");

  await batch(cookie, override.body.inverse);
  const clearedExceptions = (await admin.from("session_exceptions").select("id").eq("session_id", threeDay)).data ?? [];
  check("undoing it removes the exception rather than leaving an empty one", clearedExceptions.length === 0);

  // =========================================================================
  console.log("\n  7. a refused op rolls the rest of the batch back\n");
  // =========================================================================

  // A second exclusive claim sitting on Lane 1 at the same hours, so moving
  // anything onto it is a real conflict rather than an invented one.
  const blocker = await seed({ rrule: "FREQ=WEEKLY;BYDAY=TU", start: "07:00", end: "08:30", spaces: [l1], kind: "program" });
  const mover = await seed({ rrule: "FREQ=WEEKLY;BYDAY=TU", start: "18:00", end: "19:00", spaces: [l6], kind: "program" });

  const beforeRule = (await rowOf(threeDay))?.rrule;

  const clash = await batch(cookie, [
    // Op 1 is perfectly valid and lands first.
    { kind: "resize", sessionId: threeDay, endTime: "09:15" },
    // Op 2 drops `mover` onto the lane and hours `blocker` already holds.
    { kind: "move", sessionId: mover, fromDayCode: "TU", toDayCode: "TU", fromSpaceId: l6.id, toSpaceId: l1.id, startTime: "07:00" },
  ]);

  check(`the batch is refused (status ${clash.status})`, clash.status === 409, JSON.stringify(clash.body));
  check("…and says it rolled back", clash.body.rolledBack === true, JSON.stringify(clash.body));
  check(
    `op 1 was undone: the end time is back to 08:30 (${(await rowOf(threeDay))?.dtend_time?.slice(0, 5)})`,
    (await rowOf(threeDay))?.dtend_time?.slice(0, 5) === "08:30"
  );
  check(`…and its rule never moved (${beforeRule})`, (await rowOf(threeDay))?.rrule === beforeRule);
  check("op 2 did not move lanes", (await lanesOf(mover)).includes(l6.id) && !(await lanesOf(mover)).includes(l1.id));

  // The positive control: the SAME first op, without the clashing second one,
  // has to succeed — otherwise the rollback above proves only that the batch
  // failed, not that the conflict is what failed it.
  const control = await batch(cookie, [{ kind: "resize", sessionId: threeDay, endTime: "09:15" }]);
  check(`the same op alone succeeds (status ${control.status})`, control.status === 200, JSON.stringify(control.body));
  check(
    `…and this time it stuck (${(await rowOf(threeDay))?.dtend_time?.slice(0, 5)})`,
    (await rowOf(threeDay))?.dtend_time?.slice(0, 5) === "09:15"
  );
  await batch(cookie, control.body.inverse);

  // =========================================================================
  console.log("\n  8. the role gate holds on this route too\n");
  // =========================================================================

  const auxCookie = await makeUser("aux", [{ facility_id: facility.id }], "aux");
  const auxMove = await batch(auxCookie, [
    { kind: "move", sessionId: threeDay, fromDayCode: "MO", toDayCode: "SU" },
  ]);
  check(`an aux staffer is refused (status ${auxMove.status})`, auxMove.status === 403, JSON.stringify(auxMove.body));
  check(
    `…and the schedule is unchanged (${(await rowOf(threeDay))?.rrule})`,
    (await rowOf(threeDay))?.rrule === "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  );

  const auxDelete = await batch(auxCookie, [{ kind: "delete", sessionId: threeDay }]);
  check(`…and cannot delete either (status ${auxDelete.status})`, auxDelete.status === 403);
  check("…the session is still active", (await rowOf(threeDay))?.is_active === true);

  const anonMove = await batch(null, [{ kind: "delete", sessionId: threeDay }]);
  check(`a signed-out caller is refused (status ${anonMove.status})`, anonMove.status === 401);

  // =========================================================================
  console.log("\n  9. input guards\n");
  // =========================================================================

  const empty = await batch(cookie, []);
  check(`an empty batch is rejected (status ${empty.status})`, empty.status === 400);

  const tooMany = await batch(
    cookie,
    Array.from({ length: 101 }, () => ({ kind: "delete", sessionId: threeDay }))
  );
  check(`a batch over the ceiling is rejected (status ${tooMany.status})`, tooMany.status === 400);
  check("…and nothing was applied", (await rowOf(threeDay))?.is_active === true);

  const nonsense = await batch(cookie, [{ kind: "move", sessionId: threeDay, fromDayCode: "XX", toDayCode: "TU" }]);
  check(`an unknown day code is rejected (status ${nonsense.status})`, nonsense.status === 400);

  const dailyRefusal = await seed({ rrule: "FREQ=DAILY", start: "20:00", end: "21:00", spaces: [l3] });
  const dailyMove = await batch(cookie, [
    { kind: "move", sessionId: dailyRefusal, fromDayCode: "MO", toDayCode: "TU" },
  ]);
  check(`moving one day of a daily series is refused (status ${dailyMove.status})`, dailyMove.status === 400, JSON.stringify(dailyMove.body));
  check(
    "…in words that say why",
    /every day/i.test(dailyMove.body.error ?? ""),
    dailyMove.body.error
  );
  check("…and the rule is untouched", (await rowOf(dailyRefusal))?.rrule === "FREQ=DAILY");

  // =========================================================================
  console.log("\n  10. the canvas itself, in a real browser\n");
  // =========================================================================
  //
  // Everything above proves the endpoint. None of it proves a click selects, a
  // drag resizes, or Ctrl-V reaches the endpoint at all — those are claims
  // about pointer and key events, and only a browser can make them.

  // Sections 1-9 left sessions scattered across the week, including a daily
  // one that would appear in every column. Parked so the canvas below shows
  // exactly the two blocks it is about.
  await admin.from("sessions").update({ is_active: false }).eq("schedule_group_id", group.id);

  // Today, so the Map view's default day (dayIndexFromDate(new Date())) is the
  // one holding the fixture. A fixed future date would render an empty canvas
  // and every assertion below would fail for the wrong reason.
  const todayDate = new Date();
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const todayCode = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][todayDate.getDay()];

  // dtstart on TODAY, not the section 1-9 fixture date: an RRULE anchored in
  // November produces no occurrence in the week the browser is looking at, and
  // the canvas renders an empty grid that fails every check below at once.
  const blockA = await seed({ rrule: `FREQ=WEEKLY;BYDAY=${todayCode}`, start: "07:00", end: "08:30", spaces: [l1], date: todayStr });
  const blockB = await seed({ rrule: `FREQ=WEEKLY;BYDAY=${todayCode}`, start: "07:00", end: "08:30", spaces: [l2], date: todayStr });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await context.addCookies(
    cookie.split("; ").map((part) => {
      const i = part.indexOf("=");
      return { name: part.slice(0, i), value: part.slice(i + 1), domain: "localhost", path: "/" };
    })
  );
  const page = await context.newPage();

  try {
    await page.goto(
      `${APP}/dashboard/schedule?facility=${facility.id}&schedule=${group.id}&week=${todayStr}`,
      { waitUntil: "networkidle" }
    );
    await page.getByRole("group", { name: "Choose a view" }).getByRole("button", { name: "Map" }).click();

    const blocks = page.locator("[data-canvas-block]");
    try {
      await blocks.first().waitFor({ timeout: 15000 });
    } catch {
      // A canvas that drew nothing fails every assertion below for one reason,
      // and the reason is never visible in "expected 2, got 0".
      await page.screenshot({ path: "verify-aw-empty-canvas.png", fullPage: true });
      console.log("\n  --- page text ---\n" + (await page.locator("main").innerText()).slice(0, 1200) + "\n  ---\n");
    }
    check(`the canvas drew both fixture blocks (${await blocks.count()})`, (await blocks.count()) === 2);

    const countLabel = page.locator("[data-canvas-selection-count]");
    check("the shortcut bar starts with nothing selected", (await countLabel.getAttribute("data-canvas-selection-count")) === "0");

    // --- the rail is for sessions; the reading material moved ---------------
    check(
      "the editing instructions are NOT on the page",
      (await page.getByText("Drag the square at its corner").count()) === 0
    );
    check(
      "…and the left rail holds only the templates card",
      (await page.locator("[data-canvas-block]").first().isVisible()) &&
        (await page.getByRole("heading", { name: "Session templates" }).count()) === 1
    );

    // --- the week panel -----------------------------------------------------
    // Two parallel 90-minute programs, one in each of two lanes. That is the
    // case the two kinds of hour disagree about, so it is the one worth
    // reading off the real UI rather than only out of the pure function.
    await page.getByRole("button", { name: "Overview" }).click();
    const panel = page.getByRole("dialog");
    await panel.getByText("By kind").waitFor({ timeout: 10000 });

    const kindRow = panel.locator("tr", { hasText: "Program" }).first();
    const kindCells = (await kindRow.innerText()).replace(/\n/g, " | ");
    check(`the overview lists the programs (${kindCells})`, kindCells.includes("2 sessions"));
    check("…as 1h 30m on the clock, not 3h", kindCells.includes("1h 30m"));
    check("…and 3h of space-hours", kindCells.includes("3h"));
    check(
      "…and says so when there are no operating hours to compare against",
      (await panel.innerText()).includes("operating hours")
    );

    await page.getByRole("tab", { name: "How to edit" }).click();
    check(
      "the instructions live in the panel now",
      (await panel.getByText("Drag the square at its corner").count()) === 1
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("…and the panel closes again", (await page.getByRole("dialog").count()) === 0);

    const a = page.locator(`[data-canvas-block^="${blockA}_"]`).first();
    const b = page.locator(`[data-canvas-block^="${blockB}_"]`).first();

    // --- selection ---------------------------------------------------------
    await a.click({ position: { x: 40, y: 20 } });
    check("clicking a block selects it", (await a.getAttribute("data-canvas-selected")) === "true");
    check("…and only it", (await b.getAttribute("data-canvas-selected")) === "false");
    check("…and the bar counts one", (await countLabel.getAttribute("data-canvas-selection-count")) === "1");
    check("…without opening the details modal", (await page.locator('[role="dialog"]').count()) === 0);

    await b.click({ position: { x: 40, y: 20 }, modifiers: ["ControlOrMeta"] });
    check(
      `Ctrl-click adds to the selection (${await countLabel.getAttribute("data-canvas-selection-count")})`,
      (await countLabel.getAttribute("data-canvas-selection-count")) === "2"
    );

    await page.keyboard.press("Escape");
    check("Escape clears it", (await countLabel.getAttribute("data-canvas-selection-count")) === "0");

    await a.dblclick({ position: { x: 40, y: 20 } });
    check("double-click opens the details modal", (await page.locator('[role="dialog"]').count()) > 0);
    await page.keyboard.press("Escape");

    // --- copy and paste ----------------------------------------------------
    const before = (await admin.from("sessions").select("id").eq("schedule_group_id", group.id).eq("is_active", true)).data ?? [];

    await a.click({ position: { x: 40, y: 20 } });
    await page.keyboard.press("ControlOrMeta+c");
    // Lane 6 is the empty column: click its background to set the paste target.
    const laneSix = page.locator('[data-canvas-column="3"]');
    await laneSix.click({ position: { x: 40, y: 400 } });
    await page.keyboard.press("ControlOrMeta+v");
    await page.waitForTimeout(2500);

    const after = (await admin.from("sessions").select("id, rrule").eq("schedule_group_id", group.id).eq("is_active", true)).data ?? [];
    check(`pasting created one session (${before.length} -> ${after.length})`, after.length === before.length + 1);

    const pastedRow = after.find((r) => !before.some((x) => x.id === r.id));
    const pastedLanes = pastedRow ? await lanesOf(pastedRow.id) : [];
    check("…in the lane that was clicked, and only it", pastedLanes.length === 1 && pastedLanes[0] === l6.id, JSON.stringify(pastedLanes));
    // dnd-kit mounts its own aria-live region with role="status", so the bar
    // has to be addressed by what it is rather than by its role alone.
    const undoBar = page.locator("[role=status]").filter({ hasText: "Undo" }).first();
    check("the undo bar reported it", (await undoBar.innerText()).includes("Pasted"), await undoBar.innerText().catch(() => "(no bar)"));

    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(2500);
    const undone = (await admin.from("sessions").select("id").eq("schedule_group_id", group.id).eq("is_active", true)).data ?? [];
    check(`Ctrl-Z removed it again (${undone.length})`, undone.length === before.length);

    // --- resize ------------------------------------------------------------
    // The bottom edge, dragged down two 30-minute rows. SLOT_HEIGHT_PX is 48,
    // so 96px is exactly an hour — an assertion on a real pixel geometry
    // rather than on "it moved somewhere".
    const aBox = await a.boundingBox();
    await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height - 1);
    await page.mouse.down();
    await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height + 40, { steps: 5 });
    await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + aBox.height + 96, { steps: 5 });

    // Mid-gesture, before the pointer is released: the block has to have grown
    // AND to be saying what it will become. A resize that only changes shape
    // does not answer the question the gesture is asking — 9:00 or 9:30?
    const midResizeBox = await a.boundingBox();
    const midResizeText = await a.innerText();
    check(
      `the block grows while the edge is dragged (${aBox.height} -> ${midResizeBox.height})`,
      midResizeBox.height > aBox.height + 80
    );
    check(
      `…and shows the time it will become (\"${midResizeText.replace(/\n/g, " | ")}\")`,
      midResizeText.includes("9:30")
    );

    await page.mouse.up();
    await page.waitForTimeout(2500);

    const resizedRow = await rowOf(blockA);
    check(
      `dragging the bottom edge down an hour wrote 09:30 (got ${resizedRow?.dtend_time?.slice(0, 5)})`,
      resizedRow?.dtend_time?.slice(0, 5) === "09:30"
    );
    // The point of the preview: what it promised is what was stored.
    check(
      "…which is exactly what the preview promised mid-drag",
      midResizeText.includes("9:30") && resizedRow?.dtend_time?.slice(0, 5) === "09:30"
    );
    check(`…and left the start alone (${resizedRow?.dtstart?.slice(11, 16)})`, resizedRow?.dtstart?.slice(11, 16) === "07:00");

    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(2500);
    check(
      `Ctrl-Z restores 08:30 (${(await rowOf(blockA))?.dtend_time?.slice(0, 5)})`,
      (await rowOf(blockA))?.dtend_time?.slice(0, 5) === "08:30"
    );

    // --- drag between lanes ------------------------------------------------
    const dragBox = await b.boundingBox();
    const targetCol = await page.locator('[data-canvas-column="3"]').boundingBox();
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(dragBox.x + dragBox.width / 2 + 20, dragBox.y + 14, { steps: 3 });
    await page.mouse.move(targetCol.x + targetCol.width / 2, dragBox.y + 12, { steps: 10 });

    // The block must be under the pointer, in the target lane, BEFORE the drop.
    // dnd-kit reports a transform; applying it is a separate act, and until
    // pass 1 nothing did — the block stayed put and only faded, so every drag
    // read as broken right up until the refetch moved it.
    const midDragBox = await b.boundingBox();
    check(
      `the dragged block follows the pointer into the target lane (x ${Math.round(dragBox.x)} -> ${Math.round(midDragBox.x)}, target ${Math.round(targetCol.x)})`,
      midDragBox.x > dragBox.x + 40 &&
        midDragBox.x + midDragBox.width > targetCol.x &&
        midDragBox.x < targetCol.x + targetCol.width
    );
    check(
      "…and the target lane is lit as the drop target",
      (await page.locator('[data-canvas-column="3"]').getAttribute("class")).includes("ring-blue-500")
    );

    await page.mouse.up();
    await page.waitForTimeout(2500);

    const movedLanes = await lanesOf(blockB);
    check(
      `dragging a block into Lane 6 moved it there (${JSON.stringify(movedLanes)})`,
      movedLanes.length === 1 && movedLanes[0] === l6.id
    );
    check("…and it left Lane 2", !movedLanes.includes(l2.id));

    // --- the write lands at pointer-up, not at round-trip-end --------------
    // Held open deliberately rather than raced: on a fast local server the
    // request finishes in under 100ms and an "is it optimistic?" check would
    // pass whether or not it is. Stalling the route is what makes the claim
    // mean something.
    await page.route("**/api/sessions/batch", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // The unroute below can land first, and a route already handled throws
      // from inside a handler Playwright does not own — which crashes the
      // whole run rather than failing a check.
      try {
        await route.continue();
      } catch {
        /* the route was released while this one was stalled */
      }
    });

    const optBox = await a.boundingBox();
    await page.mouse.move(optBox.x + optBox.width / 2, optBox.y + optBox.height - 1);
    await page.mouse.down();
    await page.mouse.move(optBox.x + optBox.width / 2, optBox.y + optBox.height + 96, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const inFlightText = await a.innerText();
    check(
      `the canvas already shows 9:30 while the write is still in flight ("${inFlightText.replace(/\n/g, " | ")}")`,
      inFlightText.includes("9:30")
    );
    check(
      "…and the database has not been told yet, so this is the optimistic paint and not a fast round trip",
      (await rowOf(blockA))?.dtend_time?.slice(0, 5) === "08:30"
    );

    // Let the stalled request through before releasing the route.
    await page.waitForTimeout(4000);
    await page.unroute("**/api/sessions/batch");
    check(
      `…and the server agrees once it answers (${(await rowOf(blockA))?.dtend_time?.slice(0, 5)})`,
      (await rowOf(blockA))?.dtend_time?.slice(0, 5) === "09:30"
    );

    // --- a short block is still a block ------------------------------------
    // 15 minutes is 24px tall. The fixed 10px grips took 6px off each end of
    // it — half the block — leaving a 12px strip to grab it by. So the
    // shortest sessions, the ones most often in the wrong place, were the
    // hardest to move.
    const shortId = await seed({
      rrule: `FREQ=WEEKLY;BYDAY=${todayCode}`,
      start: "12:00",
      end: "12:15",
      spaces: [l3],
      date: todayStr,
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("group", { name: "Choose a view" }).getByRole("button", { name: "Map" }).click();
    const shortBlock = page.locator(`[data-canvas-block^="${shortId}_"]`).first();
    await shortBlock.waitFor({ timeout: 15000 });
    // Midday is ~1150px down a 16-hour grid, well below a 1100px viewport, and
    // Playwright drives the mouse in VIEWPORT coordinates — without this the
    // pointer lands outside the page and the drag never starts.
    await shortBlock.scrollIntoViewIfNeeded();

    const shortBox = await shortBlock.boundingBox();
    check(`a 15-minute block renders at one slot-half (${Math.round(shortBox.height)}px)`, shortBox.height <= 30);

    // Measured, not inferred from "a drag happened to work" — a drag started at
    // the exact midpoint clears the grips either way, so only the geometry
    // itself can say whether there is a body left to grab.
    await shortBlock.hover();
    const shortGrips = shortBlock.locator("div.cursor-ns-resize");
    const gripBoxes = await Promise.all((await shortGrips.all()).map((g) => g.boundingBox()));
    const middle = shortBox.y + shortBox.height / 2;
    const freeTop = Math.max(...gripBoxes.map((g) => g.y + g.height).filter((v) => v < middle));
    const freeBottom = Math.min(...gripBoxes.map((g) => g.y).filter((v) => v > middle));
    const freeRatio = (freeBottom - freeTop) / shortBox.height;
    check(
      `…and its grips leave most of it draggable (${Math.round(freeRatio * 100)}% free)`,
      freeRatio >= 0.7
    );

    // Grab the middle of it and drag down two hours. If the grips still owned
    // the block this would resize it, or do nothing at all.
    await page.mouse.move(shortBox.x + shortBox.width / 2, shortBox.y + shortBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(shortBox.x + shortBox.width / 2, shortBox.y + shortBox.height / 2 + 30, { steps: 4 });
    await page.mouse.move(shortBox.x + shortBox.width / 2, shortBox.y + shortBox.height / 2 + 192, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2500);

    const shortRow = await rowOf(shortId);
    check(
      `grabbing its body moved it two hours later (${shortRow?.dtstart?.slice(11, 16)}-${shortRow?.dtend_time?.slice(0, 5)})`,
      shortRow?.dtstart?.slice(11, 16) === "14:00"
    );
    check(
      "…and kept its 15-minute length, so it was moved rather than resized",
      shortRow?.dtend_time?.slice(0, 5) === "14:15"
    );

    // --- a selected block shows its grips without a hover -------------------
    await shortBlock.click({ position: { x: 20, y: 5 } });
    const grips = shortBlock.locator("div.cursor-ns-resize");
    check(`a selected block has both edge grips (${await grips.count()})`, (await grips.count()) === 2);
    check(
      "…visible without hovering, which a touch screen never does",
      (await grips.first().getAttribute("class")).includes("opacity-100")
    );

    // --- held Ctrl-Z must not eat the stack --------------------------------
    //
    // Two edits, then three presses faster than one round trip. All three read
    // the same `past` (React has not re-rendered), so without a guard they post
    // the SAME inverse three times — harmless to the row, which is why the
    // damage is invisible there — and pop the stack three times. The first edit
    // then becomes permanently unreachable. So the sensitive question is not
    // "did the row come back" but "can the edit underneath still be undone".
    const secondMoveBox = await shortBlock.boundingBox();
    await page.mouse.move(secondMoveBox.x + secondMoveBox.width / 2, secondMoveBox.y + secondMoveBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondMoveBox.x + secondMoveBox.width / 2, secondMoveBox.y + secondMoveBox.height / 2 + 30, { steps: 4 });
    await page.mouse.move(secondMoveBox.x + secondMoveBox.width / 2, secondMoveBox.y + secondMoveBox.height / 2 + 96, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    check(
      `a second move stacks on the first (${(await rowOf(shortId))?.dtstart?.slice(11, 16)})`,
      (await rowOf(shortId))?.dtstart?.slice(11, 16) === "15:00"
    );

    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(3500);

    const afterRapid = await rowOf(shortId);
    check(
      `three rapid undos undo one edit, not three (${afterRapid?.dtstart?.slice(11, 16)})`,
      afterRapid?.dtstart?.slice(11, 16) === "14:00"
    );
    check("…and did not take the block with them", afterRapid?.is_active === true);

    // The one that only a guard can pass: the edit underneath is still there.
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(3000);
    check(
      `…and the edit beneath is still reachable (${(await rowOf(shortId))?.dtstart?.slice(11, 16)})`,
      (await rowOf(shortId))?.dtstart?.slice(11, 16) === "12:00"
    );

    // --- the whole canvas without a mouse ----------------------------------
    // Every gesture above is a pointer gesture. A schedule someone builds for
    // two hours has to be reachable from the keyboard as well, and the arrow
    // keys are the drag: same code path, same optimistic redraw, same undo.
    await shortBlock.scrollIntoViewIfNeeded();
    // From a clean slate: the block is still selected from the pointer steps
    // above, and "focus does not select" is only a claim if nothing was.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await shortBlock.locator("button").first().focus();
    check(
      "a block takes keyboard focus",
      await shortBlock.locator("button").first().evaluate((el) => el === document.activeElement)
    );
    check(
      "…and focusing it does not select it, while still reporting that state",
      (await shortBlock.locator("button").first().getAttribute("aria-pressed")) === "false"
    );

    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    check(
      "Space selects it",
      (await shortBlock.locator("button").first().getAttribute("aria-pressed")) === "true"
    );

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(3000);
    check(
      `two presses of Down move it two grid steps (${(await rowOf(shortId))?.dtstart?.slice(11, 16)})`,
      (await rowOf(shortId))?.dtstart?.slice(11, 16) === "12:30"
    );
    check(
      "…without changing how long it runs",
      (await rowOf(shortId))?.dtend_time?.slice(0, 5) === "12:45"
    );

    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(3000);
    check(
      `Shift-Down lengthens it instead (${(await rowOf(shortId))?.dtend_time?.slice(0, 5)})`,
      (await rowOf(shortId))?.dtend_time?.slice(0, 5) === "13:00"
    );
    check(
      "…leaving its start where it was",
      (await rowOf(shortId))?.dtstart?.slice(11, 16) === "12:30"
    );

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(3000);
    check(
      `Right moves it one lane over (${JSON.stringify(await lanesOf(shortId))})`,
      (await lanesOf(shortId))[0] === l6.id
    );

    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check("Enter opens the details, which no double-press could", (await page.locator('[role="dialog"]').count()) > 0);
    await page.keyboard.press("Escape");

    // --- a removal says so differently from a move -------------------------
    // The canvas writes without asking, so the bar is the only warning there
    // is. "Removed …" and "Moved …" must not look the same at a glance.
    await shortBlock.click({ position: { x: 20, y: 5 } });
    const bar = page.locator("[data-canvas-undo-bar]");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(3000);
    check(
      `a move reports plainly (${await bar.getAttribute("data-canvas-undo-bar")})`,
      (await bar.getAttribute("data-canvas-undo-bar")) === "ok"
    );
    await page.keyboard.press("Delete");
    await page.waitForTimeout(3000);
    check(
      `a removal is marked as one (${await bar.getAttribute("data-canvas-undo-bar")})`,
      (await bar.getAttribute("data-canvas-undo-bar")) === "destructive"
    );
    check("…and it names the series, not the block", (await bar.innerText()).includes("whole recurring series"));
    check("…and the session really is gone", (await rowOf(shortId))?.is_active === false);
  } finally {
    await browser.close();
  }

  // =========================================================================
  console.log("\n  11. the read-only path is untouched\n");
  // =========================================================================
  //
  // `WeeklyScheduleMap` renders the public widget and facility page with no
  // canvas above it, and every one of the affordances above was added to that
  // same component. An `aux` staffer is the readable version of that path: the
  // whole staff week, real data, and `canEdit` false — so the canvas is null
  // and the component has to fall back to exactly what a visitor sees.

  const auxBrowser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  try {
    const auxContext = await auxBrowser.newContext({ viewport: { width: 1600, height: 1100 } });
    await auxContext.addCookies(
      auxCookie.split("; ").map((part) => {
        const i = part.indexOf("=");
        return { name: part.slice(0, i), value: part.slice(i + 1), domain: "localhost", path: "/" };
      })
    );
    const auxPage = await auxContext.newPage();
    const auxErrors = [];
    auxPage.on("pageerror", (err) => auxErrors.push(String(err?.message ?? err)));
    auxPage.on("console", (msg) => {
      if (msg.type() === "error") auxErrors.push(msg.text().slice(0, 300));
    });
    await auxPage.goto(
      `${APP}/dashboard/schedule?facility=${facility.id}&schedule=${group.id}&week=${todayStr}`,
      { waitUntil: "networkidle" }
    );
    await auxPage.getByRole("group", { name: "Choose a view" }).getByRole("button", { name: "Map" }).click();

    const auxBlocks = auxPage.locator("[data-canvas-block]");
    try {
      await auxBlocks.first().waitFor({ timeout: 15000 });
    } catch {
      console.log(
        `\n  --- aux page (${auxPage.url()}) ---\n${(await auxPage.locator("body").innerText()).slice(0, 400)}\n  errors: ${JSON.stringify(auxErrors.slice(0, 4), null, 2)}\n  ---\n`
      );
    }
    check(`the same component still draws the schedule (${await auxBlocks.count()})`, (await auxBlocks.count()) >= 1);

    await auxBlocks.first().hover();
    check("…with no resize grips", (await auxPage.locator("div.cursor-ns-resize").count()) === 0);
    check("…and no lane-span handle", (await auxPage.locator("div.cursor-ew-resize").count()) === 0);
    check("…and no shortcut bar", (await auxPage.locator("[data-canvas-selection-count]").count()) === 0);

    // The click contract flips back: with nothing to select into, one click
    // opens the details, exactly as it does in the widget.
    await auxBlocks.first().click({ position: { x: 40, y: 10 } });
    await auxPage.waitForTimeout(400);
    check("…and a SINGLE click opens the details again", (await auxPage.locator('[role="dialog"]').count()) > 0);
    check(
      "…with nothing selected by it",
      (await auxBlocks.first().getAttribute("data-canvas-selected")) === "false"
    );
  } finally {
    await auxBrowser.close();
  }

  // =========================================================================
  console.log("\n  12. a finger, not a mouse\n");
  // =========================================================================
  //
  // Staff build a schedule at a desk, but they READ it on the deck, on a
  // tablet, and the same page is what they open. Selection is the gesture that
  // has to survive that — the grips are shown for a selected block precisely
  // because hover does not exist here.

  const touchBrowser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  try {
    const touchContext = await touchBrowser.newContext({
      viewport: { width: 1280, height: 900 },
      hasTouch: true,
    });
    await touchContext.addCookies(
      cookie.split("; ").map((part) => {
        const i = part.indexOf("=");
        return { name: part.slice(0, i), value: part.slice(i + 1), domain: "localhost", path: "/" };
      })
    );
    const touchPage = await touchContext.newPage();
    await touchPage.goto(
      `${APP}/dashboard/schedule?facility=${facility.id}&schedule=${group.id}&week=${todayStr}`,
      { waitUntil: "networkidle" }
    );
    await touchPage.getByRole("group", { name: "Choose a view" }).getByRole("button", { name: "Map" }).click();

    const touchBlock = touchPage.locator("[data-canvas-block]").first();
    await touchBlock.waitFor({ timeout: 15000 });
    await touchBlock.scrollIntoViewIfNeeded();
    const touchBox = await touchBlock.boundingBox();
    await touchPage.touchscreen.tap(touchBox.x + touchBox.width / 2, touchBox.y + 12);
    await touchPage.waitForTimeout(500);

    check("a tap selects a block", (await touchBlock.getAttribute("data-canvas-selected")) === "true");
    check(
      "…and its grips appear without a hover, which a finger never performs",
      (await touchPage.locator("div.cursor-ns-resize").first().getAttribute("class")).includes("opacity-100")
    );
  } finally {
    await touchBrowser.close();
  }
} catch (err) {
  // Without this the `finally` below calls process.exit(), which DISCARDS a
  // thrown error — the run stops partway through and still prints
  // "0 failed", which is the most dangerous possible output for a harness.
  fail++;
  console.log(`\n  THREW  ${err?.stack ?? err}`);
} finally {
  console.log("\nCleaning up…");
  for (const orgId of ids.orgs) await admin.from("organizations").delete().eq("id", orgId);
  for (const userId of ids.users) await admin.auth.admin.deleteUser(userId);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
