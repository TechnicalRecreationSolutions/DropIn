/**
 * Dashboard navigation timing harness.
 *
 * Answers one question with numbers instead of impressions: when you click a
 * sidebar link, how long is the page a skeleton?
 *
 * It measures in two layers, because they answer different halves of that.
 *
 * **Server (HTTP)** — each route fetched two ways:
 *
 *   - `document` — a full page load (`GET /dashboard/x`), the way a refresh or
 *     a first visit arrives. TTFB is when the prerendered shell lands; total is
 *     when the last Suspense boundary has streamed in.
 *   - `rsc` — what the router fetches on a *client* navigation (same URL with
 *     the `RSC: 1` header).
 *
 *   This layer measures only what the server does. It cannot see the client
 *   router's prefetch cache, so a change that makes navigation instant by
 *   serving a prefetched App Shell shows up here as *no change at all*.
 *
 * **Browser (Playwright)** — a real signed-in Chromium clicks the real sidebar
 * links and measures, from the click:
 *
 *   - `paint` — the destination's own heading is on screen (its static shell).
 *   - `settled` — no `aria-busy` element is left in `<main>`, i.e. every
 *     skeleton has been replaced by real content.
 *
 *   `settled − paint` is the window the user described as "an empty screen
 *   where you can see the shadow of the CTAs". This is the number to move.
 *
 * Same pattern as the verify-*.mjs harnesses — service-role fixtures, a real
 * signed-in session driving the live routes, teardown in a `finally`. It
 * asserts nothing; it prints two tables. Run it before and after a change.
 *
 *   npm run dev
 *   node scripts/verify/perf-nav.mjs
 *
 * Flags: `--runs=N` (samples per measurement, default 5; the tables report the
 * median), `--http-only`, `--browser-only`.
 *
 * The first hit of each route in `next dev` also pays Turbopack compilation, so
 * every route is warmed once and the warm-up run is discarded. Numbers from
 * `next dev` are still only comparable to other `next dev` numbers.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

// Defaults to the dev server. Point it at a `next start` on another port to
// get numbers that mean something: dev timings include Turbopack compilation
// and re-render prefetches that production serves from cache.
//   NEXT_DIST_DIR=.next-perf npx next build
//   NEXT_DIST_DIR=.next-perf npx next start -p 3001
//   node scripts/verify/perf-nav.mjs --app=http://localhost:3001
const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 5);
const HTTP = !process.argv.includes("--browser-only");
const BROWSER = !process.argv.includes("--http-only");

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

/**
 * One timed request. `ttfb` is the first byte of the response body — under
 * Cache Components that is the prerendered shell, not the finished page — and
 * `total` is the last byte, i.e. every Suspense boundary resolved.
 *
 * The body has to be drained for `total` to mean anything: with a streamed
 * response, `await fetch()` resolves as soon as the headers arrive.
 */
async function timeOnce(path, cookie, rsc) {
  const url = `${APP}${path}`;
  const started = performance.now();
  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      // What next/link sends on a client-side navigation. Without it the
      // server returns the full HTML document instead of the RSC payload.
      // `Next-Url` tells the server which layouts the client already has, so
      // it re-renders only what is below the shared one — the same scope a
      // real sidebar click produces.
      ...(rsc ? { RSC: "1", "Next-Url": path.split("?")[0] } : {}),
    },
    redirect: "manual",
  });

  const reader = res.body.getReader();
  let ttfb = null;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfb === null) ttfb = performance.now() - started;
    bytes += value.length;
  }

  return {
    status: res.status,
    location: res.headers.get("location"),
    ttfb: ttfb ?? performance.now() - started,
    total: performance.now() - started,
    bytes,
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The router puts a `_rsc` cache-busting hash on every RSC request, and Next
 * 307-redirects one that arrives without it — the value is derived server-side,
 * so it can't be fabricated. One throwaway request per route reads the hash out
 * of the redirect's Location; every timed request then goes straight to the
 * real render.
 */
async function resolveRscPath(path, cookie) {
  const res = await fetch(`${APP}${path}`, {
    headers: { Cookie: cookie, RSC: "1", "Next-Url": path },
    redirect: "manual",
  });
  await res.body?.cancel();
  const location = res.headers.get("location");
  return res.status === 307 && location?.includes("_rsc=") ? location : path;
}

async function measure(path, cookie, rsc) {
  if (rsc) path = await resolveRscPath(path, cookie);
  await timeOnce(path, cookie, rsc); // warm-up: discards Turbopack compilation
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await timeOnce(path, cookie, rsc));
  const bad = runs.find((r) => r.status !== 200);
  return {
    status: bad ? bad.status : 200,
    location: bad?.location ?? null,
    ttfb: median(runs.map((r) => r.ttfb)),
    total: median(runs.map((r) => r.total)),
    bytes: median(runs.map((r) => r.bytes)),
  };
}

const ids = { users: [], orgs: [] };
const stamp = Date.now();

try {
  // ---------------------------------------------------------------
  // Fixture: one org with enough of a tree that the dashboard queries
  // return real rows. Row counts barely matter here — the cost being
  // measured is per-round-trip latency to hosted Supabase — but an org
  // with nothing in it renders empty states and skips work the real
  // dashboard does.
  // ---------------------------------------------------------------
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `ZZ perf-nav ${stamp}`, slug: `zz-perf-nav-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (orgErr) throw new Error(`org insert: ${orgErr.message}`);
  ids.orgs.push(orgRow.id);

  const email = `zz-perf-nav-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`createUser: ${userErr.message}`);
  ids.users.push(userData.user.id);

  const { error: memberErr } = await admin
    .from("org_memberships")
    .insert({ org_id: orgRow.id, user_id: userData.user.id, role: "admin" });
  if (memberErr) throw new Error(`org_memberships insert: ${memberErr.message}`);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: orgRow.id,
        name: `ZZ Perf Pool ${stamp}`,
        slug: `zz-perf-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
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
        org_id: orgRow.id,
        facility_id: facility.id,
        name: "Aquatics",
        slug: `aquatics-${stamp}`,
        is_published: true,
        display_order: 0,
      })
      .select("id")
      .single()
  ).data;

  for (const [i, name] of ["Lane pool", "Leisure pool", "Hot tub"].entries()) {
    await admin.from("spaces").insert({
      org_id: orgRow.id,
      facility_id: facility.id,
      department_id: department.id,
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      is_published: true,
      display_order: i,
    });
  }

  for (const [i, name] of ["Lane swim", "Aquafit", "Family swim", "Lessons"].entries()) {
    await admin.from("session_templates").insert({
      org_id: orgRow.id,
      facility_id: facility.id,
      department_id: department.id,
      name,
      color: "#3B82F6",
      default_duration_minutes: 60,
      is_active: true,
      display_order: i,
    });
  }

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  // ---------------------------------------------------------------
  // The routes the sidebar links to — the ones a user clicks between.
  // ---------------------------------------------------------------
  const routes = [
    "/dashboard",
    "/dashboard/facilities",
    "/dashboard/schedule",
    "/dashboard/sessions",
    "/dashboard/spaces",
    "/dashboard/departments",
    "/dashboard/map",
    "/dashboard/widget",
    "/dashboard/activity",
    "/dashboard/analytics",
    "/dashboard/settings",
  ];

  const f = (n) => String(Math.round(n)).padStart(6);

  // ---------------------------------------------------------------
  // Layer 1 — server timings over raw HTTP.
  // ---------------------------------------------------------------
  if (HTTP) {
    console.log(`\nServer timings — median of ${RUNS} warm runs, ms\n`);
    console.log("                              document (page load)      rsc (client nav)");
    console.log("route                          shell   full   stream     shell   full   stream");
    console.log("-".repeat(82));

    const totals = { docShell: [], docFull: [], rscShell: [], rscFull: [] };

    for (const route of routes) {
      const doc = await measure(route, cookie, false);
      const rsc = await measure(route, cookie, true);
      if (doc.status !== 200 || rsc.status !== 200) {
        console.log(
          `${route.padEnd(30)} doc=${doc.status}${doc.location ? ` -> ${doc.location}` : ""} ` +
            `rsc=${rsc.status}${rsc.location ? ` -> ${rsc.location}` : ""}  (not measured)`
        );
        continue;
      }
      totals.docShell.push(doc.ttfb);
      totals.docFull.push(doc.total);
      totals.rscShell.push(rsc.ttfb);
      totals.rscFull.push(rsc.total);

      console.log(
        `${route.padEnd(30)}${f(doc.ttfb)}${f(doc.total)}${f(doc.total - doc.ttfb)}   ` +
          `${f(rsc.ttfb)}${f(rsc.total)}${f(rsc.total - rsc.ttfb)}`
      );
    }

    console.log("-".repeat(82));
    console.log(
      `${"median across routes".padEnd(30)}${f(median(totals.docShell))}${f(median(totals.docFull))}` +
        `${f(median(totals.docFull) - median(totals.docShell))}   ` +
        `${f(median(totals.rscShell))}${f(median(totals.rscFull))}` +
        `${f(median(totals.rscFull) - median(totals.rscShell))}`
    );
    console.log(
      "\n'stream' is full − shell: how long the server takes to finish a page\n" +
        "after the shell is on the wire. Server-side only — this layer is blind\n" +
        "to the router's prefetch cache, so it under-reports prefetch wins."
    );
  }

  // ---------------------------------------------------------------
  // Layer 2 — what the user actually sees, measured in a real browser.
  // ---------------------------------------------------------------
  if (BROWSER) {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await context.addCookies(
        cookie.split("; ").map((pair) => {
          const i = pair.indexOf("=");
          return {
            name: pair.slice(0, i),
            value: pair.slice(i + 1),
            domain: "localhost",
            path: "/",
          };
        })
      );

      const page = await context.newPage();
      await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });

      /**
       * One click, timed from inside the page.
       *
       * `paint` is when the *destination's own* heading is on screen — its
       * static shell. It has to be "the heading changed", not "a heading
       * exists": React keeps the outgoing page's DOM mounted until the new
       * one commits, so simply looking for an `h1` matches the page being
       * left and reports a constant near-zero no matter what the server does.
       *
       * `settled` is when nothing in <main> is still marked `aria-busy`,
       * which every skeleton in this app sets, so it is the moment the last
       * placeholder became real content.
       *
       * Both clocks start from a `performance.now()` taken in the page
       * immediately before the click, so no driver round trip is counted.
       */
      async function clickAndTime(href) {
        const link = page.locator(`nav a[href^="${href}"]`).first();
        // Not every route in the list is reachable from the sidebar on every
        // org; skip those rather than failing the whole run.
        if ((await link.count()) === 0) return null;

        await page.evaluate(() => {
          window.__navStart = performance.now();
          window.__navHeading =
            document.querySelector("main h1, main h2")?.textContent ?? "";
        });
        await link.click();

        const { paint, settled } = await page.evaluate(
          () =>
            new Promise((resolve) => {
              let paint = null;
              const check = () => {
                const main = document.querySelector("main");
                const heading = main?.querySelector("h1, h2")?.textContent ?? "";
                const now = performance.now() - window.__navStart;

                if (paint === null && heading && heading !== window.__navHeading) {
                  paint = now;
                }
                if (paint !== null && main.querySelectorAll('[aria-busy="true"]').length === 0) {
                  resolve({ paint, settled: now });
                  return;
                }
                requestAnimationFrame(check);
              };
              check();
            })
        );

        await page.waitForFunction((h) => location.pathname === h, href, { timeout: 15000 });
        return { paint, settled };
      }

      console.log(`\nBrowser timings — from click, median of ${RUNS} runs, ms\n`);
      console.log("route                          paint  settled  skeleton");
      console.log("-".repeat(56));

      const totals = { paint: [], settled: [] };

      for (const route of routes) {
        if (route === "/dashboard") continue; // the resting page between clicks

        // Alternate /dashboard -> route so every sample starts from the same
        // place. The first pass is discarded: in `next dev` it pays Turbopack
        // compilation, and in any mode it is the one click with a cold shell.
        const samples = [];
        for (let i = 0; i < RUNS + 1; i++) {
          const t = await clickAndTime(route);
          if (!t) break;
          await clickAndTime("/dashboard");
          if (i > 0) samples.push(t);
        }
        if (samples.length === 0) {
          console.log(`${route.padEnd(30)}  (no sidebar link — not measured)`);
          continue;
        }

        const paint = median(samples.map((s) => s.paint));
        const settled = median(samples.map((s) => s.settled));
        totals.paint.push(paint);
        totals.settled.push(settled);
        console.log(`${route.padEnd(30)}${f(paint)}${f(settled)}${f(settled - paint)}`);
      }

      console.log("-".repeat(56));
      console.log(
        `${"median across routes".padEnd(30)}${f(median(totals.paint))}${f(median(totals.settled))}` +
          `${f(median(totals.settled) - median(totals.paint))}`
      );
      console.log(
        "\n'paint' is click -> destination heading on screen. 'settled' is click ->\n" +
          "no skeleton left in <main>. The gap is what the user called an empty\n" +
          "screen with the shadow of the CTAs.\n"
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

  // Count users as well as orgs. Deleting an org cascades its rows but leaves
  // the fixture's auth user behind, and a teardown message that only claims
  // "removed" without checking is how three orphaned @example.invalid accounts
  // accumulated in the live project unnoticed.
  const { data: orgsLeft } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `%${stamp}%`);
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const usersLeft = (userList?.users ?? []).filter((u) => u.email?.includes(String(stamp)));

  console.log(
    `teardown: ${orgsLeft?.length ?? 0} org(s), ${usersLeft.length} user(s) left over` +
      (orgsLeft?.length || usersLeft.length
        ? ` — LEAKED: ${[...(orgsLeft ?? []).map((o) => o.name), ...usersLeft.map((u) => u.email)].join(", ")}`
        : "")
  );
}
