/**
 * The session-template form as three steps, driven in a real browser.
 *
 * The form was one flat card of eight field groups — survivable at five, not at
 * eight once migration 050 added description, tags and links. This harness
 * checks the things a restructuring is most likely to have broken, in order of
 * how quietly they would fail:
 *
 *  1. **It still saves everything.** A layout change that silently drops a
 *     field from the payload looks perfect on screen and loses work. §4 fills
 *     every control through the UI and then reads the database back — not the
 *     response body, which would only prove the form posted what it posted.
 *
 *  2. **Edit mode still round-trips.** A template created with all three of
 *     050's fields has to come back with every step pre-filled, or staff
 *     re-typing a description is how a form teaches people not to trust it.
 *
 *  3. **The speed claims are real, not decorative.** One tap sets a duration,
 *     one tap selects every lane, and the save button is reachable without
 *     scrolling to the bottom of three steps. Each is asserted as an
 *     interaction, not as the presence of a button.
 *
 *  4. **The preview shows what will actually be published.** It is the only
 *     place colour (step 1) and tags (step 3) are seen together on the card
 *     they produce.
 *
 * `--headed` to watch it. `--shots=<dir>` to write screenshots.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";
import { chromium } from "playwright";

const APP =
  process.argv.find((a) => a.startsWith("--app="))?.slice("--app=".length) ??
  "http://localhost:3000";
const HEADED = process.argv.includes("--headed");
const SHOTS = process.argv.find((a) => a.startsWith("--shots="))?.slice(8) ?? null;

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

function sessionCookiePairs(session) {
  const value = "base64-" + stringToBase64URL(JSON.stringify(session));
  const MAX = 3180;
  if (value.length <= MAX) return [[COOKIE_NAME, value]];
  const pairs = [];
  for (let i = 0, n = 0; i < value.length; i += MAX, n++)
    pairs.push([`${COOKIE_NAME}.${n}`, value.slice(i, i + MAX)]);
  return pairs;
}

const stamp = Date.now();
const ids = { users: [], orgs: [] };

try {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: `ZZ verify-ac ${stamp}`, slug: `zz-verify-ac-${stamp}`, status: "active" })
      .select("id")
      .single()
  ).data;
  ids.orgs.push(org.id);

  const email = `zz-verify-ac-${stamp}@example.invalid`;
  const password = `Zac!${stamp}aA9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  ids.users.push(userData.user.id);
  await admin
    .from("org_memberships")
    .insert({ org_id: org.id, user_id: userData.user.id, role: "admin" });

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const cookiePairs = sessionCookiePairs(signIn.session);

  const facility = (
    await admin
      .from("facilities")
      .insert({
        org_id: org.id,
        name: `ZZ Verify-AC Pool ${stamp}`,
        slug: `zz-verify-ac-pool-${stamp}`,
        address_line1: "1 Test St",
        city: "Vancouver",
        province: "BC",
        postal_code: "V0V 0V0",
        is_published: true,
      })
      .select("id")
      .single()
  ).data;

  // Four lanes, so "Select all" has something to prove.
  const laneNames = ["ZZ Lane 1", "ZZ Lane 2", "ZZ Lane 3", "ZZ Lane 4"];
  for (const [i, laneName] of laneNames.entries()) {
    await admin.from("spaces").insert({
      org_id: org.id,
      facility_id: facility.id,
      name: laneName,
      slug: `zz-ac-lane-${i + 1}-${stamp}`,
      display_order: i + 1,
      is_published: true,
    });
  }

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(
      cookiePairs.map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
    );
    const page = await context.newPage();

    /**
     * React's cross-component setState warning, collected for §9.
     *
     * Lifting the tag vocabulary up to the form introduced exactly this: the
     * parent's setter was called from inside a `setTags(prev => …)` updater,
     * and React may run an updater during render. It broke nothing visible —
     * the tag saved, the preview drew — so only the console said so. Matched
     * narrowly rather than asserting a clean console, because this page also
     * logs an unrelated Next.js prerender warning.
     */
    const renderPhaseWarnings = [];
    page.on("console", (m) => {
      const text = m.text();
      if (text.includes("while rendering a different component")) renderPhaseWarnings.push(text);
    });

    const templateName = `ZZ Adult Lengths ${stamp}`;

    console.log("\n1. The form reads as three numbered steps");

    await page.goto(`${APP}/dashboard/sessions/new?facility=${facility.id}`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel("Template name *").waitFor({ state: "visible", timeout: 30000 });

    for (const [n, title] of [
      [1, "Name and colour"],
      [2, "Defaults"],
      [3, "Public details"],
    ]) {
      check(
        `step ${n} — "${title}" is present`,
        await page.getByRole("heading", { name: title }).isVisible()
      );
    }

    check(
      "the name field has focus on arrival — no click needed to start typing",
      await page.getByLabel("Template name *").evaluate((el) => el === document.activeElement)
    );

    console.log("\n2. Save is reachable, and gated");

    const saveButton = page.getByRole("button", { name: "Create template" });
    check("the save button is visible without scrolling", await saveButton.isVisible());
    check("…and is disabled while the name is empty", await saveButton.isDisabled());

    // The sticky bar's whole purpose: still on screen at the top of the form.
    const barBox = await saveButton.boundingBox();
    check(
      "it sits inside the viewport at the top of the form (sticky, not at the end of three steps)",
      !!barBox && barBox.y < 900,
      JSON.stringify(barBox)
    );

    await page.getByLabel("Template name *").fill(templateName);
    check("typing a name enables save", await saveButton.isEnabled());

    // The sticky bar and the mobile bottom nav are both `fixed bottom-0`, and
    // the nav wins at z-50 — so at bottom-0 the save button is not merely
    // overlapped, it is entirely invisible on a phone. Measured, not eyeballed:
    // before the fix the nav occupied 779–844 and the button 790–832.
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneSave = await saveButton.boundingBox();
    const phoneNav = await page.evaluate(() => {
      const nav = [...document.querySelectorAll("nav")].find(
        (n) => getComputedStyle(n).position === "fixed"
      );
      if (!nav) return null;
      const r = nav.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    check(
      "on a phone the bottom nav is present (control — without it this assertion proves nothing)",
      !!phoneNav,
      JSON.stringify(phoneNav)
    );
    check(
      "…and the save button clears it instead of hiding behind it",
      !!phoneSave && !!phoneNav && phoneSave.y + phoneSave.height <= phoneNav.top,
      JSON.stringify({ save: phoneSave, nav: phoneNav })
    );
    check(
      "…while still being on screen",
      !!phoneSave && phoneSave.y > 0 && phoneSave.y < 844,
      JSON.stringify(phoneSave)
    );
    check(
      "the step summary is visible on a phone, not dropped with the desktop header",
      ((await page
        .locator("section", { has: page.getByRole("heading", { name: "Defaults" }) })
        .textContent()) ?? "").includes("Drop-in")
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    console.log("\n3. One tap each for the two slowest choices");

    await page.getByRole("button", { name: "1 hr 30 min", exact: true }).click();
    check(
      "a duration chip sets the custom field too — one tap, no typing",
      (await page.getByLabel("Custom duration in minutes").inputValue()) === "90"
    );

    await page.getByRole("button", { name: "Select all" }).click();
    for (const laneName of laneNames) {
      check(
        `"Select all" selected ${laneName}`,
        (await page.getByRole("button", { name: laneName, exact: true }).getAttribute("aria-pressed")) ===
          "true"
      );
    }
    check(
      "…and the control flips to Clear all",
      await page.getByRole("button", { name: "Clear all" }).isVisible()
    );

    console.log("\n4. Step 2's header summarises itself");

    const step2 = page.locator("section", { has: page.getByRole("heading", { name: "Defaults" }) });
    const step2Text = (await step2.textContent()) ?? "";
    check(
      "the header shows the duration, space count and occupancy without scrolling into the step",
      step2Text.includes("1 hr 30 min") && step2Text.includes("all spaces"),
      step2Text.slice(0, 160)
    );

    console.log("\n5. A tag can be created from the form, and the preview shows it");

    await page.getByRole("button", { name: "New tag" }).click();
    await page.getByPlaceholder("Women's Only, 55+, Lessons").fill("Women's Only");
    // Wait on the POST itself, not on the panel disappearing. `waitFor({state:
    // "hidden"})` against a locator that matches nothing resolves immediately,
    // so the first version of this raced the request and read an empty table
    // back — a harness bug that looked exactly like a form that never saved.
    const tagCreated = page.waitForResponse(
      (r) => r.url().includes("/api/tags") && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /Add to this facility/ }).click();
    const tagResponse = await tagCreated;
    check(
      "POST /api/tags returns 201 from inside the form",
      tagResponse.status() === 201,
      String(tagResponse.status())
    );

    const { data: vocabRow } = await admin
      .from("tags")
      .select("id, label")
      .eq("facility_id", facility.id);
    check(
      "the tag really entered the facility's vocabulary",
      vocabRow?.length === 1 && vocabRow[0].label === "Women's Only",
      JSON.stringify(vocabRow)
    );

    const preview = page.locator("section", {
      has: page.getByRole("heading", { name: "Public details" }),
    });
    const previewText = (await preview.textContent()) ?? "";
    check(
      "the live card preview shows the template name",
      previewText.includes(templateName),
      previewText.slice(0, 200)
    );
    check(
      "…and the tag chip that was just created, selected automatically",
      previewText.includes("Women's Only"),
      previewText.slice(0, 200)
    );

    console.log("\n6. Everything typed is everything saved");

    await page
      .getByLabel("Description")
      .fill("Lanes are set for continuous swimming.\nSelf-select a lane by speed.");
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByLabel("Link 1 label").fill("Register here");
    await page.getByLabel("Link 1 URL").fill("https://example.invalid/register");

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, "template-form-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(SHOTS, "template-form-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    await saveButton.click();
    await page.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 30000 });

    const { data: saved } = await admin
      .from("session_templates")
      .select(
        "id, name, color, description, default_duration_minutes, occupancy_kind, disclosure, session_template_spaces ( space_id ), session_template_tags ( tag_id ), session_template_links ( label, url )"
      )
      .eq("facility_id", facility.id)
      .single();

    check("the template was created", !!saved, JSON.stringify(saved));
    check("name saved", saved?.name === templateName, saved?.name);
    check("the chip's duration saved", saved?.default_duration_minutes === 90, `${saved?.default_duration_minutes}`);
    check(
      "all four spaces saved from one Select all",
      saved?.session_template_spaces?.length === 4,
      `${saved?.session_template_spaces?.length}`
    );
    check(
      "the description saved with its line break intact",
      saved?.description?.includes("\n"),
      JSON.stringify(saved?.description)
    );
    check("the tag assignment saved", saved?.session_template_tags?.length === 1, JSON.stringify(saved?.session_template_tags));
    check(
      "the link saved with its label",
      saved?.session_template_links?.length === 1 &&
        saved.session_template_links[0].label === "Register here",
      JSON.stringify(saved?.session_template_links)
    );
    check("a colour saved", /^#[0-9A-Fa-f]{6}$/.test(saved?.color ?? ""), saved?.color);

    console.log("\n7. Edit mode pre-fills all three steps");

    await page.goto(`${APP}/dashboard/sessions/${saved.id}/edit`, { waitUntil: "networkidle" });
    await page.getByLabel("Template name *").waitFor({ state: "visible", timeout: 30000 });

    check(
      "step 1 — the name comes back",
      (await page.getByLabel("Template name *").inputValue()) === templateName
    );
    check(
      "step 2 — the duration comes back",
      (await page.getByLabel("Custom duration in minutes").inputValue()) === "90"
    );
    check(
      "step 2 — all four lanes come back selected",
      (await page.getByRole("button", { name: "Clear all" }).isVisible())
    );
    check(
      "step 3 — the description comes back",
      (await page.getByLabel("Description").inputValue()).includes("continuous swimming")
    );
    check(
      "step 3 — the link label comes back (not just the URL)",
      (await page.getByLabel("Link 1 label").inputValue()) === "Register here"
    );
    check(
      "step 3 — the tag comes back selected, so the preview is populated",
      ((await page
        .locator("section", { has: page.getByRole("heading", { name: "Public details" }) })
        .textContent()) ?? "").includes("Women's Only")
    );
    check(
      "the button now reads Save changes, not Create template",
      await page.getByRole("button", { name: "Save changes" }).isVisible()
    );

    console.log("\n8. A tags-only edit saves without a 404");

    // This is the bug verify-ab caught: a PATCH carrying only tag_ids built an
    // empty update, matched no rows, and returned "Session template not found"
    // while writing nothing. Through the UI it needs a field that changes only
    // the tag set.
    await page.getByRole("button", { name: /Women's Only/ }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL((u) => !u.pathname.endsWith("/edit"), { timeout: 30000 });

    const { data: afterUntag } = await admin
      .from("session_template_tags")
      .select("tag_id")
      .eq("session_template_id", saved.id);
    check(
      "deselecting the only tag really cleared it",
      (afterUntag?.length ?? 0) === 0,
      JSON.stringify(afterUntag)
    );

    const { data: stillThere } = await admin
      .from("session_templates")
      .select("name, description, default_duration_minutes")
      .eq("id", saved.id)
      .single();
    check(
      "…and left the rest of the template alone",
      stillThere?.name === templateName && stillThere?.default_duration_minutes === 90,
      JSON.stringify(stillThere)
    );

    console.log("\n9. No render-phase state updates");

    check(
      "lifting the tag vocabulary to the form did not introduce a cross-component setState during render",
      renderPhaseWarnings.length === 0,
      renderPhaseWarnings[0]?.slice(0, 160)
    );

    if (SHOTS) console.log(`\nScreenshots written to ${SHOTS}`);
  } finally {
    await browser.close();
  }
} finally {
  for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
  for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});

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
