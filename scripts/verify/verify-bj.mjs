/**
 * Trusted websites: the widget only renders inside sites the organization
 * lists at Settings › Embedding (migration 067, organizations.embed_allowed_hosts,
 * enforced by proxy.ts as the widget response's CSP frame-ancestors).
 *
 *   1. The setting: anon 401, coordinator 403, owner saves; pasted URLs are
 *      reduced to bare hosts; an injection attempt and a 26th entry are
 *      refused by the API, and the database CHECK refuses them on its own
 *      (service-role writes, so the CHECK is the only thing in the way).
 *   2. The read path: anon reads exactly the list through
 *      widget_frame_ancestors(), and still cannot read the organizations row.
 *   3. The header: one CSP on /widget/<org>, frame-ancestors = 'self' + the
 *      list (+ www. for a bare domain); other routes keep frame-ancestors 'self'.
 *   4. The mechanism, in a real browser: two throwaway sites on two ports frame
 *      the widget. The trusted one renders it (positive control), the other is
 *      refused by the browser. An org with an empty list is refused on both
 *      but still renders inside Dropin itself (the studio preview).
 *   5. The pages: Settings › Embedding adds a site through the UI; a
 *      coordinator is sent away from it; the studio's Install step warns when
 *      the list is empty.
 *
 * Needs migration 067 applied; refuses to run without it.
 *
 *   npm run dev
 *   node scripts/verify/verify-bj.mjs [--app=http://localhost:3000] [--headed]
 */
import fs from "fs";
import http from "http";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const HEADED = process.argv.includes("--headed");

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
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) chunks.push(`${COOKIE_NAME}.${n}=${value.slice(i, i + MAX)}`);
  return chunks.join("; ");
}
function cookieObjects(session) {
  return sessionCookies(session)
    .split("; ")
    .map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: APP };
    });
}

async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

async function makeUser(orgId, role) {
  const email = `zz-verify-bj-${role}-${orgId.slice(0, 8)}-${stamp}@example.invalid`;
  const password = `Zk!${stamp}aA9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.message}`);
  ids.users.push(data.user.id);
  const { error: memErr } = await admin.from("org_memberships").insert({ org_id: orgId, user_id: data.user.id, role });
  if (memErr) throw new Error(`membership (${role}): ${memErr.message}`);
  // Its own client: signing in on the shared `anon` one would make every later
  // "anon" check run as this member.
  const client = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  return signIn.session;
}

async function makeOrg(label) {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `ZZ verify-bj ${label} ${stamp}`, slug: `zz-verify-bj-${label}-${stamp}`, status: "active" })
    .select("id")
    .single();
  if (error) throw new Error(`org insert: ${error.message}`);
  ids.orgs.push(data.id);
  return data.id;
}

/** A throwaway "customer website" that frames the widget for ?org=. */
function startSite() {
  const server = http.createServer((req, res) => {
    const org = new URL(req.url, "http://x").searchParams.get("org") ?? "";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><title>site</title><iframe id="w" src="${APP}/widget/${org}" width="800" height="600"></iframe>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/**
 * Did the widget render inside the frame? A frame refused by frame-ancestors
 * becomes Chromium's error page (chrome-error://), and the refusal is logged.
 * Both are asserted, so a frame that is merely slow does not read as blocked.
 */
async function framed(page, url) {
  const refusals = [];
  const onConsole = (m) => {
    if (/frame-ancestors|Refused to frame/i.test(m.text())) refusals.push(m.text());
  };
  page.on("console", onConsole);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  page.off("console", onConsole);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const frameUrl = frame?.url() ?? "";
  let rendered = false;
  if (frame && frameUrl.includes("/widget/")) {
    rendered = await frame
      .evaluate(() => document.body?.innerText.trim().length > 0)
      .catch(() => false);
  }
  return { rendered, refused: refusals.length > 0 || frameUrl.startsWith("chrome-error"), frameUrl };
}

const servers = [];
let browser;
try {
  // ---------------------------------------------------------------
  console.log("\n0. Fixture");
  // ---------------------------------------------------------------
  const probe = await admin.from("organizations").select("embed_allowed_hosts").limit(0);
  if (probe.error) throw new Error("migration 067 is not applied (organizations.embed_allowed_hosts missing)");

  const orgId = await makeOrg("a");
  const emptyOrgId = await makeOrg("b");
  const owner = await makeUser(orgId, "owner");
  const coordinator = await makeUser(orgId, "coordinator");
  const ownerCookie = sessionCookies(owner);
  const coordCookie = sessionCookies(coordinator);

  const trusted = await startSite();
  const stranger = await startSite();
  servers.push(trusted, stranger);
  const trustedHost = `127.0.0.1:${trusted.address().port}`;
  const strangerHost = `127.0.0.1:${stranger.address().port}`;
  check("fixture built", true);

  // ---------------------------------------------------------------
  console.log("\n1. The setting");
  // ---------------------------------------------------------------
  const body = (hosts) => ({ method: "PATCH", body: JSON.stringify({ embed_allowed_hosts: hosts }) });

  check("anon PATCH → 401", (await api("/api/organizations", null, body(["example.ca"]))).status === 401);
  const coordRes = await api("/api/organizations", coordCookie, body(["example.ca"]));
  check("coordinator PATCH → 403", coordRes.status === 403, `got ${coordRes.status}`);

  const saved = await api(
    "/api/organizations",
    ownerCookie,
    body(["https://Example.ca/schedule?x=1", "*.filesusr.com", `http://${trustedHost}/`, "example.ca"])
  );
  check("owner PATCH → 200", saved.status === 200, JSON.stringify(saved.body));
  const { data: row } = await admin.from("organizations").select("embed_allowed_hosts").eq("id", orgId).single();
  check(
    "stored as bare hosts, de-duplicated",
    JSON.stringify(row.embed_allowed_hosts) === JSON.stringify(["example.ca", "*.filesusr.com", trustedHost]),
    JSON.stringify(row.embed_allowed_hosts)
  );

  const inj = await api("/api/organizations", ownerCookie, body(["example.ca; script-src *"]));
  check("injection attempt → 400 naming the entry", inj.status === 400 && /is not a website address/.test(inj.body.error ?? ""), JSON.stringify(inj.body));
  check("…and nothing changed", (await admin.from("organizations").select("embed_allowed_hosts").eq("id", orgId).single()).data.embed_allowed_hosts.length === 3);
  const tooMany = await api("/api/organizations", ownerCookie, body(Array.from({ length: 26 }, (_, i) => `s${i}.example.ca`)));
  check("26 entries → 400", tooMany.status === 400, `got ${tooMany.status}`);
  check("bare *.com → 400", (await api("/api/organizations", ownerCookie, body(["*.com"]))).status === 400);

  // Straight to the table with the service role: no API in the way, so a
  // refusal here is the CHECK constraint and nothing else.
  for (const [label, value] of [
    ["directive injection", ["a.com; script-src *"]],
    ["space-separated pair", ["a.com b.com"]],
    ["uppercase", ["Example.ca"]],
    ["scheme", ["https://a.com"]],
    ["empty string", [""]],
    ["26 entries", Array.from({ length: 26 }, (_, i) => `s${i}.example.ca`)],
  ]) {
    const { error } = await admin.from("organizations").update({ embed_allowed_hosts: value }).eq("id", emptyOrgId);
    check(`DB CHECK refuses ${label}`, error?.code === "23514", error ? error.code : "accepted");
  }
  const { error: okErr } = await admin.from("organizations").update({ embed_allowed_hosts: ["a.com", "*.b.com", "localhost:3000"] }).eq("id", emptyOrgId);
  check("DB CHECK accepts valid hosts (positive control)", !okErr, okErr?.message);
  await admin.from("organizations").update({ embed_allowed_hosts: [] }).eq("id", emptyOrgId);

  // ---------------------------------------------------------------
  console.log("\n2. The anonymous read path");
  // ---------------------------------------------------------------
  const { data: rpc, error: rpcErr } = await anon.rpc("widget_frame_ancestors", { p_org_id: orgId });
  check("anon reads the list via widget_frame_ancestors()", !rpcErr && JSON.stringify(rpc) === JSON.stringify(row.embed_allowed_hosts), rpcErr?.message ?? JSON.stringify(rpc));
  const { data: unknown } = await anon.rpc("widget_frame_ancestors", { p_org_id: "00000000-0000-0000-0000-000000000000" });
  check("unknown org → empty list", Array.isArray(unknown) && unknown.length === 0, JSON.stringify(unknown));
  const { data: direct } = await anon.from("organizations").select("embed_allowed_hosts").eq("id", orgId);
  check("anon still cannot read the organizations row", (direct ?? []).length === 0);

  // ---------------------------------------------------------------
  console.log("\n3. The header");
  // ---------------------------------------------------------------
  const res = await fetch(`${APP}/widget/${orgId}`);
  const csp = res.headers.get("content-security-policy") ?? "";
  const fa = /frame-ancestors ([^;]*)/.exec(csp)?.[1]?.trim() ?? "";
  check("one CSP header (no comma-joined duplicate)", csp && !/,\s*default-src/.test(csp), csp.slice(0, 80));
  check(
    "frame-ancestors = 'self' + list + www.example.ca",
    fa === `'self' example.ca www.example.ca *.filesusr.com ${trustedHost}`,
    fa
  );
  const emptyFa = /frame-ancestors ([^;]*)/.exec((await fetch(`${APP}/widget/${emptyOrgId}`)).headers.get("content-security-policy") ?? "")?.[1]?.trim();
  check("empty list → frame-ancestors 'self'", emptyFa === "'self'", emptyFa);
  const junkFa = /frame-ancestors ([^;]*)/.exec((await fetch(`${APP}/widget/not-a-uuid`)).headers.get("content-security-policy") ?? "")?.[1]?.trim();
  check("non-uuid org path → frame-ancestors 'self'", junkFa === "'self'", junkFa);
  const homeFa = /frame-ancestors ([^;]*)/.exec((await fetch(`${APP}/`)).headers.get("content-security-policy") ?? "")?.[1]?.trim();
  check("other routes unchanged (frame-ancestors 'self')", homeFa === "'self'", homeFa);

  // ---------------------------------------------------------------
  console.log("\n4. In a browser");
  // ---------------------------------------------------------------
  browser = await chromium.launch({ headless: !HEADED });
  const page = await (await browser.newContext()).newPage();

  const onTrusted = await framed(page, `http://${trustedHost}/?org=${orgId}`);
  check("trusted site renders the widget (positive control)", onTrusted.rendered && !onTrusted.refused, JSON.stringify(onTrusted));
  const onStranger = await framed(page, `http://${strangerHost}/?org=${orgId}`);
  check("untrusted site is refused by the browser", !onStranger.rendered && onStranger.refused, JSON.stringify(onStranger));
  const emptyOnTrusted = await framed(page, `http://${trustedHost}/?org=${emptyOrgId}`);
  check("org with no trusted sites is refused everywhere", !emptyOnTrusted.rendered && emptyOnTrusted.refused, JSON.stringify(emptyOnTrusted));

  // Inside Dropin itself — what the studio preview does.
  await page.goto(`${APP}/`, { waitUntil: "load" });
  await page.evaluate((src) => {
    const f = document.createElement("iframe");
    f.src = src;
    document.body.appendChild(f);
  }, `/widget/${emptyOrgId}`);
  await page.waitForTimeout(3000);
  const selfFrame = page.frames().find((f) => f.url().includes(`/widget/${emptyOrgId}`));
  const selfRendered = selfFrame ? await selfFrame.evaluate(() => document.body?.innerText.trim().length > 0).catch(() => false) : false;
  check("…but still renders inside Dropin itself", selfRendered, selfFrame?.url() ?? "no frame");

  // ---------------------------------------------------------------
  console.log("\n5. The pages");
  // ---------------------------------------------------------------
  const ownerCtx = await browser.newContext();
  await ownerCtx.addCookies(cookieObjects(owner));
  const op = await ownerCtx.newPage();
  await op.goto(`${APP}/dashboard/settings/embedding`, { waitUntil: "networkidle" });
  check("Embedding page lists the saved sites", await op.getByText(trustedHost).isVisible().catch(() => false));
  check("…and is in the settings rail", await op.getByRole("link", { name: /Embedding/ }).first().isVisible().catch(() => false));
  await op.getByLabel("Add a website").fill("https://www.newsite.ca/pool");
  await op.getByRole("button", { name: "Add", exact: true }).click();
  check("pasted URL shows as its host", await op.getByText("www.newsite.ca").isVisible());
  await op.getByRole("button", { name: `Remove ${trustedHost}` }).click();
  await op.getByRole("button", { name: "Save changes" }).click();
  await op.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 15000 });
  const { data: afterUi } = await admin.from("organizations").select("embed_allowed_hosts").eq("id", orgId).single();
  check(
    "UI save stored the edit",
    JSON.stringify(afterUi.embed_allowed_hosts) === JSON.stringify(["example.ca", "*.filesusr.com", "www.newsite.ca"]),
    JSON.stringify(afterUi.embed_allowed_hosts)
  );
  await op.getByLabel("Add a website").fill("not a site;");
  await op.getByRole("button", { name: "Add", exact: true }).click();
  check("invalid entry shows an error", await op.getByText("That isn't a website address", { exact: false }).isVisible());

  const coordCtx = await browser.newContext();
  await coordCtx.addCookies(cookieObjects(coordinator));
  const cp = await coordCtx.newPage();
  await cp.goto(`${APP}/dashboard/settings/embedding`, { waitUntil: "networkidle" });
  check("coordinator is sent away from Embedding", !cp.url().includes("/settings/embedding"), cp.url());

  // Studio Install warning, on the org with an empty list.
  const emptyOwner = await makeUser(emptyOrgId, "owner");
  const eCtx = await browser.newContext();
  await eCtx.addCookies(cookieObjects(emptyOwner));
  const ep = await eCtx.newPage();
  await ep.goto(`${APP}/dashboard/widget`, { waitUntil: "networkidle" });
  // A never-published org gets the first-run tiles ("Step 4", not "Install"),
  // so the tab is found by the panel it controls.
  await ep.locator('[role="tab"][aria-controls="widget-panel-install"]').click();
  check(
    "studio Install warns the code works nowhere yet",
    await ep.getByText("This code won't show on any website yet", { exact: false }).isVisible().catch(() => false)
  );
  check("…with a link to add one", await ep.getByRole("link", { name: "Add your website" }).isVisible().catch(() => false));
} catch (e) {
  fail++;
  console.log(`  FAIL  ${e.message}`);
} finally {
  await browser?.close();
  for (const s of servers) s.close();
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
