/**
 * Search-engine surface and facility-page freshness (phase 4 of the directory
 * plan in docs/PLAN.md).
 *
 *  1. **robots.txt** keeps crawlers out of the dashboard, the API, the embed
 *     and the auth callback, and points at an absolute sitemap.
 *  2. **sitemap.xml** lists /find and *listed* facilities only; a published
 *     but unlisted one is absent (a positive control sits beside it), and
 *     opting out through the app removes the URL on the next request.
 *  3. **The facility breadcrumb** leads a listed facility back to /find and
 *     keeps Home for an unlisted one.
 *  4. **A save refreshes the facility page at once.** The page is cached for
 *     hours, and before phase 4 nothing expired it on a facility edit. Each
 *     case has a cached-state control first: a change written straight to the
 *     database must NOT show, which proves the page really is cached, so "the
 *     app save shows" cannot pass by accident. Covered: an edit, publishing
 *     onto a slug whose "not found" was already cached, a rename (the old slug
 *     stops serving), and a delete.
 *  5. **Canonical URLs**: /find ignores its query string, a facility page
 *     names its own slug, and a live page carries no noindex.
 *
 * No Nominatim requests: fixtures carry geocoded_at and saves keep the address.
 *
 *   node scripts/verify/verify-ah.mjs [--app=http://localhost:3000]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";

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

const text = async (path) => {
  const res = await fetch(`${APP}${path}`);
  return { status: res.status, body: await res.text() };
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The page rendered this facility (its <h1>), not the not-found body. */
const showsFacility = (html, name) => new RegExp(`<h1[^>]*>${escapeRe(name)}</h1>`).test(html);
const isNotFound = (html) => /noindex/.test(html) && /Facility Not Found/.test(html);

/**
 * `next dev` applies a tag expiry about 100 ms after the route that issued it
 * has responded, so the very next request can still get the old page. A
 * production build (`next start`) was measured serving the new page on the
 * immediate next request (38/38 with no pause). The pause keeps this harness
 * honest on the dev server without hiding a real failure: a page that never
 * refreshes still fails.
 */
const DEV_SETTLE_MS = 400;
const settle = () => new Promise((r) => setTimeout(r, DEV_SETTLE_MS));

const stamp = Date.now();
const cleanup = { users: [], orgs: [] };

try {
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ Verify-AH Rec ${stamp}`, slug: `zz-verify-ah-${stamp}`, status: "active",
      // Verified: an unverified org is kept out of the sitemap and noindexed (057).
      approved_at: new Date().toISOString() })
    .select("id")
    .single();
  cleanup.orgs.push(org.id);

  const email = `zz-verify-ah-admin-${stamp}@example.invalid`;
  const password = `Zah!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  cleanup.users.push(userData.user.id);
  await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "manager" });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  const cookie = sessionCookies(signIn.session);

  const ADDRESS = { address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0" };
  // Slugs must be what the route's slugify() produces from the name, because
  // every save through the route rewrites the slug from the name.
  const makeFacility = async (word, extra) => {
    const name = `ZZ AH ${word} ${stamp}`;
    const { data, error } = await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name,
        slug: `zz-ah-${word.toLowerCase()}-${stamp}`,
        ...ADDRESS,
        geocoded_at: new Date().toISOString(),
        ...extra,
      })
      .select("id, name, slug, description")
      .single();
    if (error) throw new Error(`facility ${word}: ${error.message}`);
    return data;
  };
  const save = (f, fields) =>
    fetch(`${APP}/api/facilities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: f.name,
        ...ADDRESS,
        is_published: true,
        listed_in_directory: false,
        description: null,
        photo_urls: [],
        facilityId: f.id,
        ...fields,
      }),
    }).then(async (r) => {
      const result = { status: r.status, body: await r.json().catch(() => ({})) };
      await settle();
      return result;
    });

  const listed = await makeFacility("Listed", { is_published: true, listed_in_directory: true });
  const unlisted = await makeFacility("Unlisted", { is_published: true });
  const draft = await makeFacility("Draft", { is_published: false });
  const renamed = await makeFacility("Before", { is_published: true });
  const doomed = await makeFacility("Doomed", { is_published: true });

  // One app save so the directory cache (and so the sitemap) sees the fixtures.
  const primed = await save(listed, { listed_in_directory: true });
  if (primed.status !== 200) throw new Error(`priming save failed: ${JSON.stringify(primed.body)}`);

  console.log("\n1. robots.txt");
  const robots = await text("/robots.txt");
  check("robots.txt is served", robots.status === 200, `${robots.status}`);
  for (const path of ["/dashboard", "/api/", "/widget/", "/callback"]) {
    check(`it disallows ${path}`, robots.body.includes(`Disallow: ${path}`), robots.body);
  }
  check("it does not disallow /find or /facility", !/Disallow: \/(find|facility)/.test(robots.body));
  check("it names an absolute sitemap URL", /Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/.test(robots.body), robots.body);

  console.log("\n2. sitemap.xml");
  const sitemap = await text("/sitemap.xml");
  check("sitemap.xml is served", sitemap.status === 200, `${sitemap.status}`);
  check("it lists /find", /<loc>https?:\/\/[^<]+\/find<\/loc>/.test(sitemap.body));
  check("it lists a listed facility (control)", sitemap.body.includes(`/facility/${listed.slug}</loc>`));
  check("it leaves out a published but unlisted facility", !sitemap.body.includes(`/facility/${unlisted.slug}<`));
  check("it leaves out a draft", !sitemap.body.includes(`/facility/${draft.slug}<`));
  check("it leaves out dashboard URLs", !sitemap.body.includes("/dashboard"));

  console.log("\n3. Breadcrumb");
  const listedPage = await text(`/facility/${listed.slug}`);
  const unlistedPage = await text(`/facility/${unlisted.slug}`);
  check("control: both pages render their facility", showsFacility(listedPage.body, listed.name) && showsFacility(unlistedPage.body, unlisted.name));
  check("a listed facility's breadcrumb links to /find", /<nav[^>]*>[\s\S]*?href="\/find"[^>]*>Find a centre</.test(listedPage.body));
  check("an unlisted facility's breadcrumb keeps Home", /<nav[^>]*>\s*<a[^>]*href="\/"[^>]*>Home</.test(unlistedPage.body) && !/>Find a centre<\/a>\s*<span/.test(unlistedPage.body));

  console.log("\n5. Canonical and indexing");
  check("a facility page's canonical is its own slug", new RegExp(`rel="canonical" href="https?://[^"]+/facility/${escapeRe(listed.slug)}"`).test(listedPage.body));
  check("a live facility page is not noindex", !/noindex/.test(listedPage.body));
  const findPage = await text(`/find?q=pool&sport=swimming`);
  check("/find with a query has /find as its canonical", /rel="canonical" href="https?:\/\/[^"]+\/find"/.test(findPage.body));

  console.log("\n4a. An edit shows at once");
  const DIRECT = `Written directly ${stamp}`;
  const SAVED = `Saved through the app ${stamp}`;
  await admin.from("facilities").update({ description: DIRECT }).eq("id", unlisted.id);
  const cached = await text(`/facility/${unlisted.slug}`);
  check("control: a direct database edit is not shown (the page is cached)", !cached.body.includes(DIRECT), "if this fails the cache is not in use, or it revalidated mid-run");
  const edited = await save(unlisted, { description: SAVED });
  const afterEdit = await text(`/facility/${unlisted.slug}`);
  check("control: the app save succeeds", edited.status === 200, JSON.stringify(edited.body));
  check("the saved description shows on the next request", afterEdit.body.includes(SAVED));

  console.log("\n4b. Publishing onto a cached \"not found\"");
  const before = await text(`/facility/${draft.slug}`);
  check("control: a draft's page is not found", isNotFound(before.body) && !showsFacility(before.body, draft.name));
  await admin.from("facilities").update({ is_published: true }).eq("id", draft.id);
  const stillCached = await text(`/facility/${draft.slug}`);
  check("control: publishing it directly still serves the cached not-found", isNotFound(stillCached.body));
  await admin.from("facilities").update({ is_published: false }).eq("id", draft.id);
  const published = await save(draft, { is_published: true });
  const afterPublish = await text(`/facility/${draft.slug}`);
  check("publishing through the app shows the page at once", published.status === 200 && showsFacility(afterPublish.body, draft.name), JSON.stringify(published.body));

  console.log("\n4c. A rename");
  const warmOld = await text(`/facility/${renamed.slug}`);
  check("control: the old slug serves the facility", showsFacility(warmOld.body, renamed.name));
  const newName = `ZZ AH After ${stamp}`;
  const newSlug = `zz-ah-after-${stamp}`;
  const warmNew = await text(`/facility/${newSlug}`);
  check("control: the new slug is not found yet", isNotFound(warmNew.body));
  const rename = await save(renamed, { name: newName });
  check("control: the rename succeeds", rename.status === 200, JSON.stringify(rename.body));
  const { data: renamedRow } = await admin.from("facilities").select("slug").eq("id", renamed.id).single();
  check("control: the route gave it the expected slug", renamedRow.slug === newSlug, renamedRow.slug);
  const newPage = await text(`/facility/${newSlug}`);
  const oldPage = await text(`/facility/${renamed.slug}`);
  check("the new slug serves the facility at once", showsFacility(newPage.body, newName));
  check("the old slug stops serving it at once", isNotFound(oldPage.body) && !showsFacility(oldPage.body, renamed.name));

  console.log("\n4d. A delete");
  const warmDoomed = await text(`/facility/${doomed.slug}`);
  check("control: the page serves before the delete", showsFacility(warmDoomed.body, doomed.name));
  const del = await fetch(`${APP}/api/facilities/${doomed.id}`, { method: "DELETE", headers: { Cookie: cookie } });
  await settle();
  const afterDelete = await text(`/facility/${doomed.slug}`);
  check("control: the delete succeeds", del.status === 200, `${del.status}`);
  check("the deleted facility's page is not found at once", isNotFound(afterDelete.body));

  console.log("\n2b. Opting out leaves the sitemap");
  const optOut = await save(listed, { listed_in_directory: false });
  const afterOptOut = await text("/sitemap.xml");
  check("control: the opt-out save succeeds", optOut.status === 200);
  check("control: the sitemap still lists /find", /\/find<\/loc>/.test(afterOptOut.body));
  check("the facility is gone from the sitemap on the next request", !afterOptOut.body.includes(`/facility/${listed.slug}<`));
  const optedOutPage = await text(`/facility/${listed.slug}`);
  check("…and its breadcrumb goes back to Home", /<nav[^>]*>\s*<a[^>]*href="\/"[^>]*>Home</.test(optedOutPage.body));
} catch (e) {
  fail++;
  console.log(`  FAIL  harness error — ${e.message}`);
} finally {
  for (const id of cleanup.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: leftover } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
  console.log(`\nTeardown: ${leftover?.length ?? 0} org(s) left over`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
