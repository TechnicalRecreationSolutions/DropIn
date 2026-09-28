/**
 * Staff (`aux`) experience: reporting a problem, and what the role no longer sees.
 *
 * The claims worth doubting:
 *
 *   1. **A staffer whose organization keeps publishing for managers can still
 *      REPORT** (migration 063). The row is forced unpublished and flagged
 *      `needs_review` whatever the request body says — asserted with a body
 *      that asks to publish.
 *   2. **063's policy is insert-only and narrow.** Direct PostgREST as the
 *      staffer: a well-formed report is accepted (the positive control), and
 *      each of published / not-flagged / out-of-scope / forged created_by /
 *      update / delete is refused.
 *   3. **Review closes the flag.** Publishing a report clears needs_review and
 *      puts it in front of the public; dismissing it ends it. Both are writes
 *      the staffer cannot make.
 *   4. **Reports reach the people who can act on them** — the Overview alert
 *      row for an owner and an in-scope coordinator, NOT for a coordinator of
 *      another building.
 *   5. **The status page is reachable from where staff are** — the schedule
 *      and Head counts pages link to it, the mobile bar has a Status tab, and
 *      /dashboard/status resolves to the staffer's one facility.
 *   6. **Head counts renders cleanly on a phone once a reading exists** — no
 *      hydration error (reading times used the runtime's locale on both
 *      sides and disagreed), and the temperature Save buttons inside the card.
 *   7. **POST /api/facilities refuses a staffer's EDIT with a 403.** It used
 *      to answer 200 {ok:true} while RLS silently updated zero rows.
 *   8. **Write affordances are gone for aux and still there for a
 *      coordinator** — "Add session", the Activity log (page, API and icon),
 *      the editor routes. Both directions, or a page that 500'd for everyone
 *      would pass.
 *
 * Before 063 is applied, sections 2-4 are skipped and section 1 instead
 * asserts the route's 503 ("reporting is not switched on yet") rather than an
 * opaque failure.
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-be.mjs [--headed]
 *   node --experimental-strip-types scripts/verify/verify-be.mjs --logic-only
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const LOGIC_ONLY = process.argv.includes("--logic-only");
const HEADED = process.argv.includes("--headed");

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

// ── Section 0: the predicates, no database, no server ───────────────────────
async function logicSection() {
  console.log("\n0. canReportNotice / canWriteNotice / splitStatusRows (no database, no server)");
  const { canReportNotice, canWriteNotice } = await import("../../src/lib/auth/roles.ts");
  const { splitStatusRows } = await import("../../src/lib/status/notices.ts");

  const F = "fac-1";
  const aux = { role: "aux", scopes: { departmentIds: [], facilityIds: [F] } };
  const coord = { role: "coordinator", scopes: { departmentIds: ["d"], facilityIds: [F] } };
  const manager = { role: "manager", scopes: { departmentIds: [], facilityIds: [] } };

  check("aux may report in scope", canReportNotice(aux, F));
  check("aux may not report outside scope", !canReportNotice(aux, "fac-2"));
  check("aux may not report with no facility named (fail closed)", !canReportNotice(aux, null));
  check("a coordinator never takes the report path (they can post)", !canReportNotice(coord, F));
  check("a manager never takes the report path", !canReportNotice(manager, F));
  check("aux cannot POST with the switch off", !canWriteNotice(aux, { auxCanPostNotices: false }, F));
  check("aux can POST with the switch on", canWriteNotice(aux, { auxCanPostNotices: true }, F));

  const at = (m) => new Date(Date.now() + m * 60_000).toISOString();
  const rows = [
    { id: "info", headline: "i", severity: "info", is_published: true, starts_at: at(-5), ends_at: null },
    { id: "closure", headline: "c", severity: "closure", is_published: true, starts_at: at(-60), ends_at: null },
    { id: "report", headline: "r", severity: "closure", is_published: false, starts_at: at(-1), ends_at: null, needs_review: true },
    { id: "dismissed", headline: "d", severity: "closure", is_published: false, starts_at: at(-30), ends_at: at(-1), needs_review: true },
    { id: "internal", headline: "n", severity: "caution", is_published: false, starts_at: at(-1), ends_at: null },
  ];
  const split = splitStatusRows(rows);
  check("live is worst-first and excludes unpublished rows",
    split.live.map((n) => n.id).join(",") === "closure,info", split.live.map((n) => n.id).join(","));
  // FALSIFY: drop `!isNoticeFinished` from pendingCount and this reads 2.
  check("pendingCount counts open reports only (not internal notes, not finished)",
    split.pendingCount === 1, String(split.pendingCount));
  check("a row with no needs_review (pre-063) is never a report",
    splitStatusRows([{ ...rows[4] }]).pendingCount === 0);
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
// Never signed in — see verify-az for why this must be a separate client.
const publicAnon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

function cookiePartsFor(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) {
    parts.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
  }
  return parts;
}

async function api(pathname, cookie, init = {}) {
  const res = await fetch(`${APP}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: res.status, body };
}

const stamp = Date.now().toString(36);
const ids = { orgs: [], users: [] };

async function makeUser(orgId, role, label, scopeFacilityId = null) {
  const email = `zz-be-${label}-${stamp}@example.invalid`;
  const password = `Zz!${stamp}aA9`;
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

  const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${label}: ${sErr.message}`);
  const cookieParts = cookiePartsFor(signed.session);
  // A PostgREST client that IS this user, for the direct-policy assertions.
  const client = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });

  return {
    userId: data.user.id,
    email,
    cookieParts,
    cookie: cookieParts.map((c) => `${c.name}=${c.value}`).join("; "),
    client,
  };
}

async function main() {
  await logicSection();

  const { error: probe } = await admin.from("facility_notices").select("needs_review").limit(1);
  const has063 = !probe;
  console.log(`\n  migration 063: ${has063 ? "applied" : "NOT applied — sections 2-4 skip, section 1 asserts the 503"}`);

  const { data: org, error: oErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ staff ${stamp}`, slug: `zz-staff-${stamp}`, status: "active", aux_can_post_notices: false })
    .select("id")
    .single();
  if (oErr) throw new Error(`org: ${oErr.message}`);
  ids.orgs.push(org.id);

  const mkFacility = async (name) => {
    const { data, error } = await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ ${name} ${stamp}`,
        slug: `zz-be-${name}-${stamp}`,
        address_line1: "1 Test St",
        city: "Victoria",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id, slug")
      .single();
    if (error) throw new Error(`facility ${name}: ${error.message}`);
    return data;
  };
  const pool = await mkFacility("pool");
  const arena = await mkFacility("arena");

  const owner = await makeUser(org.id, "owner", "owner");
  const guard = await makeUser(org.id, "aux", "guard", pool.id);
  const coord = await makeUser(org.id, "coordinator", "coord", pool.id);
  const arenaCoord = await makeUser(org.id, "coordinator", "arenacoord", arena.id);

  const noticesPath = (fid) => `/api/facilities/${fid}/notices`;
  const fouling = (over = {}) => ({
    category: "water_quality",
    severity: "closure",
    headline: `ZZ Pool closed — contamination ${stamp}`,
    body: "Found at 14:10.",
    // Deliberately ASKS to publish: the report path must ignore it.
    is_published: true,
    ...over,
  });

  // ── 1. The report path through the route ──────────────────────────────────
  console.log("\n1. A staffer reports, with the switch off");
  const reported = await api(noticesPath(pool.id), guard.cookie, { method: "POST", body: JSON.stringify(fouling()) });
  let reportId = null;
  if (has063) {
    check("the report is accepted", reported.status === 201, `${reported.status} ${JSON.stringify(reported.body)}`);
    const n = reported.body.notice ?? {};
    reportId = n.id;
    check("...forced unpublished though the body asked to publish", n.is_published === false, String(n.is_published));
    check("...and flagged for review", n.needs_review === true, String(n.needs_review));
    check("...with the reporter on the record", n.created_by === guard.userId);
    const { data: pub } = await publicAnon.from("facility_notices").select("id").eq("facility_id", pool.id);
    check("the public cannot see a report", !(pub ?? []).some((r) => r.id === reportId));
  } else {
    check("before 063, the route says reporting is not on yet (503), not a bare 400",
      reported.status === 503, `${reported.status} ${JSON.stringify(reported.body)}`);
  }

  const outOfScope = await api(noticesPath(arena.id), guard.cookie, { method: "POST", body: JSON.stringify(fouling()) });
  check("a staffer cannot report at a building outside their scope", outOfScope.status === 403, String(outOfScope.status));

  // ── 2. 063's policy, directly ─────────────────────────────────────────────
  console.log("\n2. The report policy against PostgREST directly");
  if (!has063) {
    skipped("section 2", "migration 063 not applied");
  } else {
    const base = {
      facility_id: pool.id,
      org_id: org.id,
      category: "water_quality",
      severity: "closure",
      headline: `ZZ direct ${stamp}`,
      is_published: false,
      needs_review: true,
      created_by: guard.userId,
    };
    const ins = (over) => guard.client.from("facility_notices").insert({ ...base, ...over }).select("id").single();

    // THE POSITIVE CONTROL — every refusal below means nothing without it.
    const ok = await ins({});
    check("a well-formed report is accepted (positive control)", !ok.error, ok.error?.message);

    const refusals = [
      ["published", { is_published: true }],
      ["not flagged (a silent internal note)", { needs_review: false }],
      ["outside scope", { facility_id: arena.id }],
      ["created_by forged as the owner", { created_by: owner.userId }],
      ["already ended", { ends_at: new Date(Date.now() + 3_600_000).toISOString() }],
    ];
    for (const [label, over] of refusals) {
      const r = await ins(over);
      check(`refused: ${label}`, !!r.error, "was accepted");
    }

    if (ok.data) {
      const upd = await guard.client.from("facility_notices").update({ headline: "hijack" }).eq("id", ok.data.id).select("id");
      check("the staffer cannot UPDATE their report", (upd.data ?? []).length === 0, JSON.stringify(upd.data));
      const del = await guard.client.from("facility_notices").delete().eq("id", ok.data.id).select("id");
      check("the staffer cannot DELETE their report", (del.data ?? []).length === 0, JSON.stringify(del.data));
      const ownerFlip = await owner.client.from("facility_notices").update({ is_published: true }).eq("id", ok.data.id).select("id");
      check("the CHECK refuses a published notice still flagged for review", !!ownerFlip.error, "accepted");
    }
  }

  // ── 3. Review ─────────────────────────────────────────────────────────────
  console.log("\n3. Publishing and dismissing");
  if (!has063 || !reportId) {
    skipped("section 3", has063 ? "no report was created in section 1" : "migration 063 not applied");
  } else {
    const guardPublish = await api(`${noticesPath(pool.id)}/${reportId}`, guard.cookie, {
      method: "PATCH", body: JSON.stringify({ is_published: true }),
    });
    check("the staffer cannot publish their own report", guardPublish.status === 403, String(guardPublish.status));

    const published = await api(`${noticesPath(pool.id)}/${reportId}`, owner.cookie, {
      method: "PATCH", body: JSON.stringify({ is_published: true }),
    });
    check("an owner publishes it", published.status === 200, `${published.status} ${JSON.stringify(published.body)}`);
    check("...which clears the review flag", published.body.notice?.needs_review === false);
    const { data: pub } = await publicAnon.from("facility_notices").select("id").eq("facility_id", pool.id);
    check("...and the public can now see it", (pub ?? []).some((r) => r.id === reportId));

    const second = await api(noticesPath(pool.id), guard.cookie, {
      method: "POST", body: JSON.stringify(fouling({ headline: `ZZ second ${stamp}` })),
    });
    // Sent from a phone whose clock is 5 s SLOW. starts_at came from the
    // server's clock a moment ago, so a route that trusted this ends_at would
    // trip 060's window CHECK (ends_at > starts_at) and answer 400 — exactly
    // what production did, where the harness and Vercel are two clocks.
    // FALSIFY: drop the clamp in the [noticeId] PATCH route and this goes red.
    const dismissed = await api(`${noticesPath(pool.id)}/${second.body.notice?.id}`, coord.cookie, {
      method: "PATCH", body: JSON.stringify({ ends_at: new Date(Date.now() - 5_000).toISOString() }),
    });
    check("an in-scope coordinator dismisses a report, from a phone 5 s slow", dismissed.status === 200, `${dismissed.status} ${JSON.stringify(dismissed.body)}`);
    check("...which clears the flag", dismissed.body.notice?.needs_review === false);
  }

  // ── 4. Who is told ────────────────────────────────────────────────────────
  console.log("\n4. The Overview alert");
  if (!has063) {
    skipped("section 4", "migration 063 not applied");
  } else {
    const waiting = await api(noticesPath(pool.id), guard.cookie, {
      method: "POST", body: JSON.stringify(fouling({ headline: `ZZ WAITING ${stamp}` })),
    });
    check("fixture: a waiting report exists", waiting.status === 201, String(waiting.status));
    const seen = async (who) => (await (await fetch(`${APP}/dashboard?facility=${arena.id}`, { headers: { Cookie: who.cookie } })).text()).includes(`ZZ WAITING ${stamp}`);
    // Asked with the ARENA selected: the alert is org-wide on purpose, so the
    // owner must see a pool report while looking at another building.
    check("the owner sees it on the Overview, even with another facility selected", await seen(owner));
    check("an in-scope coordinator sees it", await seen(coord));
    check("a coordinator of another building does not", !(await seen(arenaCoord)));
  }

  // ── 5 & 6. In a browser ───────────────────────────────────────────────────
  console.log("\n5-6. Reachability and removed affordances, in a browser");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const open = async (who, viewport, extra = {}) => {
      const context = await browser.newContext({ viewport, ...extra });
      await context.addCookies(who.cookieParts.map((c) => ({ ...c, url: APP, httpOnly: false, secure: false })));
      return { context, page: await context.newPage() };
    };
    const landOn = async (page, path) => {
      await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
      return new URL(page.url()).pathname;
    };
    const statusPath = `/dashboard/facilities/${pool.id}/status`;

    // Staff, phone.
    {
      const { context, page } = await open(guard, { width: 390, height: 844 });
      await landOn(page, "/dashboard/schedule");
      const main = page.locator("main");
      check("aux schedule: no Add session", (await main.getByRole("link", { name: /add session/i }).count()) === 0);
      check("aux schedule: titled Schedule, not Manage",
        (await page.getByRole("heading", { name: "Schedule", exact: true }).count()) > 0);
      check("aux schedule: a Report a problem link to their facility",
        (await main.locator(`a[href="${statusPath}"]`, { hasText: /report a problem/i }).count()) > 0);
      const nav = page.getByRole("navigation", { name: "Primary" });
      check("aux phone: the bottom bar has a Status tab", (await nav.getByRole("link", { name: "Status" }).count()) === 1);
      check("aux phone: no Today, no Activity tab",
        (await nav.getByRole("link", { name: /today|activity/i }).count()) === 0);

      check("aux: /dashboard/status resolves to their one facility", (await landOn(page, "/dashboard/status")) === statusPath);

      await landOn(page, "/dashboard/counts");
      check("aux counts: Report a problem is there too",
        (await page.locator("main").locator(`a[href="${statusPath}"]`, { hasText: /report a problem/i }).count()) > 0);

      // The whole flow, by tapping.
      await landOn(page, statusPath);
      if (has063) {
        await page.getByRole("button", { name: /fecal \/ vomit/i }).click();
        await page.getByLabel(/what patrons would read/i).fill(`ZZ TAPPED ${stamp}`);
        await page.getByRole("button", { name: /send to a manager/i }).click();
        await page.getByText(/^Sent\./).waitFor({ timeout: 10_000 }).catch(() => {});
        check("aux phone: tapping the preset and Send files a report",
          (await page.getByText(/^Sent\./).count()) > 0);
        // Without a reload: router.refresh() must bring it in by itself, or a
        // staffer taps Send and sees no sign of the report on the page.
        const tapped = page.getByText(`ZZ TAPPED ${stamp}`);
        const t0 = Date.now();
        const inPlace = await tapped.first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
        check("...and it appears under Waiting for approval without a reload", inPlace,
          `not there after ${Date.now() - t0}ms`);
        if (!inPlace) {
          await page.reload({ waitUntil: "networkidle" });
          console.log(`        (after a reload it is ${(await tapped.count()) > 0 ? "there — a refresh problem" : "STILL missing — not saved or not read"})`);
        }
        check("...with no Publish button for the staffer",
          (await page.getByRole("button", { name: "Publish" }).count()) === 0);
      } else {
        skipped("the tap-through report", "migration 063 not applied");
      }
      check("aux status page: no greyed public-conditions form",
        (await page.getByText(/what patrons see from/i).count()) === 0);
      await context.close();
    }

    // Staff, phone: Head counts with a reading in the log.
    {
      const { error: rErr } = await admin.from("facility_readings").insert({
        facility_id: pool.id, org_id: org.id, metric: "headcount", value: 12, recorded_by: guard.userId,
      });
      check("fixture: a reading exists", !rErr, rErr?.message);
      // A browser locale that DIFFERS from the server's is the whole test: the
      // bug was the server formatting in its locale and the phone in another.
      // The dev server shares this process's machine, so pick against ours —
      // en-GB writes "22:46", en-US "10:46 PM", en-CA "10:46 p.m.". A fixed
      // choice passed vacuously on a machine whose Node already used it.
      const serverLocale = Intl.DateTimeFormat().resolvedOptions().locale;
      const phoneLocale = serverLocale.startsWith("en-GB") ? "en-US" : "en-GB";
      const { context, page } = await open(guard, { width: 390, height: 844 }, { locale: phoneLocale });
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      await landOn(page, "/dashboard/counts");
      await page.waitForTimeout(1000);
      const hydration = errors.filter((e) => /hydrat/i.test(e));
      // FALSIFY: render formatRecordedAt during SSR again and this goes red.
      check("aux counts: no hydration error with a reading in the log", hydration.length === 0, hydration[0]?.slice(0, 160));
      check("aux counts: the reading time is shown after hydration",
        (await page.getByText(/^Last count 12 at \d/).count()) > 0);
      const card = await page.getByText("Temperature", { exact: true }).locator("xpath=..").boundingBox();
      const saves = await page.getByRole("button", { name: "Save" }).evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().right)
      );
      check("aux counts: temperature Save buttons sit inside their card at 390px",
        !!card && saves.length === 2 && saves.every((r) => r <= card.x + card.width + 0.5),
        `card right ${card && card.x + card.width}, buttons ${saves.join(",")}`);
      await context.close();
    }

    // Staff, desktop: the guards.
    {
      const { context, page } = await open(guard, { width: 1440, height: 900 });
      await landOn(page, "/dashboard/schedule");
      check("aux desktop: no Activity log icon", (await page.locator('a[href="/dashboard/activity"]').count()) === 0);
      check("aux desktop: no Overview in the sidebar",
        (await page.getByRole("link", { name: "Overview", exact: true }).count()) === 0);
      check("aux desktop: Facility status in the sidebar",
        (await page.getByRole("link", { name: "Facility status" }).count()) > 0);
      check("aux desktop: the profile says Staff, not Aux",
        (await page.getByText("Staff", { exact: true }).count()) > 0 && (await page.getByText("Aux", { exact: true }).count()) === 0);
      for (const p of ["/dashboard/activity", "/dashboard/sessions/new", "/dashboard/schedule/sessions/new", "/dashboard/widget", "/dashboard/facilities"]) {
        check(`aux: ${p} redirects to the schedule`, (await landOn(page, p)) === "/dashboard/schedule", `landed ${new URL(page.url()).pathname}`);
      }
      await context.close();
    }

    // Coordinator: the other direction.
    {
      const { context, page } = await open(coord, { width: 1440, height: 900 });
      await landOn(page, `/dashboard/schedule?facility=${pool.id}`);
      check("coordinator schedule: Add session is still there",
        (await page.locator("main").getByRole("link", { name: /add session/i }).count()) > 0);
      check("coordinator: the Activity icon is still there",
        (await page.locator('a[href="/dashboard/activity"]').count()) > 0);
      for (const p of ["/dashboard/activity", "/dashboard/schedule/sessions/new"]) {
        check(`coordinator: ${p} still opens`, (await landOn(page, p)) === p, `landed ${new URL(page.url()).pathname}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const facilityEdit = {
    facilityId: pool.id, name: "hijacked", address_line1: "1 Test St", city: "Victoria",
    province: "BC", postal_code: "V0V 0V0",
  };
  const guardEdit = await api("/api/facilities", guard.cookie, { method: "POST", body: JSON.stringify(facilityEdit) });
  check("aux: editing a facility is 403, not a 200 no-op", guardEdit.status === 403, `${guardEdit.status} ${JSON.stringify(guardEdit.body)}`);
  const { data: stillNamed } = await admin.from("facilities").select("name").eq("id", pool.id).single();
  check("...and the name is unchanged", stillNamed?.name !== "hijacked");
  const ownerEdit = await api("/api/facilities", owner.cookie, {
    method: "POST", body: JSON.stringify({ ...facilityEdit, name: `ZZ pool renamed ${stamp}` }),
  });
  check("owner: the same edit succeeds (positive control)", ownerEdit.status === 200, `${ownerEdit.status} ${JSON.stringify(ownerEdit.body)}`);

  const guardActivity = await api("/api/activity", guard.cookie);
  const coordActivity = await api("/api/activity", coord.cookie);
  check("aux: /api/activity is 403", guardActivity.status === 403, String(guardActivity.status));
  check("coordinator: /api/activity is 200 (positive control)", coordActivity.status === 200, String(coordActivity.status));
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.stack ?? e.message}`); })
  .finally(async () => {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
    console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
