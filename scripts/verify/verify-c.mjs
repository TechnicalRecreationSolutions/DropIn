/**
 * Phase C verification — the org-media bucket and its storage policies.
 *
 * Same pattern as verify-b.mjs: a throwaway org, real users signed in with real
 * sessions (never the service role, which bypasses RLS and would make every
 * test pass), torn down in a finally.
 *
 * Two users, because the whole point of migration 030's folder scoping is that
 * `member` and `admin` differ. Testing with one role proves half a decision.
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

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const BUCKET = "org-media";
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let pass = 0,
  fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Smallest valid PNG: 1x1 transparent.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const png = () => new Blob([PNG], { type: "image/png" });

async function signedInClient(email, password) {
  const c = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

const stamp = Date.now();
const ids = { uploaded: [] };

/** Uploads and returns the storage error message, or null on success. */
async function tryUpload(client, path, body = png(), contentType = "image/png") {
  const { error } = await client.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  if (!error) ids.uploaded.push(path);
  return error?.message ?? null;
}

try {
  // ------------------------------------------------------------------ setup
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `ZZ Storage ${stamp}`, slug: `zz-storage-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.org = org.id;

  const { data: otherOrg } = await admin
    .from("organizations")
    .insert({ name: `ZZ Other ${stamp}`, slug: `zz-other-${stamp}`, status: "active" })
    .select("id")
    .single();
  ids.otherOrg = otherOrg.id;

  const mkUser = async (tag, role) => {
    const email = `verify-c-${tag}-${stamp}@example.invalid`;
    const password = `Vc!${stamp}aA9`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${tag}: ${error.message}`);
    await admin.from("org_memberships").insert({ org_id: ids.org, user_id: data.user.id, role });
    return { id: data.user.id, email, password };
  };

  const adminUser = await mkUser("admin", "admin");
  const memberUser = await mkUser("member", "member");
  ids.users = [adminUser.id, memberUser.id];

  const asAdmin = await signedInClient(adminUser.email, adminUser.password);
  const asMember = await signedInClient(memberUser.email, memberUser.password);

  console.log(`\nTemp org ${ids.org}; an admin and a member signed in\n`);

  // ------------------------------------------- 1. the happy path + a control
  console.log("1. Member uploads schedule content");
  const eventsPath = `${ids.org}/events/${crypto.randomUUID()}.png`;
  const memberEvents = await tryUpload(asMember, eventsPath);
  check("member CAN upload to events/", memberEvents === null, memberEvents ?? "");

  // Positive control on the read side: prove the URL actually serves bytes,
  // not that a 404 happens to look like an empty success.
  const { data: pub } = asAdmin.storage.from(BUCKET).getPublicUrl(eventsPath);
  const anonFetch = await fetch(pub.publicUrl);
  const bytes = anonFetch.ok ? (await anonFetch.arrayBuffer()).byteLength : 0;
  check("public URL serves anonymously", anonFetch.status === 200, `status ${anonFetch.status}`);
  check("...and returns the actual image bytes", bytes === PNG.length, `${bytes} vs ${PNG.length}`);
  check(
    "...with a content-type of image/png",
    anonFetch.headers.get("content-type")?.includes("image/png"),
    String(anonFetch.headers.get("content-type"))
  );

  // ---------------------------------------------- 2. the member/manager line
  console.log("\n2. The folder role split (migration 030, decision 2)");
  const facMember = await tryUpload(asMember, `${ids.org}/facilities/${crypto.randomUUID()}.png`);
  check("member CANNOT upload to facilities/", facMember !== null, "upload unexpectedly succeeded");

  const facAdmin = await tryUpload(asAdmin, `${ids.org}/facilities/${crypto.randomUUID()}.png`);
  check("admin CAN upload to facilities/", facAdmin === null, facAdmin ?? "");

  const orgAdmin = await tryUpload(asAdmin, `${ids.org}/org/${crypto.randomUUID()}.png`);
  check("admin CAN upload to org/", orgAdmin === null, orgAdmin ?? "");

  const brochureMember = await tryUpload(asMember, `${ids.org}/brochure/${crypto.randomUUID()}.png`);
  check("member CAN upload to brochure/", brochureMember === null, brochureMember ?? "");

  // ------------------------------------------------- 3. cross-org isolation
  console.log("\n3. Cross-org isolation");
  const foreign = await tryUpload(asAdmin, `${ids.otherOrg}/events/${crypto.randomUUID()}.png`);
  check("cannot write into another org's folder", foreign !== null, "upload unexpectedly succeeded");

  const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonUp = await tryUpload(anon, `${ids.org}/events/${crypto.randomUUID()}.png`);
  check("anonymous cannot upload at all", anonUp !== null, "upload unexpectedly succeeded");

  // ------------------------------------------------ 4. bucket-enforced limits
  // These must hold for a *signed-in, authorized* user — that is the whole
  // point of putting them on the bucket rather than in the client.
  console.log("\n4. Limits the client cannot skip");
  const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], {
    type: "image/svg+xml",
  });
  const svgUp = await tryUpload(asAdmin, `${ids.org}/events/${crypto.randomUUID()}.svg`, svg, "image/svg+xml");
  check("SVG rejected (script-bearing format)", svgUp !== null, "upload unexpectedly succeeded");

  const txt = new Blob(["not an image"], { type: "text/plain" });
  const txtUp = await tryUpload(asAdmin, `${ids.org}/events/${crypto.randomUUID()}.txt`, txt, "text/plain");
  check("text/plain rejected", txtUp !== null, "upload unexpectedly succeeded");

  const big = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/png" });
  const bigUp = await tryUpload(asAdmin, `${ids.org}/events/${crypto.randomUUID()}.png`, big, "image/png");
  check("6 MB rejected against a 5 MB bucket limit", bigUp !== null, "upload unexpectedly succeeded");

  // -------------------------------------------------- 5. malformed paths
  // The policy must DENY these, not raise — a UUID cast on a junk path would
  // 500 and leak the difference between "rejected" and "malformed".
  console.log("\n5. Malformed paths deny rather than error");
  const bare = await tryUpload(asAdmin, `just-a-file-${stamp}.png`);
  check("a path with no folders is denied", bare !== null, "upload unexpectedly succeeded");
  check(
    "...with an RLS denial, not a database error",
    bare !== null && !/22P02|invalid input syntax|unexpected/i.test(bare),
    String(bare)
  );

  const notUuid = await tryUpload(asAdmin, `not-a-uuid/events/${crypto.randomUUID()}.png`);
  check("a non-UUID org folder is denied", notUuid !== null, "upload unexpectedly succeeded");
  check(
    "...also cleanly",
    notUuid !== null && !/22P02|invalid input syntax/i.test(notUuid),
    String(notUuid)
  );

  const unknownKind = await tryUpload(asAdmin, `${ids.org}/secrets/${crypto.randomUUID()}.png`);
  check("an unknown kind folder is denied", unknownKind !== null, "upload unexpectedly succeeded");

  // ------------------------------------------------------ 6. delete scoping
  console.log("\n6. Deleting");
  const ownDelete = await asMember.storage.from(BUCKET).remove([eventsPath]);
  check("member can delete its own org's event image", !ownDelete.error && ownDelete.data?.length === 1, JSON.stringify(ownDelete.error ?? ownDelete.data));
} catch (err) {
  fail++;
  console.log(`\n  HARNESS ERROR — ${err.message}\n${err.stack}`);
} finally {
  if (ids.uploaded.length) await admin.storage.from(BUCKET).remove(ids.uploaded);
  for (const orgId of [ids.org, ids.otherOrg].filter(Boolean)) {
    await admin.from("org_memberships").delete().eq("org_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
  }
  for (const uid of ids.users ?? []) await admin.auth.admin.deleteUser(uid);

  const { data: leftover } = await admin.storage.from(BUCKET).list(ids.org ?? "");
  console.log(`\nTeardown: objects left under the temp org = ${leftover?.length ?? 0}`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
