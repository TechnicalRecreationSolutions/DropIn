/**
 * One-off cleanup for the seasons/events/brochure removal (migration 036).
 *
 * Deletes every object under the `events/` and `brochure/` kind-prefixes in
 * the `org-media` bucket, across all orgs. Direct SQL DELETE on
 * storage.objects is blocked by Supabase's protect_delete() trigger, so this
 * has to go through the Storage API instead — see migration 036's own
 * comment for why this is a separate script rather than part of the SQL.
 *
 * Safe to run before or after the SQL migration; independent of it. Safe to
 * re-run — it just finds nothing left to delete the second time.
 *
 * Usage: node scripts/remove-events-brochure-storage.mjs [--dry-run]
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = "org-media";
const KINDS = ["events", "brochure"];
const dryRun = process.argv.includes("--dry-run");

// Path shape is {org_id}/{kind}/{filename} — list per-org, per-kind folders
// rather than trying to list the whole bucket recursively in one call.
const { data: orgFolders, error: orgErr } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
if (orgErr) throw orgErr;

let totalFound = 0;
let totalDeleted = 0;

for (const orgFolder of orgFolders ?? []) {
  if (orgFolder.id === null) continue; // not a folder
  const orgId = orgFolder.name;

  for (const kind of KINDS) {
    const prefix = `${orgId}/${kind}`;
    const { data: files, error: listErr } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (listErr) {
      console.log(`  skip ${prefix}: ${listErr.message}`);
      continue;
    }
    if (!files || files.length === 0) continue;

    const paths = files.map((f) => `${prefix}/${f.name}`);
    totalFound += paths.length;
    console.log(`${prefix}: ${paths.length} object(s)`);
    paths.forEach((p) => console.log(`  - ${p}`));

    if (!dryRun) {
      const { error: removeErr } = await admin.storage.from(BUCKET).remove(paths);
      if (removeErr) {
        console.log(`  ERROR removing: ${removeErr.message}`);
      } else {
        totalDeleted += paths.length;
      }
    }
  }
}

console.log(
  dryRun
    ? `\nDry run: ${totalFound} object(s) would be deleted.`
    : `\nDeleted ${totalDeleted}/${totalFound} object(s).`
);
