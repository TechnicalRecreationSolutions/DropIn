/**
 * Phase D verification — candidacy → membership → publication.
 *
 * The properties tested here are the ones the whole model exists for, and every
 * one of them is a silent failure if wrong: a re-pull that resurrects a
 * dismissed entry, a season change that rewrites an assembled brochure, a
 * source edit that leaks into a printed one.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP = "http://localhost:3000";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COOKIE = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

function cookieHeader(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return `${COOKIE}=${value}`;
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++) parts.push(`${COOKIE}.${n}=${value.slice(i, i + MAX)}`);
  return parts.join("; ");
}

const ids = {};
let cookie = "";
async function api(path, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.anon ? {} : { Cookie: cookie }), ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const stamp = Date.now();
const email = `verify-d-${stamp}@example.invalid`;
const password = `Vd!${stamp}aA9`;

try {
  // ------------------------------------------------------------------ setup
  const { data: org } = await admin.from("organizations")
    .insert({ name: `ZZ Broch ${stamp}`, slug: `zz-broch-${stamp}`, status: "active" }).select("id").single();
  ids.org = org.id;

  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ids.user = user.user.id;
  await admin.from("org_memberships").insert({ org_id: ids.org, user_id: ids.user, role: "admin" });

  const { data: season } = await admin.from("seasons").insert({
    org_id: ids.org, name: "ZZ Fall", slug: `zz-fall-${stamp}`,
    starts_on: "2026-09-01", ends_on: "2026-12-20", status: "active",
  }).select("id").single();
  ids.season = season.id;

  const { data: fac } = await admin.from("facilities").insert({
    org_id: ids.org, name: "ZZ Centre", slug: `zz-centre-${stamp}`,
    address_line1: "1 St", city: "Edmonton", province: "AB", postal_code: "T0T0T0", is_published: true,
  }).select("id").single();
  ids.facility = fac.id;

  // Two programs: one offered to brochures, one not — the negative control.
  const { data: groups } = await admin.from("schedule_groups").insert([
    { org_id: ids.org, facility_id: ids.facility, name: "ZZ Lane Swim", slug: `zz-lane-${stamp}`,
      sport_category: "swimming", activity_type: "drop_in", cost_cents: 600, status: "published", in_brochure: true },
    { org_id: ids.org, facility_id: ids.facility, name: "ZZ Secret Program", slug: `zz-secret-${stamp}`,
      sport_category: "swimming", activity_type: "drop_in", cost_cents: 0, status: "published", in_brochure: false },
  ]).select("id, name");
  ids.flaggedGroup = groups[0].id;
  ids.unflaggedGroup = groups[1].id;

  // Sessions: one inside the season and flagged, one flagged but OUTSIDE it.
  const { data: sessions } = await admin.from("sessions").insert([
    { org_id: ids.org, schedule_group_id: ids.flaggedGroup, rrule: "FREQ=DAILY;COUNT=1",
      dtstart: "2026-10-31T18:00:00Z", dtend_time: "21:00", valid_from: "2026-10-31",
      valid_until: "2026-10-31", is_active: true, in_brochure: true },
    { org_id: ids.org, schedule_group_id: ids.flaggedGroup, rrule: "FREQ=DAILY;COUNT=1",
      dtstart: "2026-06-15T18:00:00Z", dtend_time: "21:00", valid_from: "2026-06-15",
      valid_until: "2026-06-15", is_active: true, in_brochure: true },
  ]).select("id");
  ids.inSeason = sessions[0].id;
  ids.outOfSeason = sessions[1].id;

  await admin.from("session_features").insert({
    session_id: ids.inSeason, org_id: ids.org,
    title: "Halloween Howl", description: "Original description", summary: "Costumes",
  });

  const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
  cookie = cookieHeader(signIn.session);

  console.log(`\nTemp org ${ids.org}\n`);

  // ------------------------------------------------------- 1. brochure CRUD
  console.log("1. Creating a brochure");
  const created = await api("/api/brochures", {
    method: "POST",
    body: JSON.stringify({ title: `ZZ Guide ${stamp}`, season_id: ids.season }),
  });
  check("create → 200 with an id", created.status === 200 && !!created.body.brochureId, JSON.stringify(created.body));
  ids.brochure = created.body.brochureId;

  const section = await api("/api/brochures/sections", {
    method: "POST",
    body: JSON.stringify({ brochureId: ids.brochure, title: "Aquatics" }),
  });
  check("section created", section.status === 200 && !!section.body.sectionId, JSON.stringify(section.body));
  ids.section = section.body.sectionId;

  // --------------------------------------------------------- 2. candidacy
  console.log("\n2. Candidacy is computed, and filtered by the season");
  const { data: brochureRow } = await admin.from("brochures").select("id").eq("id", ids.brochure).single();
  check("brochure persisted", !!brochureRow);

  // Pull everything flagged; the route re-derives candidates server-side, so
  // asking for a non-candidate must be refused rather than honoured.
  const pull = await api("/api/brochures/pull", {
    method: "POST",
    body: JSON.stringify({
      brochureId: ids.brochure, sectionId: ids.section,
      sourceIds: [ids.flaggedGroup, ids.inSeason, ids.outOfSeason, ids.unflaggedGroup],
    }),
  });
  check("pull → 200", pull.status === 200, JSON.stringify(pull.body));
  check("the flagged program and in-season session were added", pull.body.added === 2, `added ${pull.body.added}`);
  check(
    "the unflagged program and out-of-season session were refused",
    pull.body.unknown === 2,
    `unknown ${pull.body.unknown}`
  );

  const { data: afterPull } = await admin.from("brochure_entries")
    .select("id, title, description, source_type, session_id, schedule_group_id, status")
    .eq("brochure_id", ids.brochure);
  check("exactly 2 entries exist", afterPull.length === 2, `${afterPull.length}`);

  const eventEntry = afterPull.find((e) => e.session_id === ids.inSeason);
  check("the session entry snapshotted its feature title", eventEntry?.title === "Halloween Howl", JSON.stringify(eventEntry?.title));
  check("...and its description", eventEntry?.description === "Original description", JSON.stringify(eventEntry?.description));
  check("source_type matches the source", eventEntry?.source_type === "session", String(eventEntry?.source_type));

  // ------------------------------------------- 3. publication freezes copy
  console.log("\n3. Editing the source does not rewrite the entry");
  await admin.from("session_features").update({
    title: "RENAMED AFTER PULL", description: "REWRITTEN AFTER PULL",
  }).eq("session_id", ids.inSeason);

  const { data: stillFrozen } = await admin.from("brochure_entries")
    .select("title, description").eq("id", eventEntry.id).single();
  check("entry title unchanged after the source was renamed", stillFrozen.title === "Halloween Howl", stillFrozen.title);
  check("entry description unchanged", stillFrozen.description === "Original description", stillFrozen.description);

  // -------------------------------------------------------- 4. tombstones
  console.log("\n4. Dismissing is a tombstone, not a deletion");
  const dismiss = await api("/api/brochures/entries", {
    method: "POST", body: JSON.stringify({ entryId: eventEntry.id, status: "dismissed" }),
  });
  check("dismiss → 200", dismiss.status === 200, JSON.stringify(dismiss.body));

  const { data: afterDismiss } = await admin.from("brochure_entries")
    .select("id, status").eq("id", eventEntry.id).single();
  check("the row still exists", !!afterDismiss);
  check("...with status dismissed", afterDismiss.status === "dismissed", afterDismiss.status);

  // THE test: pulling again must not bring it back.
  const rePull = await api("/api/brochures/pull", {
    method: "POST",
    body: JSON.stringify({ brochureId: ids.brochure, sectionId: ids.section, sourceIds: [ids.inSeason, ids.flaggedGroup] }),
  });
  check("re-pull adds nothing", rePull.body.added === 0, `added ${rePull.body.added}`);
  check("...and reports both as already handled", rePull.body.skipped === 2, `skipped ${rePull.body.skipped}`);

  const { data: afterRePull } = await admin.from("brochure_entries")
    .select("id, status").eq("brochure_id", ids.brochure);
  check("still exactly 2 rows — nothing duplicated", afterRePull.length === 2, `${afterRePull.length}`);
  check(
    "the dismissed one is STILL dismissed (not resurrected)",
    afterRePull.find((e) => e.id === eventEntry.id)?.status === "dismissed"
  );

  // A derived entry must not be deletable — that would let a re-pull resurrect it.
  const del = await api(`/api/brochures/entries?entryId=${eventEntry.id}`, { method: "DELETE" });
  check("deleting a derived entry is refused with 409", del.status === 409, `got ${del.status}`);

  // ------------------------------------- 5. sections keep their tombstones
  console.log("\n5. Deleting a section keeps entries and tombstones");
  const delSection = await api(`/api/brochures/sections?sectionId=${ids.section}`, { method: "DELETE" });
  check("section deleted", delSection.status === 200, JSON.stringify(delSection.body));

  const { data: survivors } = await admin.from("brochure_entries")
    .select("id, section_id, status").eq("brochure_id", ids.brochure);
  check("both entries survived the section", survivors.length === 2, `${survivors.length}`);
  check("...and are now unfiled", survivors.every((e) => e.section_id === null));
  check(
    "the tombstone survived too",
    survivors.find((e) => e.id === eventEntry.id)?.status === "dismissed"
  );

  // ------------------------------------------------ 6. season independence
  console.log("\n6. Changing the season does not touch assembled entries");
  await api("/api/brochures", {
    method: "POST",
    body: JSON.stringify({ brochureId: ids.brochure, title: `ZZ Guide ${stamp}`, season_id: null }),
  });
  const { data: afterSeasonChange } = await admin.from("brochure_entries")
    .select("id").eq("brochure_id", ids.brochure);
  check("entries unchanged after clearing the season", afterSeasonChange.length === 2, `${afterSeasonChange.length}`);

  // --------------------------------------------------- 7. public read gating
  console.log("\n7. Public read is publish-gated, and hides tombstones");
  const anonRead = async (path) =>
    (await fetch(`${URL_}/rest/v1/${path}`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    })).json();

  const draftVisible = await anonRead(`brochures?select=id&id=eq.${ids.brochure}`);
  check("a draft brochure is invisible anonymously", draftVisible.length === 0, JSON.stringify(draftVisible));

  await api("/api/brochures", {
    method: "POST",
    body: JSON.stringify({ brochureId: ids.brochure, title: `ZZ Guide ${stamp}`, status: "published" }),
  });

  const publishedVisible = await anonRead(`brochures?select=id,published_at&id=eq.${ids.brochure}`);
  check("a published brochure is visible anonymously", publishedVisible.length === 1, JSON.stringify(publishedVisible));
  check("published_at was stamped", !!publishedVisible[0]?.published_at, JSON.stringify(publishedVisible[0]));

  const publicEntries = await anonRead(`brochure_entries?select=id,status&brochure_id=eq.${ids.brochure}`);
  check("anonymous sees only the included entry", publicEntries.length === 1, JSON.stringify(publicEntries));
  check("...and never the tombstone", !publicEntries.some((e) => e.status === "dismissed"));

  // ------------------------------------------ 8. source deletion preserves
  console.log("\n8. Deleting the source leaves the printed record intact");
  await admin.from("sessions").delete().eq("id", ids.inSeason);
  const { data: orphaned } = await admin.from("brochure_entries")
    .select("id, title, session_id, source_type").eq("id", eventEntry.id).maybeSingle();
  check("the entry survives its source being deleted", !!orphaned);
  check("...keeping its snapshot title", orphaned?.title === "Halloween Howl", JSON.stringify(orphaned?.title));
  check("...with session_id nulled, not cascaded away", orphaned?.session_id === null, String(orphaned?.session_id));
  check("...and source_type still recording where it came from", orphaned?.source_type === "session");
  // ------------------------------------------------ 9. the public document
  // Rendered HTML, not just RLS: the page could be gated correctly and still
  // fail to show the content, or show a tombstone the policy already excluded.
  console.log("\n9. The public brochure page");
  const { data: orgRow } = await admin.from("organizations").select("slug").eq("id", ids.org).single();
  const { data: brochureRow2 } = await admin.from("brochures").select("slug, title").eq("id", ids.brochure).single();
  const publicUrl = `${APP}/org/${orgRow.slug}/brochure/${brochureRow2.slug}`;

  const page = await fetch(publicUrl);
  const html = await page.text();
  check("published brochure page → 200", page.status === 200, `got ${page.status}`);
  check("...renders its title", html.includes(brochureRow2.title), "title missing from HTML");
  check("...renders the surviving included entry", html.includes("ZZ Lane Swim"), "entry missing from HTML");
  check(
    "...and does NOT render the dismissed one",
    !html.includes("Halloween Howl"),
    "a tombstoned entry leaked into the public page"
  );
  check("...carries the print stylesheet hook", html.includes("brochure"), "no .brochure wrapper");

  // Unpublish and confirm the page closes again — a published page that stays
  // reachable after unpublishing is the failure that matters here.
  await api("/api/brochures", {
    method: "POST",
    body: JSON.stringify({ brochureId: ids.brochure, title: brochureRow2.title, status: "draft" }),
  });
  const afterUnpublish = await fetch(publicUrl);
  const afterHtml = await afterUnpublish.text();
  check(
    "unpublished brochure no longer renders its content",
    !afterHtml.includes("ZZ Lane Swim"),
    "content still served after unpublishing"
  );
} catch (err) {
  fail++;
  console.log(`\n  HARNESS ERROR — ${err.message}\n${err.stack}`);
} finally {
  if (ids.org) {
    for (const t of ["brochure_entries", "brochure_sections", "brochures", "session_features", "sessions", "schedule_groups", "facilities", "seasons", "org_memberships"]) {
      await admin.from(t).delete().eq("org_id", ids.org);
    }
    await admin.from("organizations").delete().eq("id", ids.org);
  }
  if (ids.user) await admin.auth.admin.deleteUser(ids.user);
  const { data: left } = await admin.from("brochures").select("id").eq("org_id", ids.org ?? "");
  console.log(`\nTeardown: brochures left = ${left?.length ?? 0}`);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
