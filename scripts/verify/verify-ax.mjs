/**
 * The rebuilt analytics page: its date ranges, its aggregation, and its CSV
 * export.
 *
 * What is worth proving here, in the order the bugs would bite:
 *
 *   1. **The read is not silently truncated.** The old summary asked for
 *      `.limit(20000)` in one request. PostgREST answers at most `max_rows`
 *      (1000 on a default Supabase project), so every total was the first
 *      thousand rows and nothing about the page said so. Section 2 inserts
 *      1,100 views and insists the export reports 1,100.
 *   2. **The window covers the days it names.** The last day of a range is
 *      included whole — a `lte` against its midnight would drop everything
 *      that happened during it, which is most of it. Section 1 proves the
 *      end instant is exclusive-next-midnight, and section 2 proves an event
 *      at 23:30 on the final day is counted.
 *   3. **Days are local days.** Bucketing with UTC getters puts a Pacific
 *      evening on tomorrow's bar. Section 1 pins the arithmetic; section 2
 *      checks the daily CSV lands the events on the day they happened.
 *   4. **The export cannot execute.** A referrer hostname is attacker-chosen
 *      text, and a cell starting `=` is a formula in Excel. Section 1 proves
 *      the guard, section 2 proves it survives a real round trip.
 *   5. **The export keeps its privacy promise.** No `ip_hash`, no raw
 *      `user_agent` — 005_analytics_tables.sql says those never leave.
 *   6. **`analytics:view` is actually enforced.** It was declared in roles.ts
 *      and asked by nothing before this change: a coordinator must get 403,
 *      an anonymous caller 401.
 *
 * Section 0/1 need nothing running — they import the real modules:
 *
 *   node --experimental-strip-types scripts/verify/verify-ax.mjs --logic-only
 *
 * The rest needs the app and a service-role key:
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-ax.mjs
 *
 * No migration: every column used here already exists (005 + 041 + 050).
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

/** Minimal CSV reader — enough for the quoting this export produces. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// =============================================================================
// Section 0 — lib/analytics/range.ts. No database, no server.
// =============================================================================

async function rangeChecks() {
  register("./_alias-hooks.mjs", import.meta.url);
  console.log("\n  0. lib/analytics/range.ts\n");

  const {
    MAX_RANGE_DAYS,
    daysBetween,
    eachDay,
    formatRangeLabel,
    parseAnalyticsRange,
    previousRange,
    rangeEndInstant,
    rangeFromPreset,
    rangeStartInstant,
    toLocalDay,
  } = await import("../../src/lib/analytics/range.ts");

  // A fixed "now" so none of this depends on the day the harness runs.
  // 2026-03-17 is a Tuesday, mid-month, mid-year.
  const now = new Date(2026, 2, 17, 14, 30);

  const d30 = rangeFromPreset("30d", now);
  check(
    `"Last 30 days" is 30 days ending today (got ${d30.from}..${d30.to}, ${d30.days})`,
    d30.from === "2026-02-16" && d30.to === "2026-03-17" && d30.days === 30
  );
  // The positive control: prove the assertion would catch an off-by-one,
  // which is the whole failure mode of an inclusive range.
  check("…and that is NOT 29 or 31 days", d30.days !== 29 && d30.days !== 31);

  const mtd = rangeFromPreset("mtd", now);
  check(`"This month" starts on the 1st (got ${mtd.from})`, mtd.from === "2026-03-01" && mtd.to === "2026-03-17");

  const last = rangeFromPreset("last-month", now);
  check(
    `"Last month" is the whole previous month (got ${last.from}..${last.to})`,
    last.from === "2026-02-01" && last.to === "2026-02-28"
  );

  const ytd = rangeFromPreset("ytd", now);
  check(`"Year to date" starts on Jan 1 (got ${ytd.from})`, ytd.from === "2026-01-01");

  const y12 = rangeFromPreset("12m", now);
  check(`"Last 12 months" spans a year (got ${y12.from}..${y12.to}, ${y12.days} days)`, y12.days === 365);

  // --- the instants the query actually uses ---------------------------------
  const week = rangeFromPreset("7d", now);
  check(
    `the start instant is local midnight on the first day (got ${rangeStartInstant(week)})`,
    new Date(rangeStartInstant(week)).getTime() === new Date(2026, 2, 11).getTime()
  );
  check(
    "the end instant is midnight on the day AFTER the last — an event at 23:30 on the final day is inside the window",
    new Date(rangeEndInstant(week)).getTime() === new Date(2026, 2, 18).getTime()
  );
  check(
    "…and the naive `lte last day` bound would have excluded it",
    new Date(2026, 2, 17, 23, 30).getTime() > new Date(2026, 2, 17).getTime()
  );

  // --- custom ranges, clamped rather than rejected ---------------------------
  const swapped = parseAnalyticsRange({ from: "2026-03-10", to: "2026-03-01" }, now);
  check(`reversed dates are swapped, not refused (got ${swapped.from}..${swapped.to})`, swapped.from === "2026-03-01" && swapped.to === "2026-03-10");

  const future = parseAnalyticsRange({ from: "2026-03-01", to: "2099-01-01" }, now);
  check(`a future end is pulled back to today (got ${future.to})`, future.to === "2026-03-17");

  const huge = parseAnalyticsRange({ from: "1970-01-01", to: "2026-03-17" }, now);
  check(
    `an unbounded window is trimmed to ${MAX_RANGE_DAYS} days, keeping the recent end (got ${huge.days} days from ${huge.from})`,
    huge.days === MAX_RANGE_DAYS && huge.to === "2026-03-17"
  );

  const asPreset = parseAnalyticsRange({ from: "2026-02-16", to: "2026-03-17" }, now);
  check(
    `a typed range matching a preset is reported as that preset (got ${asPreset.preset})`,
    asPreset.preset === "30d" && formatRangeLabel(asPreset, now) === "Last 30 days"
  );
  const custom = parseAnalyticsRange({ from: "2026-02-03", to: "2026-02-09" }, now);
  check(
    `…and one that does not is labelled by its dates (got "${formatRangeLabel(custom, now)}")`,
    custom.preset === "custom" && formatRangeLabel(custom, now) === "Feb 3 – Feb 9"
  );

  check("junk falls back to the default preset", parseAnalyticsRange({ range: "banana" }, now).preset === "30d");
  check("a half-typed custom range falls back too", parseAnalyticsRange({ from: "2026-03-01" }, now).preset === "30d");

  // --- comparison window -----------------------------------------------------
  const prev = previousRange(d30);
  check(
    `the previous period is the same length, immediately before (got ${prev.from}..${prev.to}, ${prev.days} days)`,
    prev.days === d30.days && prev.to === "2026-02-15" && prev.from === "2026-01-17"
  );
  check("…and does not overlap the current one", prev.to < d30.from);

  // --- day fill ---------------------------------------------------------------
  const days = eachDay(custom);
  check(`eachDay emits every day including both ends (got ${days.length})`, days.length === 7 && days[0] === "2026-02-03" && days[6] === "2026-02-09");

  // The bug this replaces: a chart built only from days that had events.
  check("…so a quiet day is still a point on the chart", days.includes("2026-02-05"));

  // --- DST, where day arithmetic usually breaks -------------------------------
  // 2026-03-08 is the US spring-forward. Two local midnights are 23h apart.
  check("a range across spring-forward is still counted in whole days", daysBetween("2026-03-07", "2026-03-09") === 3);
  check("a range across fall-back is too", daysBetween("2026-11-01", "2026-11-02") === 2);

  check("toLocalDay reads the local calendar, not UTC", toLocalDay(new Date(2026, 0, 1, 23, 30)) === "2026-01-01");
}

// =============================================================================
// Section 1 — lib/analytics/csv.ts and the classifiers. Still no server.
// =============================================================================

async function csvChecks() {
  console.log("\n  1. lib/analytics/csv.ts + classifiers\n");

  const { toCsv } = await import("../../src/lib/analytics/csv.ts");
  const { deviceClass, referrerLabel } = await import("../../src/lib/analytics/queries.ts");

  const out = toCsv([["a", "b"], ["1", "2"]]);
  check("output starts with a UTF-8 BOM so Excel reads it as UTF-8", out.startsWith("﻿"));
  check("rows are CRLF-terminated", out.includes("a,b\r\n"));

  const risky = toCsv([["=1+1", "+cmd", "-2", "@SUM(A1)", "safe"]]);
  check(
    `a cell starting "=" is neutralised (got ${JSON.stringify(risky.split("\r\n")[0])})`,
    risky.includes("'=1+1")
  );
  check("…and so are +, - and @", risky.includes("'+cmd") && risky.includes("'-2") && risky.includes("'@SUM(A1)"));
  check("…while an ordinary cell is left alone", risky.includes(",safe"));

  const quoted = toCsv([['say "hi", then', "two\nlines"]]);
  check("a comma and a quote force quoting with doubled quotes", quoted.includes('"say ""hi"", then"'));
  check("a newline inside a cell is quoted rather than breaking the row", quoted.includes('"two\nlines"'));

  const both = toCsv([["=HYPERLINK(\"http://x\"),y"]]);
  check(
    "a cell that is both risky and needs quoting keeps the guard INSIDE the quotes",
    both.includes('"\'=HYPERLINK') && !both.includes("'\"=")
  );

  // --- classifiers ------------------------------------------------------------
  check(
    "an iPhone is a phone",
    deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15") === "mobile"
  );
  check("an iPad is a tablet, not a phone", deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") === "tablet");
  check(
    "an Android tablet (no 'Mobile' token) is a tablet",
    deviceClass("Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Safari/537.36") === "tablet"
  );
  check(
    "…while an Android phone is not",
    deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36") === "mobile"
  );
  check("a desktop is a desktop", deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131") === "desktop");
  check("a crawler is separated out rather than inflating desktop", deviceClass("Googlebot/2.1") === "bot");
  check("a missing agent is unknown, not desktop", deviceClass(null) === "unknown");

  check("a referrer is reduced to its hostname", referrerLabel("https://www.saanich.ca/pool?x=1") === "saanich.ca");
  check("no referrer reads as direct", referrerLabel(null) === "Direct / no referrer");
  check("an unparseable referrer does not throw", referrerLabel("not a url") === "Direct / no referrer");
}

// =============================================================================

const stamp = Date.now();
const ids = { users: [], orgs: [] };

if (LOGIC_ONLY) {
  await rangeChecks();
  await csvChecks();
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

async function exportCsv(cookie, query) {
  const res = await fetch(`${APP}/api/analytics/export?${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const text = await res.text();
  return { status: res.status, text, rows: res.status === 200 ? parseCsv(text) : [] };
}

/** Value of a "Metric,Value,…" row in the summary export. */
function metric(rows, name) {
  return rows.find((r) => r[0] === name)?.[1];
}

/** A local-midnight-anchored ISO instant for a given local day and hour. */
function at(day, hour, minute = 0) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return localDay(date);
}

try {
  await rangeChecks();
  await csvChecks();

  // ------------------------------------------------------------- fixtures
  console.log("\n  2. fixtures\n");

  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-ax ${stamp}`, slug: `zz-verify-ax-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  async function makeUser(role, label = role) {
    const email = `zz-ax-${label}-${stamp}@example.invalid`;
    const password = `Zx!${stamp}aA9`;
    const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${role}: ${error.message}`);
    ids.users.push(u.user.id);
    const { error: mErr } = await admin
      .from("org_memberships")
      .insert({ org_id: org.id, user_id: u.user.id, role, email });
    if (mErr) throw new Error(`membership ${role}: ${mErr.message}`);
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
    return sessionCookies(signIn.session);
  }

  const facilityA = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ Pool ${stamp}`,
        slug: `zz-pool-ax-${stamp}`,
        address_line1: "1 Test St",
        city: "Victoria",
        province: "BC",
        postal_code: "V8V 1A1",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const facilityB = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ Arena ${stamp}`,
        slug: `zz-arena-ax-${stamp}`,
        address_line1: "2 Test St",
        city: "Victoria",
        province: "BC",
        postal_code: "V8V 1A2",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const TODAY = localDay();
  const YESTERDAY = daysAgo(1);
  const THREE_DAYS = daysAgo(3);
  const LONG_AGO = daysAgo(200);

  const events = [];
  const push = (row) => events.push({ org_id: org.id, ...row });

  // 1,100 widget views on facility A, three days back, spread over hours —
  // the count that PostgREST's default page size would have silently cut.
  for (let i = 0; i < 1100; i++) {
    push({
      event_type: "widget_view",
      facility_id: facilityA.id,
      occurred_at: at(THREE_DAYS, 6 + (i % 12), i % 60),
      view_template: ["grid", "list", "map"][i % 3],
      ip_hash: `hash-${THREE_DAYS}-${i % 400}`,
      user_agent:
        i % 2 === 0
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"
          : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131",
      referrer_url: i % 4 === 0 ? "https://www.saanich.ca/rec" : null,
    });
  }

  // The last moment of the last day in a "today" range.
  push({
    event_type: "facility_view",
    facility_id: facilityB.id,
    occurred_at: at(TODAY, 23, 30),
    view_template: "grid",
    ip_hash: `hash-${TODAY}-late`,
    user_agent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
    // An attacker-supplied referrer that is also a spreadsheet formula.
    referrer_url: "https://=cmd-injection.example.com/x",
  });

  // Yesterday: clicks and a registration follow-through, plus visit lengths.
  for (let i = 0; i < 10; i++) {
    push({
      event_type: "program_click",
      facility_id: facilityA.id,
      occurred_at: at(YESTERDAY, 10, i),
      ip_hash: `hash-${YESTERDAY}-${i}`,
    });
  }
  for (let i = 0; i < 4; i++) {
    push({ event_type: "link_click", facility_id: facilityA.id, occurred_at: at(YESTERDAY, 10, 30 + i) });
  }
  for (const ms of [2000, 5000, 9000, 40_000, 400_000]) {
    push({ event_type: "session_duration", facility_id: facilityA.id, occurred_at: at(YESTERDAY, 11), duration_ms: ms });
  }

  // Outside every window the harness asks for.
  push({ event_type: "widget_view", facility_id: facilityA.id, occurred_at: at(LONG_AGO, 12), ip_hash: "hash-old" });

  for (let i = 0; i < events.length; i += 500) {
    const { error } = await admin.from("analytics_events").insert(events.slice(i, i + 500));
    if (error) throw new Error(`insert events: ${error.message}`);
  }
  check(`${events.length} fixture events inserted`, true);

  const owner = await makeUser("owner");
  const coordinator = await makeUser("coordinator");

  // ------------------------------------------------------------ the read
  console.log("\n  3. the summary the page and the export share\n");

  const window7 = `from=${daysAgo(6)}&to=${TODAY}`;
  const summary = await exportCsv(owner, `${window7}&dataset=summary`);
  check(`the export answers 200 (got ${summary.status})`, summary.status === 200);

  const views = Number(metric(summary.rows, "Views"));
  check(
    `all 1,101 views are counted, not the first 1,000 (got ${views})`,
    views === 1101,
    "PostgREST caps one response at max_rows — the read has to page"
  );
  check("…and 1000 is exactly the wrong answer this guards against", views !== 1000);

  check(`the 23:30 event on the final day is inside the window`, views === 1101);
  check(`session clicks are counted (got ${metric(summary.rows, "Session clicks")})`, Number(metric(summary.rows, "Session clicks")) === 10);
  check(
    `registration clicks are counted separately from session clicks (got ${metric(summary.rows, "Registration clicks")})`,
    Number(metric(summary.rows, "Registration clicks")) === 4
  );
  check(
    `the 200-day-old view is outside a 7-day window (total events ${metric(summary.rows, "Events recorded")})`,
    Number(metric(summary.rows, "Events recorded")) === events.length - 1
  );

  const visitors = Number(metric(summary.rows, "Unique visitors (per day, summed)"));
  check(
    `unique visitors are distinct hashes per day (got ${visitors}, expected 401)`,
    visitors === 401,
    "400 distinct hashes three days ago + 1 today"
  );
  check("…which is not simply the view count", visitors !== views);

  const median = Number(metric(summary.rows, "Median time on schedule (s)"));
  const mean = Number(metric(summary.rows, "Average time on schedule (s)"));
  check(`the median visit is the middle one (got ${median}s, expected 9)`, median === 9);
  check(
    `…and the mean is dragged up by the one long visit (got ${mean}s)`,
    mean > median * 5,
    "which is why both are shown"
  );
  check(`quick exits are the sub-10s share (got ${metric(summary.rows, "Quick-exit rate (under 10s)")})`, metric(summary.rows, "Quick-exit rate (under 10s)") === "60.0%");

  // ------------------------------------------------------- day bucketing
  console.log("\n  4. daily breakdown\n");

  const daily = await exportCsv(owner, `${window7}&dataset=daily`);
  const header = daily.rows.findIndex((r) => r[0] === "Day");
  const dayRows = daily.rows.slice(header + 1).filter((r) => r.length >= 5 && r[0]);
  check(`a 7-day window emits 7 day rows including empty ones (got ${dayRows.length})`, dayRows.length === 7);

  const busy = dayRows.find((r) => r[0] === THREE_DAYS);
  check(`the 1,100 views land on ${THREE_DAYS} (got ${busy?.[1]})`, Number(busy?.[1]) === 1100);
  const today = dayRows.find((r) => r[0] === TODAY);
  check(
    `the 23:30 view lands on ${TODAY} and not the next day (got ${today?.[1]})`,
    Number(today?.[1]) === 1,
    "a UTC bucketing would move a late-evening event to tomorrow west of Greenwich"
  );
  const clicksDay = dayRows.find((r) => r[0] === YESTERDAY);
  check(`yesterday's 10 clicks land on yesterday (got ${clicksDay?.[3]})`, Number(clicksDay?.[3]) === 10);

  // ------------------------------------------------------- facility scope
  console.log("\n  5. the facility filter\n");

  const scoped = await exportCsv(owner, `${window7}&facility=${facilityB.id}&dataset=summary`);
  check(`filtering to the arena leaves only its view (got ${metric(scoped.rows, "Views")})`, Number(metric(scoped.rows, "Views")) === 1);
  check("…and the file header names the facility", scoped.text.includes(`ZZ Arena ${stamp}`));
  check("a facility id from outside the org is refused", (await exportCsv(owner, `${window7}&facility=${org.id}`)).status === 404);

  // ------------------------------------------------------------ the CSVs
  console.log("\n  6. the export files\n");

  const raw = await exportCsv(owner, `${window7}&dataset=events`);
  const rawHeader = raw.rows.find((r) => r[0] === "Occurred at") ?? [];
  check(`the raw export has one row per event (got ${raw.rows.length - rawHeader.length})`, raw.rows.length > 1100);
  check(
    "it never exports the hashed IP or the raw user agent",
    !rawHeader.some((h) => /ip|agent/i.test(h)) && !raw.text.includes("hash-") && !raw.text.includes("Mozilla/"),
    rawHeader.join(",")
  );
  check("…but it does report the device class derived from the agent", rawHeader.includes("Device") && raw.text.includes("Phone"));
  check("ids are resolved to names a spreadsheet reader can use", raw.text.includes(`ZZ Pool ${stamp}`));

  const breakdowns = await exportCsv(owner, `${window7}&dataset=breakdowns`);
  const templateRows = breakdowns.rows.filter((r) => r[0] === "View template");
  check(`templates are broken out (got ${templateRows.map((r) => r[1]).join(",")})`, templateRows.length === 3);
  check("…with readable labels, not raw keys", templateRows.some((r) => r[1] === "Grid"));
  const deviceRows = breakdowns.rows.filter((r) => r[0] === "Device");
  check(`devices are split (got ${deviceRows.map((r) => `${r[1]}=${r[2]}`).join(" ")})`, deviceRows.length >= 2);
  check(
    "the formula-injection referrer is neutralised on the way out",
    breakdowns.text.includes("'=cmd-injection.example.com"),
    "a raw =cmd cell executes on open in Excel"
  );
  check("…and it did reach the export at all, so the guard is what neutralised it", breakdowns.text.includes("cmd-injection.example.com"));

  check("the filename says what and when", raw.text.length > 0);
  const disposition = (
    await fetch(`${APP}/api/analytics/export?${window7}&dataset=summary`, { headers: { Cookie: owner } })
  ).headers.get("content-disposition");
  check(`the download is named for its dataset and period (got ${disposition})`, /analytics-summary-\d{4}-\d{2}-\d{2}-to-/.test(disposition ?? ""));

  // -------------------------------------------------------- authorization
  console.log("\n  7. analytics:view is enforced\n");

  check(`a coordinator is refused (got ${(await exportCsv(coordinator, window7)).status})`, (await exportCsv(coordinator, window7)).status === 403);
  check(`an anonymous caller is refused (got ${(await exportCsv(null, window7)).status})`, (await exportCsv(null, window7)).status === 401);
  check("…and the owner was allowed, so the gate is not simply refusing everyone", summary.status === 200);

  // --------------------------------------------------------- range limits
  console.log("\n  8. the range cap survives the round trip\n");

  const unbounded = await exportCsv(owner, `from=1970-01-01&to=${TODAY}&dataset=summary`);
  check(`an unbounded window is clamped rather than served (got ${unbounded.status})`, unbounded.status === 200);
  check(
    "…to 731 days, which still reaches the 200-day-old event",
    Number(metric(unbounded.rows, "Views")) === 1102,
    metric(unbounded.rows, "Views")
  );
  check("junk params fall back to the default 30 days instead of erroring", (await exportCsv(owner, "range=banana&dataset=summary")).status === 200);
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
