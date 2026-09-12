/**
 * Template occupancy defaults (migration 047).
 *
 * Migration 046 put occupancy_kind/disclosure on sessions and asked for them on
 * the full session form. But staff place sessions by dragging templates onto the
 * grid, and that path didn't ask — so a rental placed the fast way came out a
 * public drop-in. This moves the answer onto the template.
 *
 * What has to be proven, in order of how quietly it would fail:
 *
 *  1. A session placed from a rental template **is** a rental, withheld, without
 *     anyone choosing anything at placement time. The failure mode here is a
 *     renter's name published by omission.
 *  2. The dialog's per-placement override wins over the template.
 *  3. They are DEFAULTS, not links. Editing the template afterwards must not
 *     reach back and change sessions already placed from it, and editing one
 *     placed session must not disturb its siblings. A naive implementation that
 *     read through to the template at render time would pass test 1 and fail
 *     these — and would retroactively republish a withheld booking the first
 *     time someone tidied up a template.
 *  4. The 12 templates that already existed still behave as public drop-ins.
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

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-x ${stamp}`, slug: `zz-verify-x-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const adminEmail = `zz-verify-x-admin-${stamp}@example.invalid`;
  const adminPassword = `Zx!${stamp}aA9`;
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

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: "ZZ Verify-X Pool",
        slug: `zz-verify-x-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

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
        name: `ZZ Verify-X Schedule ${stamp}`,
        slug: `zz-verify-x-schedule-${stamp}`,
        sport_category: "swimming",
        activity_type: "drop_in",
        status: "published",
        starts_on: "2026-08-10",
        source: "manual",
      })
      .select("id")
      .single()
  ).data;

  console.log("\n1. A template created before 047 keeps behaving as it did");
  // Inserted without either column, the way every one of Commonwealth's 12
  // existing rows sits in the database.
  const { data: legacyTemplate } = await admin
    .from("session_templates")
    .insert({
      org_id: org.id,
      facility_id: facility.id,
      name: `ZZ Legacy ${stamp}`,
      default_duration_minutes: 60,
      is_active: true,
    })
    .select("id, occupancy_kind, disclosure")
    .single();
  check(
    "an existing template reads as a public drop-in, no backfill needed",
    legacyTemplate?.occupancy_kind === "drop_in" && legacyTemplate?.disclosure === "public",
    JSON.stringify(legacyTemplate)
  );

  console.log("\n2. A rental template, created through the real route");
  const created = await api("/api/session-templates", cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: `ZZ Island Swimming ${stamp}`,
      default_duration_minutes: 120,
      default_space_ids: [lane.id],
      occupancy_kind: "rental",
      disclosure: "reserved",
    }),
  });
  check("POST accepts the two seed fields (201)", created.status === 201, JSON.stringify(created.body));
  const rentalTemplateId = created.body.sessionTemplate?.id;
  check(
    "they are stored, not dropped",
    created.body.sessionTemplate?.occupancy_kind === "rental" &&
      created.body.sessionTemplate?.disclosure === "reserved",
    JSON.stringify(created.body.sessionTemplate)
  );

  const placement = {
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    dtstart: "2026-08-10T06:00:00Z",
    dtend_time: "08:00",
    valid_from: "2026-08-10",
    valid_until: null,
    space_ids: [lane.id],
  };

  console.log("\n3. Placing from that template — nobody chooses anything");
  // Exactly what the command centre now sends: the template's seeds, passed
  // through the dialog untouched.
  const placed = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      template_id: rentalTemplateId,
      ...placement,
      occupancy_kind: "rental",
      disclosure: "reserved",
      holder_name: `ZZHolder${stamp}`,
    }),
  });
  check("the placement saves (200)", placed.status === 200, JSON.stringify(placed.body));

  const { data: placedRow } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", placed.body.sessionId)
    .single();
  check(
    "the session is a rental with its name withheld",
    placedRow?.occupancy_kind === "rental" && placedRow?.disclosure === "reserved",
    JSON.stringify(placedRow)
  );

  console.log("\n4. Placing WITHOUT the seeds is what used to go wrong");
  // The old command-centre payload, kept as a live record of the bug: with no
  // occupancy fields the column defaults apply and a rental becomes a public
  // drop-in. This asserts the old behaviour still exists at the API level (the
  // route must not invent a kind), which is precisely why the *client* has to
  // send the template's values.
  const placedBare = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      template_id: rentalTemplateId,
      ...placement,
      dtstart: "2026-08-11T06:00:00Z",
    }),
  });
  const { data: bareRow } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", placedBare.body.sessionId)
    .single();
  check(
    "the API does NOT read through to the template — it takes the column defaults",
    bareRow?.occupancy_kind === "drop_in" && bareRow?.disclosure === "public",
    JSON.stringify(bareRow)
  );

  console.log("\n5. A per-placement override beats the template");
  // Deliberately at a different hour from section 3's rental. Overriding to
  // `program` makes this an *exclusive* claim, and two exclusive claims on one
  // lane at one time is still a hard 409 (migration 046) — which is the engine
  // working, and which failed this section on its first run when both sat at
  // 6am. The override being tested is the occupancy fields, not the overlap
  // rules, so the fixture keeps them out of each other's way.
  const overridden = await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      schedule_group_id: group.id,
      template_id: rentalTemplateId,
      ...placement,
      dtstart: "2026-08-10T14:00:00Z",
      dtend_time: "15:00",
      occupancy_kind: "program",
      disclosure: "public",
    }),
  });
  check(
    "the override placement saves (200)",
    overridden.status === 200,
    `${overridden.status} ${JSON.stringify(overridden.body)}`
  );
  const { data: overriddenRow } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", overridden.body.sessionId)
    .single();
  check(
    "a session placed from the rental template can be saved as a public program",
    overriddenRow?.occupancy_kind === "program" && overriddenRow?.disclosure === "public",
    JSON.stringify(overriddenRow)
  );

  console.log("\n6. Defaults, not links — the assertion that shapes the design");
  const patched = await api(`/api/session-templates/${rentalTemplateId}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ occupancy_kind: "closure", disclosure: "internal" }),
  });
  check("PATCH accepts the two fields (200)", patched.status === 200, JSON.stringify(patched.body));

  const { data: afterTemplateEdit } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", placed.body.sessionId)
    .single();
  check(
    "editing the template does NOT change a session already placed from it",
    afterTemplateEdit?.occupancy_kind === "rental" && afterTemplateEdit?.disclosure === "reserved",
    JSON.stringify(afterTemplateEdit)
  );

  const { data: templateAfterEdit } = await admin
    .from("session_templates")
    .select("occupancy_kind, disclosure")
    .eq("id", rentalTemplateId)
    .single();
  check(
    "…but the template itself really did change (control for the check above)",
    templateAfterEdit?.occupancy_kind === "closure" && templateAfterEdit?.disclosure === "internal",
    JSON.stringify(templateAfterEdit)
  );

  console.log("\n7. A PATCH that doesn't mention them leaves them alone");
  await api(`/api/session-templates/${rentalTemplateId}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: `ZZ Renamed ${stamp}` }),
  });
  const { data: afterRename } = await admin
    .from("session_templates")
    .select("name, occupancy_kind, disclosure")
    .eq("id", rentalTemplateId)
    .single();
  check(
    "renaming a template keeps its occupancy seeds",
    afterRename?.occupancy_kind === "closure" && afterRename?.disclosure === "internal",
    JSON.stringify(afterRename)
  );
  check("…and the rename landed (control)", afterRename?.name.includes("ZZ Renamed"), JSON.stringify(afterRename));

  console.log("\n8. Editing one placed session doesn't disturb its siblings");
  await api("/api/sessions", cookie, {
    method: "POST",
    body: JSON.stringify({
      sessionId: placed.body.sessionId,
      schedule_group_id: group.id,
      template_id: rentalTemplateId,
      ...placement,
      occupancy_kind: "program",
      disclosure: "public",
      holder_name: "",
    }),
  });
  const { data: siblingRow } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", overridden.body.sessionId)
    .single();
  check(
    "the other session placed from the same template is untouched",
    siblingRow?.occupancy_kind === "program" && siblingRow?.disclosure === "public",
    JSON.stringify(siblingRow)
  );
  const { data: editedRow } = await admin
    .from("sessions")
    .select("occupancy_kind, disclosure")
    .eq("id", placed.body.sessionId)
    .single();
  check(
    "…and the edited one really changed (control)",
    editedRow?.occupancy_kind === "program" && editedRow?.disclosure === "public",
    JSON.stringify(editedRow)
  );

  console.log("\n9. Role gate and validation unchanged");
  const badKind = await api("/api/session-templates", cookie, {
    method: "POST",
    body: JSON.stringify({
      facility_id: facility.id,
      name: `ZZ Bad ${stamp}`,
      default_duration_minutes: 60,
      occupancy_kind: "banquet",
    }),
  });
  check("an unknown occupancy_kind is rejected (400)", badKind.status === 400, `${badKind.status}`);
} finally {
  for (const id of ids.orgs) {
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const id of ids.users) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  const { data: leftover } = await admin.from("organizations").select("id, name").like("name", `%${stamp}%`);
  console.log(
    `\nTeardown: ${leftover?.length ?? 0} org(s) left over${
      leftover?.length ? ` — ${leftover.map((o) => o.name).join(", ")}` : ""
    }`
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
