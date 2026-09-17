/**
 * The Content-Security-Policy in a real browser (SECURITY.md M7,
 * DEPLOYMENT.md §5), including the directory surfaces added in September 2026.
 *
 * **Run it against a production build.** `next dev` sends a looser policy
 * ('unsafe-eval', ws:, localhost), so a clean run on dev proves nothing:
 *
 *   NEXT_DIST_DIR=.next-perf npx next build
 *   NEXT_DIST_DIR=.next-perf npx next start -p 3002
 *   node scripts/verify/verify-ai.mjs --app=http://localhost:3002
 *
 * What it checks:
 *  1. **Headers.** Exactly one CSP on each page. /find carries
 *     `frame-ancestors 'self'` and a Permissions-Policy that still allows
 *     geolocation for this origin — without that, "Use my location" fails
 *     silently. The public API gets the strict policy too.
 *  2. **No violations while the pages are actually used**: `/`, `/find`
 *     (location granted, a sport chip, a star), a listed facility page whose
 *     cover photo is a real Supabase Storage URL (img-src), `/sitemap.xml`.
 *     Violations are collected from `securitypolicyviolation` events and from
 *     console messages.
 *  3. **The collector works.** Positive control: an image from an unlisted
 *     origin is requested on purpose and must be reported. Without it, "no
 *     violations" could mean "not listening".
 *  4. **The embed frames on a different origin.** A throwaway page on another
 *     port loads `/embed/widget.js` exactly as a centre's site would; the
 *     iframe must render the widget. Control: a normal page (/find) framed the
 *     same way must be refused.
 *
 *   node scripts/verify/verify-ai.mjs --app=http://localhost:3002 [--headed]
 */
import fs from "fs";
import http from "http";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3002";
const HEADED = process.argv.includes("--headed");
const HOST_PORT = 3099;

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
const SUPABASE_HOST = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const COOKIE_NAME = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
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

/** Collects CSP violations for one page, from both the DOM event and the console. */
async function watch(page) {
  const seen = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.log(`[csp-violation] ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[csp-violation]") || /Content[- ]Security[- ]Policy/i.test(t)) seen.push(t);
  });
  return seen;
}

const stamp = Date.now();
const cleanup = { orgs: [], users: [] };
let hostServer;
const browser = await chromium.launch({ headless: !HEADED });

try {
  const probe = await fetch(`${APP}/`);
  if (!probe.ok) throw new Error(`${APP} is not answering (${probe.status})`);
  if (/'unsafe-eval'/.test(probe.headers.get("content-security-policy") ?? "")) {
    throw new Error(`${APP} is sending the development CSP ('unsafe-eval'); run this against a production build`);
  }

  // A real Storage object, so img-src is exercised against the actual host.
  const { data: withPhoto } = await admin.from("facilities").select("photo_urls").not("photo_urls", "eq", "{}").limit(1);
  const photoUrl = withPhoto?.[0]?.photo_urls?.[0] ?? null;

  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ Verify-AI Rec ${stamp}`, slug: `zz-verify-ai-${stamp}`, status: "active" })
    .select("id")
    .single();
  cleanup.orgs.push(org.id);
  const { data: facility } = await admin
    .from("facilities")
    .insert({
      org_id: org.id,
      name: `ZZ AI Pool ${stamp}`,
      slug: `zz-ai-pool-${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      lat: 48.43,
      lng: -123.37,
      geocoded_at: new Date().toISOString(),
      is_published: true,
      listed_in_directory: true,
      photo_urls: photoUrl ? [photoUrl] : [],
    })
    .select("id, slug")
    .single();
  await admin.from("schedule_groups").insert({
    org_id: org.id,
    facility_id: facility.id,
    name: `ZZ Swim ${stamp}`,
    slug: `zz-swim-${stamp}`,
    sport_category: "swimming",
    activity_type: "drop_in",
    source: "manual",
    status: "published",
    starts_on: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  });

  // Direct inserts don't reach the cached /find; a save through the app does.
  const email = `zz-verify-ai-admin-${stamp}@example.invalid`;
  const password = `Zai!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  cleanup.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  const touch = await fetch(`${APP}/api/facilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookies(signIn.session) },
    body: JSON.stringify({
      name: `ZZ AI Pool ${stamp}`,
      address_line1: "1 Test St",
      city: "Victoria",
      province: "BC",
      postal_code: "V0V 0V0",
      is_published: true,
      listed_in_directory: true,
      photo_urls: photoUrl ? [photoUrl] : [],
      facilityId: facility.id,
    }),
  });
  if (touch.status !== 200) throw new Error(`cache-expiring save failed: ${touch.status}`);
  await new Promise((r) => setTimeout(r, 400));

  console.log("\n1. Headers");
  for (const path of ["/", "/find", `/facility/${facility.slug}`, "/api/public/v1/directory"]) {
    const res = await fetch(`${APP}${path}`);
    const csp = res.headers.get("content-security-policy") ?? "";
    // fetch() joins repeated headers with ", "; a CSP never contains one.
    check(`${path}: exactly one CSP header`, csp !== "" && !csp.includes(", "), csp.slice(0, 80));
    check(`${path}: frame-ancestors 'self'`, /frame-ancestors 'self'/.test(csp));
  }
  const findHeaders = (await fetch(`${APP}/find`)).headers;
  check("/find allows geolocation for this origin", /geolocation=\(self\)/.test(findHeaders.get("permissions-policy") ?? ""), findHeaders.get("permissions-policy"));
  check("/find cannot be framed by others (X-Frame-Options)", findHeaders.get("x-frame-options") === "SAMEORIGIN");

  console.log("\n2. No violations while the pages are used");
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    geolocation: { latitude: 48.4284, longitude: -123.3656 },
    permissions: ["geolocation"],
  });

  {
    const page = await context.newPage();
    const seen = await watch(page);
    await page.goto(`${APP}/`, { waitUntil: "networkidle" });
    check("/ renders with no CSP violations", seen.length === 0, seen.join(" | "));
    await page.close();
  }

  {
    const page = await context.newPage();
    const seen = await watch(page);
    await page.goto(`${APP}/find?q=${stamp}`, { waitUntil: "networkidle" });
    const card = page.locator("article", { hasText: `ZZ AI Pool ${stamp}` });
    check("control: /find shows the fixture", await card.isVisible());
    await page.getByRole("button", { name: "Use my location" }).click();
    await page.getByRole("button", { name: "Sorted by distance" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Swimming", exact: true }).click();
    await page.getByRole("button", { name: `Save ZZ AI Pool ${stamp}` }).click();
    if (photoUrl) {
      const loaded = await card.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
      check("the Supabase-hosted cover photo loads on /find", loaded);
    }
    await page.waitForTimeout(500);
    check("/find, used (location, filter, star), has no CSP violations", seen.length === 0, seen.join(" | "));

    // Positive control: prove the collector reports a real violation.
    await page.evaluate(() => {
      const img = new Image();
      img.src = "https://example.com/csp-probe.png";
      document.body.appendChild(img);
    });
    await page.waitForTimeout(1500);
    check(
      "control: an image from an unlisted origin IS reported",
      seen.some((t) => /img-src/.test(t) && /example\.com/.test(t)),
      seen.join(" | ") || "nothing reported"
    );
    await page.close();
  }

  {
    const page = await context.newPage();
    const seen = await watch(page);
    await page.goto(`${APP}/facility/${facility.slug}`, { waitUntil: "networkidle" });
    check("control: the facility page renders the fixture", await page.getByRole("heading", { name: `ZZ AI Pool ${stamp}` }).isVisible());
    await page.waitForTimeout(1000);
    check("the facility page has no CSP violations", seen.length === 0, seen.join(" | "));
    await page.close();
  }

  if (!photoUrl) console.log("  SKIP  no facility has a Storage photo to exercise img-src with");
  check("the photo host is the project's Supabase host", !photoUrl || new URL(photoUrl).host === SUPABASE_HOST);

  console.log("\n3. The embed, framed on a different origin");
  hostServer = http.createServer((req, res) => {
    const target = req.url?.startsWith("/find") ? "find" : "widget";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      target === "widget"
        ? `<!doctype html><title>Centre site</title><h1>A centre's own website</h1>
           <div id="dropin-widget"></div>
           <script src="${APP}/embed/widget.js" data-org-id="${org.id}"></script>`
        : `<!doctype html><title>Framing /find</title><iframe id="f" src="${APP}/find" style="width:800px;height:400px"></iframe>`
    );
  });
  await new Promise((r) => hostServer.listen(HOST_PORT, r));

  {
    const page = await context.newPage();
    const seen = await watch(page);
    await page.goto(`http://127.0.0.1:${HOST_PORT}/widget`, { waitUntil: "networkidle" });
    const frameEl = page.locator("#dropin-widget iframe");
    await frameEl.waitFor({ timeout: 10000 });
    await frameEl.scrollIntoViewIfNeeded();
    const frame = await (await frameEl.elementHandle()).contentFrame();
    await frame?.waitForLoadState("networkidle").catch(() => {});
    const url = frame?.url() ?? "";
    const rendered = frame ? await frame.locator("body").innerText().catch(() => "") : "";
    check("the embed script builds an iframe pointing at this app", url.startsWith(`${APP}/widget/${org.id}`), url);
    check("the widget renders inside a frame on another origin", rendered.trim().length > 0 && !/refused|blocked/i.test(rendered), rendered.slice(0, 80));
    check("no CSP violations on the host page or the widget", seen.length === 0, seen.join(" | "));
    await page.close();
  }

  {
    const page = await context.newPage();
    const blocked = [];
    page.on("console", (m) => blocked.push(m.text()));
    await page.goto(`http://127.0.0.1:${HOST_PORT}/find`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const framedText = frame ? await frame.locator("body").innerText().catch(() => "") : "";
    check(
      "control: /find framed on another origin is refused",
      !framedText.includes("Find a recreation centre"),
      `frame text: ${framedText.slice(0, 60)} | console: ${blocked.join(" | ").slice(0, 160)}`
    );
    await page.close();
  }

  await context.close();
} catch (e) {
  fail++;
  console.log(`  FAIL  harness error — ${e.message}`);
} finally {
  await browser.close();
  hostServer?.close();
  for (const id of cleanup.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: leftover } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
  console.log(`\nTeardown: ${leftover?.length ?? 0} org(s) left over`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
