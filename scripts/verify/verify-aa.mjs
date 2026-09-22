/**
 * Residual subtraction, and the staff claims panel that replaced the shadow
 * calculator's panel (stage 5 of docs/PLAN-internal-view.md, now superseded).
 *
 * NOTE ON WHAT CHANGED. Stage 5 ran the availability calculator in shadow mode:
 * it computed what a drop-in block had left and published none of it, so staff
 * could watch it agree with their hand-built numbers before anything derived
 * from it. Residual subtraction (lib/schedule/residual.ts) is that derivation —
 * /api/sessions/expand now cuts residual blocks to what exclusive claims leave
 * them, for every audience. Sections 4 and 4b pin the new contract; section 5
 * covers the panel that took the shadow panel's slot.
 *
 * The arithmetic is the product's premise — a facility subtracts its bookings
 * from its lanes by hand and types the remainder into a public PDF — so every
 * rule in §4 of the plan gets its own fixture here, and each one is read back
 * off a rendered surface rather than from a function call:
 *
 *  §4.1/4.2  bands cut at every claim edge, `available = claimed − taken`
 *  §4.4      adjacent bands merge on the LABEL, not the number: 5 lanes and 6
 *            lanes both read "More than 4 lanes available" and become one band
 *            carrying the lower count, which is the rule that keeps a public
 *            schedule from fragmenting into several rows an hour
 *  §4.3      a stretch with nothing left is not "0 lanes" — the block does not
 *            exist then, and is reported separately
 *
 * Two things beyond the arithmetic matter as much:
 *
 *  - **Shadow mode publishes nothing.** An anonymous read of the same week must
 *    be byte-for-byte the schedule it was before this stage: the block still
 *    claims all six lanes publicly, and no computed number appears anywhere in
 *    the payload. Section 4 is that assertion.
 *  - **The panel must see past its own schedule group.** The rentals live under
 *    a *different* group than the drop-in block they eat into — which is the
 *    whole reason the internal view exists — so a panel scoped to the editor's
 *    group would compute full availability and be confidently wrong. Section 3
 *    opens the editor on the Lengths group and requires the rentals to have been
 *    counted anyway.
 *
 * Usage: node scripts/verify/verify-aa.mjs [--app=http://localhost:3001] [--headed] [--shots=<dir>]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice("--shots=".length) ?? null;

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

function sessionCookiePairs(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [[COOKIE_NAME, value]];
  const chunks = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    chunks.push([`${COOKIE_NAME}.${n}`, value.slice(i, i + MAX)]);
  }
  return chunks;
}

async function api(pathname, cookieHeader, init = {}) {
  const res = await fetch(`${APP}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

// Monday, and the Sunday-start week containing it (migration 037's review key).
const DAY = "2026-10-05";
const WEEK_START = "2026-10-04";

const HOLDER = `ZZSwimClub${stamp}`;
// Distinctive enough that finding it in a whole page proves it reached the panel.
const SETUP = `ZZBulkheadTo25m${stamp}`;

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-aa ${stamp}`, slug: `zz-verify-aa-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-aa-${stamp}@example.invalid`;
  const password = `Za!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  ids.users.push(userData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookiePairs = sessionCookiePairs(signIn.session);
  const cookieHeader = cookiePairs.map(([n, v]) => `${n}=${v}`).join("; ");

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ Verify-AA Pool ${stamp}`,
        slug: `zz-verify-aa-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id, name")
      .single()
  ).data;

  // SIX lanes as six spaces. The calculator's unit is a `spaces` row, so a pool
  // modelled as one space could only ever say all-or-nothing — section 5 checks
  // that the product says so rather than implying a precision it lacks.
  const lanes = [];
  for (let i = 1; i <= 6; i++) {
    lanes.push(
      (
        await admin
          .from("spaces")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            name: `Lane ${i} ${stamp}`,
            slug: `lane-${i}-${stamp}`,
            display_order: i,
            is_published: true,
          })
          .select("id, name")
          .single()
      ).data
    );
  }

  async function makeScheduleGroup(label) {
    return (
      await admin
        .from("schedule_groups")
        .insert({
          org_id: org.id,
          facility_id: facility.id,
          name: `ZZ ${label} ${stamp}`,
          slug: `zz-${label.toLowerCase()}-${stamp}`,
          sport_category: "swimming",
          activity_type: "drop_in",
          status: "published",
          starts_on: "2026-10-01",
          ends_on: "2026-12-31",
          source: "manual",
        })
        .select("id, name")
        .single()
    ).data;
  }

  // Two groups, because that is how the data really looks: the public drop-in
  // schedule and the bookings that eat into it are authored separately.
  const lengths = await makeScheduleGroup("Lengths");
  const bookings = await makeScheduleGroup("Bookings");

  for (const group of [lengths, bookings]) {
    await admin.from("schedule_week_reviews").insert({
      org_id: org.id,
      schedule_group_id: group.id,
      week_start: WEEK_START,
      status: "approved",
      reviewed_at: new Date().toISOString(),
    });
  }

  async function createSession(overrides) {
    const res = await api("/api/sessions", cookieHeader, {
      method: "POST",
      body: JSON.stringify({
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        valid_from: DAY,
        valid_until: null,
        ...overrides,
      }),
    });
    if (res.status >= 300) {
      throw new Error(`fixture session failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    return res.body.sessionId;
  }

  // The public block: six lanes, 6am-9am.
  const lengthsId = await createSession({
    schedule_group_id: lengths.id,
    dtstart: `${DAY}T06:00:00Z`,
    dtend_time: "09:00",
    space_ids: lanes.map((l) => l.id),
    occupancy_kind: "drop_in",
    disclosure: "public",
  });

  // The same block one day later, with nothing ever claiming it. Its whole job
  // is to still be whole at the end — see section 4b.
  const untouchedId = await createSession({
    schedule_group_id: lengths.id,
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    dtstart: "2026-10-06T06:00:00Z",
    dtend_time: "09:00",
    space_ids: lanes.map((l) => l.id),
    occupancy_kind: "drop_in",
    disclosure: "public",
  });

  // 6:00-7:00 — three lanes gone, three left ("3 or 4 lanes available").
  await createSession({
    schedule_group_id: bookings.id,
    dtstart: `${DAY}T06:00:00Z`,
    dtend_time: "07:00",
    space_ids: [lanes[0].id, lanes[1].id, lanes[2].id],
    occupancy_kind: "rental",
    disclosure: "reserved",
    holder_name: HOLDER,
    setup_notes: SETUP,
  });

  // 7:00-8:00 — five gone, one left ("Reduced lanes").
  await createSession({
    schedule_group_id: bookings.id,
    dtstart: `${DAY}T07:00:00Z`,
    dtend_time: "08:00",
    space_ids: [lanes[0].id, lanes[1].id, lanes[2].id, lanes[3].id, lanes[4].id],
    occupancy_kind: "program",
    disclosure: "public",
  });

  // 8:00-8:30 — one gone, five left. The half-hour after it has all six, and
  // both read "More than 4 lanes available", so §4.4 must merge them into ONE
  // band 8:00-9:00 carrying the lower count.
  await createSession({
    schedule_group_id: bookings.id,
    dtstart: `${DAY}T08:00:00Z`,
    dtend_time: "08:30",
    space_ids: [lanes[5].id],
    occupancy_kind: "program",
    disclosure: "public",
  });

  // A second block on a single lane, with a closure taking all of it for the
  // first half — the §4.3 case: not "0 lanes", but a stretch where the block
  // does not exist.
  const familyId = await createSession({
    schedule_group_id: lengths.id,
    dtstart: `${DAY}T12:00:00Z`,
    dtend_time: "13:00",
    space_ids: [lanes[5].id],
    occupancy_kind: "drop_in",
    disclosure: "public",
  });
  await createSession({
    schedule_group_id: bookings.id,
    dtstart: `${DAY}T12:00:00Z`,
    dtend_time: "12:30",
    space_ids: [lanes[5].id],
    occupancy_kind: "closure",
    disclosure: "public",
  });

  // Claims no space at all: there is no published lane count to compare, so the
  // calculator must skip it rather than invent a denominator.
  await createSession({
    schedule_group_id: lengths.id,
    dtstart: `${DAY}T15:00:00Z`,
    dtend_time: "16:00",
    space_ids: [],
    occupancy_kind: "drop_in",
    disclosure: "public",
  });

  // An *exclusive* claim with no space recorded. It can take nothing away from
  // anything — subtraction needs a lane to subtract — but it is still a booking
  // that exists, and a staff list that quietly omitted it would be worse than one
  // that never had it. The deck sheet keeps a whole `unplaced` section for the
  // same reason; section 5 requires the panel to list it and say so.
  await createSession({
    schedule_group_id: bookings.id,
    dtstart: `${DAY}T17:00:00Z`,
    dtend_time: "18:00",
    space_ids: [],
    occupancy_kind: "closure",
    disclosure: "public",
  });

  const lengthsKey = `${lengthsId}_${DAY}`;
  const familyKey = `${familyId}_${DAY}`;

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await context.addCookies(
      cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
    );
    const page = await context.newPage();

    console.log("\n1. The bands, on the deck sheet: cut at every claim edge, counted, labelled");
    await page.goto(`${APP}/dashboard/schedule/deck?facility=${facility.id}&date=${DAY}`, {
      waitUntil: "networkidle",
    });
    await page.locator(`[data-deck-sheet="${DAY}"]`).waitFor({ timeout: 30000 });

    const lengthsAvailability = page.locator(`[data-deck-availability="${lengthsKey}"]`);
    check(
      "the six-lane block reports computed availability at all",
      (await lengthsAvailability.count()) === 1
    );
    const bandText = (await lengthsAvailability.innerText()).replace(/\s+/g, " ");
    check(
      "6:00–7:00 with three lanes rented reads 3 of 6",
      /6:00am – 7:00am: 3 of 6 free/.test(bandText),
      bandText
    );
    check(
      "7:00–8:00 with five taken reads 1 of 6",
      /7:00am – 8:00am: 1 of 6 free/.test(bandText),
      bandText
    );
    check(
      "and it names who is holding the rest — the reason a guard reads this sheet",
      bandText.includes(HOLDER),
      bandText
    );

    console.log("\n2. §4.4 — adjacent bands merge on the LABEL, not the number");
    check(
      "8:00–8:30 (5 free) and 8:30–9:00 (6 free) are ONE band, not two",
      /8:00am – 9:00am: 5 of 6 free/.test(bandText) &&
        !/8:30am/.test(bandText),
      bandText
    );
    const bandLines = bandText.match(/\d+:\d+[ap]m – \d+:\d+[ap]m:/g) ?? [];
    check(
      "so the block publishes three bands over three hours rather than four",
      bandLines.length === 3,
      JSON.stringify(bandLines)
    );

    console.log("\n3. §4.3 — a stretch with nothing left is not 'zero lanes'");
    const familyAvailability = page.locator(`[data-deck-availability="${familyKey}"]`);
    const familyText = (await familyAvailability.innerText()).replace(/\s+/g, " ");
    check(
      "the closed half reads as nothing left, not as an availability count",
      /12:00pm – 12:30pm: nothing left/.test(familyText),
      familyText
    );
    check(
      "and the rest of the block still reports its one lane",
      /12:30pm – 1:00pm: 1 of 1 free/.test(familyText),
      familyText
    );

    console.log("\n4. The block is now CUT for the public — but its numbers still are not");
    // This section used to assert the opposite: shadow mode published nothing, so
    // the public block came back uncut on all six lanes. Residual subtraction
    // (lib/schedule/residual.ts) is the deliberate end of that — a drop-in block
    // now yields the lanes an exclusive claim takes, for every audience, because
    // publishing water a rental has taken is the error the whole feature exists
    // to stop.
    //
    // What has NOT changed, and is what the rest of this section still guards, is
    // that no *computed availability number or label* reaches a patron. Cutting a
    // block to the lanes it genuinely still holds is a fact about the bookings;
    // "3 or 4 lanes available" is the calculator's judgement, and that is still
    // staff-only until stage 6 says otherwise.
    const publicRes = await fetch(
      `${APP}/api/sessions/expand?facilityId=${facility.id}` +
        `&rangeStart=${DAY}T00:00:00.000Z&rangeEnd=2026-10-06T00:00:00.000Z`
    );
    const publicBody = await publicRes.json();
    const publicParts = (publicBody.data ?? []).filter((s) => s.sessionId === lengthsId);
    check(
      "the public block is cut into bands rather than published on all six lanes",
      publicParts.length > 1 && publicParts.every((p) => p.spaceIds.length <= 6),
      `${publicParts.length} part(s): ${JSON.stringify(publicParts.map((p) => p.spaceIds.length))}`
    );
    check(
      "at least one band lost lanes to the claim over it",
      publicParts.some((p) => p.spaceIds.length < 6),
      JSON.stringify(publicParts.map((p) => p.spaceIds.length))
    );
    check(
      "no band is published with zero lanes — that stretch is dropped, not advertised",
      publicParts.every((p) => p.spaceIds.length > 0),
      JSON.stringify(publicParts.map((p) => p.spaceIds.length))
    );
    const serialized = JSON.stringify(publicBody);
    check(
      "no computed availability reaches a public caller, by any field name",
      !/"available"|"bands"|"suppressed"|Reduced lanes|lanes available/.test(serialized),
      serialized.slice(0, 200)
    );
    check(
      "and the rental's holder is still withheld from them (migration 046 still holds)",
      !serialized.includes(HOLDER)
    );

    // A claim cuts its OWN day and no other. Worth its own section because the
    // first implementation of residual subtraction got this wrong in a way
    // nothing else here would have caught: it bounded occurrences by
    // minutes-from-midnight (copied from availability.ts, which is documented as
    // taking one day at a time and whose callers filter first) and was then
    // handed a whole week by /api/sessions/expand. Monday's 6–7am rental
    // therefore cut Tuesday's 6–9am block too — the two overlap perfectly once
    // the date is discarded. The fixture below is the minimum that reproduces
    // it: same lanes, same wall-clock hours, different weekday, nothing claiming
    // it at all.
    console.log("\n4b. A claim cuts its own day only");
    const twoDayRes = await fetch(
      `${APP}/api/sessions/expand?facilityId=${facility.id}` +
        `&rangeStart=${DAY}T00:00:00.000Z&rangeEnd=2026-10-07T00:00:00.000Z`
    );
    const twoDayBody = await twoDayRes.json();
    const tuesdayParts = (twoDayBody.data ?? []).filter((s) => s.sessionId === untouchedId);
    check(
      "the untouched Tuesday block comes back whole — one occurrence, not bands",
      tuesdayParts.length === 1,
      `${tuesdayParts.length} part(s): ${JSON.stringify(
        tuesdayParts.map((p) => `${p.start?.slice(11, 16)}-${p.end?.slice(11, 16)}`)
      )}`
    );
    check(
      "…keeping every one of its six lanes",
      tuesdayParts[0]?.spaceIds?.length === 6,
      JSON.stringify(tuesdayParts[0]?.spaceIds?.length)
    );
    check(
      "…and its own hours, untouched by Monday's 6-7am rental",
      tuesdayParts[0]?.start?.slice(11, 16) === "06:00" &&
        tuesdayParts[0]?.end?.slice(11, 16) === "09:00",
      `${tuesdayParts[0]?.start?.slice(11, 16)}-${tuesdayParts[0]?.end?.slice(11, 16)}`
    );
    // Positive control: the same range must still show Monday genuinely cut, or
    // the three checks above would pass just as well against a build that had
    // stopped subtracting altogether.
    check(
      "positive control — Monday's block IS still cut in the same payload",
      (twoDayBody.data ?? []).filter((s) => s.sessionId === lengthsId).length > 1,
      `${(twoDayBody.data ?? []).filter((s) => s.sessionId === lengthsId).length}`
    );

    console.log("\n5. The staff claims panel, and the scope trap it inherits");
    await page.goto(
      `${APP}/dashboard/schedule?facility=${facility.id}&schedule=${lengths.id}&week=${WEEK_START}`,
      { waitUntil: "networkidle" }
    );
    // Replaced the availability shadow panel, which asked whether a drop-in block
    // published more space than the bookings left it. Residual subtraction answers
    // that by construction now — section 4 is where it is proven — so the slot
    // carries what staff still cannot get anywhere else: what is booked, who has
    // it, and what it needs set up.
    const summary = page.getByRole("button", { name: /Booked space/ });
    await summary.waitFor({ timeout: 30000 });
    const summaryText = (await summary.innerText()).replace(/\s+/g, " ");
    check(
      "the collapsed line counts claims by kind rather than as one undifferentiated total",
      /rental/i.test(summaryText),
      summaryText
    );
    check(
      "…and says how many carry setup notes, which is the reason to open it",
      /setup notes/.test(summaryText),
      summaryText
    );

    await summary.click();
    const panelText = (
      await page.locator("text=All bookings at this building this week").locator("..").innerText()
    ).replace(/\s+/g, " ");

    // The editor is open on the Lengths group; this holder belongs to a rental in
    // the Bookings group. Its name can only be here if the panel fetched the whole
    // facility — the one mistake that would make the list quietly incomplete, and
    // the reason this assertion outlived the panel it was written for.
    check(
      "it names a holder from ANOTHER schedule group, which is the proof it looked past the editor's scope",
      panelText.includes(HOLDER),
      panelText.slice(0, 300)
    );
    check(
      "the staff-only setup note is on it",
      panelText.includes(SETUP),
      panelText.slice(0, 400)
    );
    check(
      "each claim says what patrons are told about it",
      /Patrons see/.test(panelText),
      panelText.slice(0, 400)
    );
    check(
      "an exclusive claim with no space recorded is listed, and says it takes nothing away",
      /No space recorded/.test(panelText),
      panelText.slice(0, 500)
    );
    // Drop-in blocks are residual — they hold nothing of their own, so listing them
    // here would be a category error, and would bury the bookings that matter under
    // every open swim in the week.
    check(
      "drop-in blocks are NOT listed — they take whatever the claims leave",
      !/Drop-in/.test(panelText.replace(/Drop-in blocks are not listed[^.]*\./, "")),
      panelText.slice(0, 500)
    );

    // Filtering by kind. The fixture has all three, which is what makes this
    // fixture the right place to test it.
    const panel = page.locator("text=All bookings at this building this week").locator("..");
    const rentalChip = panel.getByRole("button", { name: /^Rental or club/ });
    check(
      "a chip is offered for each kind the week has",
      (await panel.getByRole("button", { name: /^Program or lesson/ }).count()) === 1 &&
        (await rentalChip.count()) === 1 &&
        (await panel.getByRole("button", { name: /^Closure or maintenance/ }).count()) === 1,
      await panel.getByRole("button").allInnerTexts().then((t) => JSON.stringify(t))
    );

    await rentalChip.click();
    const filtered = (await panel.innerText()).replace(/\s+/g, " ");
    check(
      "filtering to rentals keeps the rental",
      filtered.includes(HOLDER),
      filtered.slice(0, 400)
    );
    check(
      "…and drops the other kinds outright, days and all",
      !/Program or lesson|Closure or maintenance/.test(
        // The chips themselves name every kind; it is the LIST below them that
        // must narrow, so they are removed before the text is searched.
        filtered.replace(/All \d+.*?(?=Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|$)/, "")
      ),
      filtered.slice(0, 400)
    );
    check(
      // Five exclusive claims in this fixture, one of them a rental. The point is
      // that this still reads 5 while filtered to that one rental — a count that
      // moved when you pressed it could not be used to compare one week to another.
      "the chip counts still describe the whole week, not the filtered view",
      /All 5/.test(filtered),
      filtered.slice(0, 200)
    );

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, "claims-panel.png"), fullPage: true });
    }
  } finally {
    await browser.close();
  }
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

  const { data: leftover } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftover?.length ?? 0} org(s) left over${
      leftover?.length ? ` — ${leftover.map((o) => o.name).join(", ")}` : ""
    }`
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
