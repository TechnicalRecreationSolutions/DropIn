/**
 * Template description, tags and registration links (migration 050).
 *
 * What has to be proven, in order of how quietly it would fail:
 *
 *  1. **They reach a patron at all.** All three live on session_templates,
 *     which had no public-read policy before 050 — an anonymous caller got
 *     `session_templates: null` on the embed and every public card fell back to
 *     the schedule group's name. Build the feature without the policy and it
 *     renders perfectly for staff and is invisible to the public, with no
 *     error anywhere. This is the assertion the whole migration exists for, so
 *     it is also the one with the loudest positive control: the same read as a
 *     signed-in member must show the same values.
 *
 *  2. **A withheld booking still withholds.** 047 kept a renter's name out of
 *     the public payload via applyDisclosure(). A description reading "Island
 *     Swimming club practice", a tag labelled "Island Swimming", or a link to
 *     the club's registration page each name the holder just as plainly. Two
 *     different paths have to be closed, and §3 checks both: the API
 *     projection, and a *direct* PostgREST read of the three new tables using
 *     the publishable key — sessions.template_id is public, so without the
 *     `s.disclosure = 'public'` condition in 050's policies anyone could take
 *     the template_id from a reserved session and read back exactly what the
 *     API had just redacted.
 *
 *  3. **The vocabulary is a vocabulary.** Case-insensitive uniqueness per
 *     facility is the single constraint that separates this from free text. If
 *     it does not hold, three coordinators produce three spellings and the
 *     printed legend is worse than no legend.
 *
 *  4. **The cap and the URL scheme hold at the database, not just in zod.** The
 *     links end up in an href on a public page; a `javascript:` URL stored by
 *     any writer that skips the route is stored XSS.
 *
 *  5. **Nothing that already exists changes.** A template with none of the
 *     three has to come back description null / tags [] / links [], because
 *     that is what every existing widget and schedule is rendering today.
 *
 * Same pattern as its siblings; `--app=` as in verify-t.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";

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
/**
 * Used ONLY to sign fixtures in. `signInWithPassword` mutates the client it is
 * called on, so every later query through it runs as that user.
 */
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * A second publishable-key client that is **never signed in**, for the direct
 * PostgREST reads that stand in for a member of the public.
 *
 * It exists because the first version of this harness did those reads through
 * `anon` above — after signing the org admin in on it. Every "an outsider
 * cannot read this" assertion was really "an org admin can read this", so the
 * three that should have caught a leak reported one that was not there, and
 * the positive control beside them passed for the wrong reason. Two clients is
 * the fix; one client that changes identity halfway through a file cannot be
 * reasoned about.
 */
const publicRead = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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

async function api(path, cookie, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/**
 * The app's week starts on SUNDAY, and an occurrence's week is computed from
 * UTC getters on a session-Date (see rrule/README.md). A fixture week built
 * with local getters silently lands on the wrong Monday and every public read
 * comes back empty — which reads exactly like a broken RLS policy. Anchor on a
 * real Sunday and derive everything from it.
 */
function weekAnchor() {
  const today = new Date();
  const sunday = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
  );
  const iso = (d) => d.toISOString().slice(0, 10);
  // Monday of that week, 17:00 — a time no DST rule can move onto another day.
  const dtstart = new Date(sunday);
  dtstart.setUTCDate(sunday.getUTCDate() + 1);
  return {
    weekStart: iso(sunday),
    dtstart: `${iso(dtstart)}T17:00:00Z`,
    validFrom: iso(sunday),
  };
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const week = weekAnchor();

  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-ab ${stamp}`, slug: `zz-verify-ab-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const adminEmail = `zz-verify-ab-admin-${stamp}@example.invalid`;
  const adminPassword = `Zab!${stamp}aA9`;
  const { data: adminUserData } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  ids.users.push(adminUserData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: adminUserData.user.id, role: "admin" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookie = sessionCookies(signIn.session);

  async function makeFacility(suffix) {
    return (
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name: `ZZ Verify-AB Pool ${suffix}`,
          slug: `zz-verify-ab-pool-${suffix}-${stamp}`,
          address_line1: "1 Test St",
          city: "Vancouver",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: true,
        })
        .select("id")
        .single()
    ).data;
  }

  const facility = await makeFacility("a");
  const otherFacility = await makeFacility("b");

  const lane = (
    await admin
      .from("spaces")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: "ZZ Lane 1",
        slug: `zz-lane-1-${stamp}`,
        display_order: 1,
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  const group = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: `ZZ Verify-AB Schedule ${stamp}`,
        slug: `zz-verify-ab-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        starts_on: week.validFrom,
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  // The public gate from migration 037. Without an approved week every
  // anonymous read below is empty and every assertion would "pass" vacuously.
  await admin.from("schedule_week_reviews").insert({
    org_id: org.id,
    schedule_group_id: group.id,
    week_start: week.weekStart,
    status: "approved",
  });

  console.log("\n1. The vocabulary — tags are facility-scoped and case-insensitively unique");

  const madeTag = await api("/api/tags", cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: facility.id, label: "Women's Only", color: "#DB2777" }),
  });
  check("POST /api/tags creates a tag (201)", madeTag.status === 201, JSON.stringify(madeTag.body));
  const womensTag = madeTag.body.tag;

  const dupe = await api("/api/tags", cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: facility.id, label: "women's ONLY", color: "#2563EB" }),
  });
  check(
    "the same word in another capitalisation is refused (409) — this is what makes it a vocabulary",
    dupe.status === 409,
    `${dupe.status} ${JSON.stringify(dupe.body)}`
  );

  const otherFacilityTag = await api("/api/tags", cookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: otherFacility.id, label: "Women's Only", color: "#DB2777" }),
  });
  check(
    "…but another facility may hold the same word (control — the scope is the facility, not the org)",
    otherFacilityTag.status === 201,
    `${otherFacilityTag.status}`
  );

  const lessonsTag = (
    await api("/api/tags", cookie, {
      method: "POST",
      body: JSON.stringify({ facility_id: facility.id, label: "Lessons", color: "#16A34A" }),
    })
  ).body.tag;
  const deepTag = (
    await api("/api/tags", cookie, {
      method: "POST",
      body: JSON.stringify({ facility_id: facility.id, label: "Deep End", color: "#0891B2" }),
    })
  ).body.tag;

  console.log("\n2. A template carrying all three, created through the real route");

  const created = await api("/api/session-templates", cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: `ZZ Adult Lengths ${stamp}`,
      default_duration_minutes: 60,
      default_space_ids: [lane.id],
      description: "Lanes are set for continuous swimming.\nSelf-select a lane by speed.",
      tag_ids: [womensTag.id, lessonsTag.id, deepTag.id],
      links: [
        { label: "Register here", url: "https://example.invalid/register" },
        { label: "Pool rules", url: "https://example.invalid/rules" },
      ],
    }),
  });
  check("POST accepts all three (201)", created.status === 201, JSON.stringify(created.body));
  const templateId = created.body.sessionTemplate?.id;

  const { data: storedTags } = await admin
    .from("session_template_tags")
    .select("tag_id, display_order")
    .eq("session_template_id", templateId)
    .order("display_order");
  check(
    "tags are stored in the order they were sent — that order decides which two reach a card",
    storedTags?.length === 3 &&
      storedTags[0].tag_id === womensTag.id &&
      storedTags[2].tag_id === deepTag.id,
    JSON.stringify(storedTags)
  );

  const crossFacility = await api(`/api/session-templates/${templateId}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ tag_ids: [otherFacilityTag.body.tag.id] }),
  });
  check(
    "a tag from another facility cannot be attached (400)",
    crossFacility.status === 400,
    `${crossFacility.status} ${JSON.stringify(crossFacility.body)}`
  );

  console.log("\n3. Links: the cap, the label, and the URL scheme");

  const fourLinks = await api(`/api/session-templates/${templateId}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({
      links: [
        { label: "One", url: "https://example.invalid/1" },
        { label: "Two", url: "https://example.invalid/2" },
        { label: "Three", url: "https://example.invalid/3" },
        { label: "Four", url: "https://example.invalid/4" },
      ],
    }),
  });
  check("a fourth link is rejected (400)", fourLinks.status === 400, `${fourLinks.status}`);

  const noLabel = await api(`/api/session-templates/${templateId}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ links: [{ label: "  ", url: "https://example.invalid/x" }] }),
  });
  check("a link with no label is rejected (400)", noLabel.status === 400, `${noLabel.status}`);

  const jsUrl = await api(`/api/session-templates/${templateId}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ links: [{ label: "Click", url: "javascript:alert(1)" }] }),
  });
  check(
    "a javascript: URL is rejected by the route (400)",
    jsUrl.status === 400,
    `${jsUrl.status} ${JSON.stringify(jsUrl.body)}`
  );

  // The route is not the only writer this table can ever have. The CHECK is
  // what protects a public href from anything that skips it.
  const { error: rawJsUrl } = await admin.from("session_template_links").insert({
    session_template_id: templateId,
    org_id: org.id,
    label: "Raw",
    url: "javascript:alert(1)",
    display_order: 2,
  });
  check(
    "…and by the database CHECK, for any writer that skips the route",
    !!rawJsUrl,
    rawJsUrl ? rawJsUrl.code : "insert unexpectedly succeeded"
  );

  const { error: rawFourth } = await admin.from("session_template_links").insert({
    session_template_id: templateId,
    org_id: org.id,
    label: "Fourth",
    url: "https://example.invalid/4",
    display_order: 3,
  });
  check(
    "the cap of 3 is structural — display_order 3 has nowhere to sit",
    !!rawFourth,
    rawFourth ? rawFourth.code : "insert unexpectedly succeeded"
  );

  // Put the two good links back; the rejected PATCHes above left them intact,
  // but assert that rather than assume it.
  const { data: survivingLinks } = await admin
    .from("session_template_links")
    .select("label, display_order")
    .eq("session_template_id", templateId)
    .order("display_order");
  check(
    "a rejected links PATCH left the stored links untouched",
    survivingLinks?.length === 2 && survivingLinks[0].label === "Register here",
    JSON.stringify(survivingLinks)
  );

  console.log("\n4. A public session — the assertion the whole migration exists for");

  const publicSession = (
    await admin
      .from("sessions")
      .insert({
        org_id: org.id,
        schedule_group_id: group.id,
        template_id: templateId,
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
        dtstart: week.dtstart,
        dtend_time: "18:00",
        valid_from: week.validFrom,
        is_active: true,
        occupancy_kind: "drop_in",
        disclosure: "public",
      })
      .select("id")
      .single()
  ).data;
  await admin
    .from("session_spaces")
    .insert({ org_id: org.id, session_id: publicSession.id, space_id: lane.id });

  const anonRead = await api(`/api/sessions/expand?facilityId=${facility.id}`, null);
  const anonOcc = anonRead.body.data?.find((s) => s.sessionId === publicSession.id);
  check(
    "an anonymous caller gets the occurrence at all (control — everything below is vacuous without it)",
    !!anonOcc,
    `${anonRead.status}, ${anonRead.body.data?.length ?? 0} occurrence(s)`
  );

  check(
    "templateName reaches the public — the pre-050 regression, fixed",
    anonOcc?.templateName === `ZZ Adult Lengths ${stamp}`,
    JSON.stringify(anonOcc?.templateName)
  );
  check(
    "templateDescription reaches the public",
    anonOcc?.templateDescription?.startsWith("Lanes are set for continuous swimming."),
    JSON.stringify(anonOcc?.templateDescription)
  );
  check(
    "line breaks in the description survive the round trip",
    anonOcc?.templateDescription?.includes("\n"),
    JSON.stringify(anonOcc?.templateDescription)
  );
  check(
    "all three tags reach the public, in staff order",
    anonOcc?.templateTags?.length === 3 &&
      anonOcc.templateTags[0].label === "Women's Only" &&
      anonOcc.templateTags[2].label === "Deep End",
    JSON.stringify(anonOcc?.templateTags)
  );
  check(
    "a tag carries its colour — the legend entry on a printed board",
    anonOcc?.templateTags?.[0]?.color === "#DB2777",
    JSON.stringify(anonOcc?.templateTags?.[0])
  );
  check(
    "both links reach the public, in order, each with its label",
    anonOcc?.templateLinks?.length === 2 &&
      anonOcc.templateLinks[0].label === "Register here" &&
      anonOcc.templateLinks[0].url === "https://example.invalid/register",
    JSON.stringify(anonOcc?.templateLinks)
  );

  const staffRead = await api(`/api/sessions/expand?facilityId=${facility.id}`, cookie);
  const staffOcc = staffRead.body.data?.find((s) => s.sessionId === publicSession.id);
  check(
    "a signed-in member sees the same three (positive control — the public read is not a redacted stub)",
    staffOcc?.templateDescription === anonOcc?.templateDescription &&
      staffOcc?.templateTags?.length === anonOcc?.templateTags?.length &&
      staffOcc?.templateLinks?.length === anonOcc?.templateLinks?.length,
    JSON.stringify({ staff: staffOcc?.templateTags?.length, anon: anonOcc?.templateTags?.length })
  );

  console.log("\n5. A reserved booking withholds all three — via the API and directly");

  const rentalTemplate = (
    await api("/api/session-templates", cookie, {
      method: "POST",
      body: JSON.stringify({
        facility_id: facility.id,
        name: `ZZ Island Swimming ${stamp}`,
        default_duration_minutes: 120,
        description: "Island Swimming club practice — contact the head coach.",
        tag_ids: [lessonsTag.id],
        links: [{ label: "Club website", url: "https://example.invalid/island-swimming" }],
      }),
    })
  ).body.sessionTemplate;

  const reservedSession = (
    await admin
      .from("sessions")
      .insert({
        org_id: org.id,
        schedule_group_id: group.id,
        template_id: rentalTemplate.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
        dtstart: week.dtstart.replace("T17:00", "T19:00"),
        dtend_time: "21:00",
        valid_from: week.validFrom,
        is_active: true,
        occupancy_kind: "rental",
        disclosure: "reserved",
      })
      .select("id")
      .single()
  ).data;
  await admin
    .from("session_spaces")
    .insert({ org_id: org.id, session_id: reservedSession.id, space_id: lane.id });

  const anonReserved = await api(`/api/sessions/expand?facilityId=${facility.id}`, null);
  const reservedOcc = anonReserved.body.data?.find((s) => s.sessionId === reservedSession.id);
  check(
    "the reserved block is still published to the public (control — the time is the point)",
    !!reservedOcc,
    JSON.stringify(reservedOcc?.sessionId)
  );
  check(
    "its description is withheld",
    reservedOcc?.templateDescription === null,
    JSON.stringify(reservedOcc?.templateDescription)
  );
  check("its tags are withheld", reservedOcc?.templateTags?.length === 0, JSON.stringify(reservedOcc?.templateTags));
  check("its links are withheld", reservedOcc?.templateLinks?.length === 0, JSON.stringify(reservedOcc?.templateLinks));

  const body = JSON.stringify(anonReserved.body);
  check(
    "the renter's name appears nowhere in the public response body",
    !body.includes("Island Swimming"),
    "found 'Island Swimming' in the anonymous payload"
  );

  // The correlation path. sessions.template_id is publicly readable, so an
  // outsider can take it from the reserved row and query the template directly.
  // 050's `s.disclosure = 'public'` condition is the only thing that stops this.
  const { data: leakedTemplate } = await publicRead
    .from("session_templates")
    .select("id, name, description")
    .eq("id", rentalTemplate.id);
  check(
    "a direct read of the reserved template returns nothing",
    (leakedTemplate?.length ?? 0) === 0,
    JSON.stringify(leakedTemplate)
  );

  const { data: leakedLinks } = await publicRead
    .from("session_template_links")
    .select("label, url")
    .eq("session_template_id", rentalTemplate.id);
  check(
    "a direct read of its links returns nothing",
    (leakedLinks?.length ?? 0) === 0,
    JSON.stringify(leakedLinks)
  );

  const { data: leakedTags } = await publicRead
    .from("session_template_tags")
    .select("tag_id")
    .eq("session_template_id", rentalTemplate.id);
  check(
    "a direct read of its tag assignments returns nothing",
    (leakedTags?.length ?? 0) === 0,
    JSON.stringify(leakedTags)
  );

  const { data: readableTemplate } = await publicRead
    .from("session_templates")
    .select("id, name")
    .eq("id", templateId);
  check(
    "…while the public session's template IS directly readable (positive control — the policy is not simply denying everything)",
    readableTemplate?.length === 1,
    JSON.stringify(readableTemplate)
  );

  console.log("\n6. An unpublished schedule keeps its templates private");

  const draftGroup = (
    await admin
      .from("schedule_groups")
      .insert({
        org_id: org.id,
        facility_id: facility.id,
        name: `ZZ Draft ${stamp}`,
        slug: `zz-draft-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "draft",
        starts_on: week.validFrom,
        source: "manual",
      })
      .select("id")
      .single()
  ).data;
  const draftTemplate = (
    await api("/api/session-templates", cookie, {
      method: "POST",
      body: JSON.stringify({
        facility_id: facility.id,
        name: `ZZ Unannounced ${stamp}`,
        default_duration_minutes: 60,
        description: "Not announced yet.",
      }),
    })
  ).body.sessionTemplate;
  await admin.from("sessions").insert({
    org_id: org.id,
    schedule_group_id: draftGroup.id,
    template_id: draftTemplate.id,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: week.dtstart,
    dtend_time: "18:00",
    valid_from: week.validFrom,
    is_active: true,
  });

  const { data: draftRead } = await publicRead
    .from("session_templates")
    .select("id")
    .eq("id", draftTemplate.id);
  check(
    "a template placed only in a draft schedule is not publicly readable",
    (draftRead?.length ?? 0) === 0,
    JSON.stringify(draftRead)
  );

  // A template sitting in the rail, placed on nothing. The EXISTS in the policy
  // is what excludes it — a facility's unplaced templates are working notes.
  const unplacedTemplate = (
    await api("/api/session-templates", cookie, {
      method: "POST",
      body: JSON.stringify({
        facility_id: facility.id,
        name: `ZZ Never Placed ${stamp}`,
        default_duration_minutes: 30,
        description: "Draft idea, not on any schedule.",
      }),
    })
  ).body.sessionTemplate;

  const { data: unplacedRead } = await publicRead
    .from("session_templates")
    .select("id")
    .eq("id", unplacedTemplate.id);
  check(
    "…and neither is one that was never placed at all (same policy, second path)",
    (unplacedRead?.length ?? 0) === 0,
    JSON.stringify(unplacedRead)
  );

  console.log("\n7. Templates that predate 050 render exactly as before");

  const bareTemplate = (
    await api("/api/session-templates", cookie, {
      method: "POST",
      body: JSON.stringify({
        facility_id: facility.id,
        name: `ZZ Plain ${stamp}`,
        default_duration_minutes: 45,
      }),
    })
  ).body.sessionTemplate;
  const bareSession = (
    await admin
      .from("sessions")
      .insert({
        org_id: org.id,
        schedule_group_id: group.id,
        template_id: bareTemplate.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
        dtstart: week.dtstart.replace("T17:00", "T06:00"),
        dtend_time: "07:00",
        valid_from: week.validFrom,
        is_active: true,
      })
      .select("id")
      .single()
  ).data;

  const bareRead = await api(`/api/sessions/expand?facilityId=${facility.id}`, null);
  const bareOcc = bareRead.body.data?.find((s) => s.sessionId === bareSession.id);
  check(
    "no description is null, not an empty string",
    bareOcc?.templateDescription === null,
    JSON.stringify(bareOcc?.templateDescription)
  );
  check(
    "no tags is [], so every view can map without a guard",
    Array.isArray(bareOcc?.templateTags) && bareOcc.templateTags.length === 0,
    JSON.stringify(bareOcc?.templateTags)
  );
  check(
    "no links is []",
    Array.isArray(bareOcc?.templateLinks) && bareOcc.templateLinks.length === 0,
    JSON.stringify(bareOcc?.templateLinks)
  );

  console.log("\n8. Editing the vocabulary reaches every template using it");

  const renamed = await api(`/api/tags/${womensTag.id}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ label: "Women & Non-Binary" }),
  });
  check("a tag can be renamed (200)", renamed.status === 200, `${renamed.status}`);

  const afterRename = await api(`/api/sessions/expand?facilityId=${facility.id}`, null);
  const renamedOcc = afterRename.body.data?.find((s) => s.sessionId === publicSession.id);
  check(
    "the rename reaches the public schedule without touching the template — the point of a table",
    renamedOcc?.templateTags?.[0]?.label === "Women & Non-Binary",
    JSON.stringify(renamedOcc?.templateTags?.[0])
  );

  const deleted = await api(`/api/tags/${deepTag.id}`, cookie, { method: "DELETE" });
  check("a tag can be deleted (200)", deleted.status === 200, `${deleted.status}`);

  const afterDelete = await api(`/api/sessions/expand?facilityId=${facility.id}`, null);
  const afterDeleteOcc = afterDelete.body.data?.find((s) => s.sessionId === publicSession.id);
  check(
    "deleting it drops the chip and leaves the rest — the assignment cascades, the template survives",
    afterDeleteOcc?.templateTags?.length === 2,
    JSON.stringify(afterDeleteOcc?.templateTags)
  );

  console.log("\n9. The link_click analytics event");

  const tracked = await fetch(`${APP}/api/analytics/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "link_click",
      orgId: org.id,
      facilityId: facility.id,
      scheduleGroupId: group.id,
    }),
  });
  check("the track route accepts link_click (200)", tracked.status === 200, `${tracked.status}`);

  // The route swallows insert failures on purpose, so a 200 proves nothing about
  // the CHECK constraint. Only the row does.
  const { data: storedEvent } = await admin
    .from("analytics_events")
    .select("event_type")
    .eq("org_id", org.id)
    .eq("event_type", "link_click");
  check(
    "…and the row is really stored — the route swallows insert errors, so a 200 alone proves nothing",
    (storedEvent?.length ?? 0) === 1,
    JSON.stringify(storedEvent)
  );

  const badEvent = await fetch(`${APP}/api/analytics/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "link_clicked", orgId: org.id }),
  });
  check(
    "an unknown event name is still rejected (400) — the allowlist did not become a passthrough",
    badEvent.status === 400,
    `${badEvent.status}`
  );

  console.log("\n10. Role gate");

  const memberEmail = `zz-verify-ab-member-${stamp}@example.invalid`;
  const memberPassword = `Zab!${stamp}bB9`;
  const { data: memberUser } = await admin.auth.admin.createUser({
    email: memberEmail,
    password: memberPassword,
    email_confirm: true,
  });
  ids.users.push(memberUser.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: memberUser.user.id, role: "member" });
  const { data: memberSignIn } = await anon.auth.signInWithPassword({
    email: memberEmail,
    password: memberPassword,
  });
  const memberCookie = sessionCookies(memberSignIn.session);

  const memberCreate = await api("/api/tags", memberCookie, {
    method: "POST",
    body: JSON.stringify({ facility_id: facility.id, label: `ZZ Member ${stamp}`, color: "#4B5563" }),
  });
  check("a plain member cannot add to the vocabulary (403)", memberCreate.status === 403, `${memberCreate.status}`);

  const memberRead = await api(`/api/tags?facilityId=${facility.id}`, memberCookie);
  check(
    "…but can read it (control — the picker must not go blank for them)",
    memberRead.status === 200 && (memberRead.body.tags?.length ?? 0) > 0,
    `${memberRead.status} ${memberRead.body.tags?.length ?? 0}`
  );

  const strangerCreate = await api("/api/tags", null, {
    method: "POST",
    body: JSON.stringify({ facility_id: facility.id, label: `ZZ Anon ${stamp}`, color: "#4B5563" }),
  });
  check("an anonymous caller cannot (401)", strangerCreate.status === 401, `${strangerCreate.status}`);
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
