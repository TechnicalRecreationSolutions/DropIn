/**
 * Marks an organization as verified — confirmed to really run the centres it
 * lists — or takes that back (migration 057). Verification is what lets its
 * listed facilities into /find and lets search engines index their pages.
 *
 * Needs migration 057 applied.
 *
 * Verify out-of-band first: call the number on the centre's official website,
 * or email the address published there, and confirm the person who signed up.
 * Never trust contact details the account itself entered.
 *
 *   node scripts/verify-org.mjs                     # list orgs + their state
 *   node scripts/verify-org.mjs <org-slug>          # verify
 *   node scripts/verify-org.mjs <org-slug> --revoke # unverify
 *
 * /find picks the change up within a minute. Facility pages carry their
 * noindex/index flag in a cache entry that lasts hours; saving any facility
 * in the org refreshes it at once.
 *
 * Uses the service role: this is an operator script, not a code path any user
 * can reach. The DB trigger rejects the same write from an org's own staff.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
const revoke = process.argv.includes("--revoke");

if (!slug) {
  const { data, error } = await admin.from("organizations")
    .select("name, slug, status, approved_at, website_url, facilities(is_published, listed_in_directory)")
    .order("created_at");
  if (error) throw error;
  for (const o of data) {
    const listed = o.facilities.filter((f) => f.is_published && f.listed_in_directory).length;
    const mark = o.approved_at ? `verified ${o.approved_at.slice(0, 10)}` : "UNVERIFIED";
    console.log(`${mark.padEnd(20)} ${o.status.padEnd(10)} listed=${listed}  ${o.slug}  (${o.name}${o.website_url ? `, ${o.website_url}` : ""})`);
  }
  process.exit(0);
}

const { data: org, error } = await admin.from("organizations")
  .update({ approved_at: revoke ? null : new Date().toISOString(), approved_by: null })
  .eq("slug", slug)
  .select("name, approved_at")
  .maybeSingle();

if (error) throw error;
if (!org) {
  console.error(`No organization with slug "${slug}". Run with no arguments to list them.`);
  process.exit(1);
}
console.log(revoke ? `Unverified: ${org.name}` : `Verified: ${org.name} (${org.approved_at})`);
