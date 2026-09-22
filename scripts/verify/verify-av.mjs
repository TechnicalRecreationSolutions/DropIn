/**
 * Dragging a space into place on the Spaces page — with the arrows kept.
 *
 * The page could already reorder with up/down arrows. Drag is the second way
 * in to the same write, so the thing worth proving is not "a drag moved a
 * chip" but that the two ways cannot disagree:
 *
 *   1. Both run one move (`moveSpaceWithinZone`) and both save the WHOLE
 *      facility in render order — a partial list is what `/api/spaces/reorder`
 *      refuses, and what would renumber the rows it left out.
 *   2. A drop is lift-and-insert, not a swap. Dragging lane 4 to the front has
 *      to leave 4,1,2,3 — a swap would leave 4,2,3,1, which looks right for the
 *      chip you dragged and silently wrong for the one you dropped on.
 *   3. A drop outside the dragged space's own zone or department is REFUSED,
 *      not approximated. Crossing a zone is a change of `zone_name`, and
 *      crossing a section a change of `department_id`; this route only ever
 *      renumbers `display_order`, so a drag that appeared to move a lane into
 *      another pool would write a lie.
 *   4. The arrows still work after all of it, and the chip's face still
 *      navigates to the editor — a drag layer over a link is the usual way
 *      that breaks.
 *
 * Section 0 needs nothing running: it imports the real grouping module and
 * asserts 1-3 on it. Sections 1+ drive a real browser, because "a drag works"
 * is a claim about pointer events that no unit test can make.
 *
 *   node --experimental-strip-types scripts/verify/verify-av.mjs --logic-only
 *
 *   npm run dev
 *   node --experimental-strip-types scripts/verify/verify-av.mjs [--headed] [--out=dir]
 *
 * No migration needed — display_order and zone_name are already there (054).
 */
import fs from "fs";
import path from "path";

const LOGIC_ONLY = process.argv.includes("--logic-only");
const APP = process.argv.find((a) => a.startsWith("--app="))?.slice(6) ?? "http://localhost:3000";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";

let pass = 0, fail = 0, skip = 0;
const check = (label, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};
const skipped = (label, why) => { skip++; console.log(`  SKIP  ${label} — ${why}`); };

// =============================================================================
// Section 0 — the move itself, no database, no server, no browser
// =============================================================================

async function logic() {
  console.log("\n  0. the shared move (lib/spaces/grouping.ts)\n");

  const { moveSpaceByStep, moveSpaceOnto, moveSpaceWithinZone, zoneSiblingIds, buildSpaceSections, flattenSections } =
    await import("../../src/lib/spaces/grouping.ts");

  const AQ = "dept-aquatics";
  const FIT = "dept-fitness";
  const departments = [
    { id: AQ, name: "Aquatics" },
    { id: FIT, name: "Fitness" },
  ];

  const space = (name, departmentId, zoneName) => ({
    id: name, name, isPublished: true, departmentId, zoneName,
  });

  /**
   * One facility with every shape the page can render: a multi-lane zone, a
   * second zone in the same department, a zone-less bucket, another
   * department, and a space with no department at all ("Whole building").
   */
  const facility = [
    space("Lane 1", AQ, "Main Pool"),
    space("Lane 2", AQ, "Main Pool"),
    space("Lane 3", AQ, "Main Pool"),
    space("Lane 4", AQ, "Main Pool"),
    space("Leisure A", AQ, "Leisure Pool"),
    space("Leisure B", AQ, "Leisure Pool"),
    space("Hot Tub", AQ, null),
    space("Studio", FIT, null),
    space("Weight Room", FIT, null),
    space("Parking Lot", null, null),
  ];
  const names = (list) => (list ?? []).map((s) => s.name).join(",");
  const ALL = names(facility);

  // --- the whole facility comes back, always ---------------------------------
  const stepped = moveSpaceByStep(facility, departments, "Lane 1", 1);
  check("a move returns every space in the facility, not the moved pair",
    stepped.length === facility.length, `${stepped.length} of ${facility.length}`);
  check("and the same set of ids",
    new Set(stepped.map((s) => s.id)).size === facility.length &&
    stepped.every((s) => facility.some((f) => f.id === s.id)));
  check("the input list is left alone (the optimistic state is the caller's)",
    names(facility) === ALL, names(facility));

  // --- arrows -----------------------------------------------------------------
  check("arrow down swaps a lane with the one below it",
    names(stepped).startsWith("Lane 2,Lane 1,Lane 3,Lane 4"), names(stepped));
  check("arrow up is its inverse",
    names(moveSpaceByStep(stepped, departments, "Lane 1", -1)) === ALL,
    names(moveSpaceByStep(stepped, departments, "Lane 1", -1)));
  check("arrow off the top of a zone is refused",
    moveSpaceByStep(facility, departments, "Lane 1", -1) === null);
  check("arrow off the bottom of a zone is refused",
    moveSpaceByStep(facility, departments, "Lane 4", 1) === null);
  check("the first space of a LATER zone cannot step into the zone above it",
    moveSpaceByStep(facility, departments, "Leisure A", -1) === null);

  // --- drops ------------------------------------------------------------------
  const dropped = moveSpaceOnto(facility, departments, "Lane 4", "Lane 1");
  check("a drop is lift-and-insert: 4 to the front leaves 4,1,2,3",
    names(dropped).startsWith("Lane 4,Lane 1,Lane 2,Lane 3"), names(dropped));
  check("positive control: that is NOT what a swap would give (4,2,3,1)",
    !names(dropped).startsWith("Lane 4,Lane 2,Lane 3,Lane 1"));
  check("dragging back down restores the original order",
    names(moveSpaceOnto(dropped, departments, "Lane 4", "Lane 3")) === ALL,
    names(moveSpaceOnto(dropped, departments, "Lane 4", "Lane 3")));

  check("an adjacent drop and the arrow agree exactly",
    names(moveSpaceOnto(facility, departments, "Lane 1", "Lane 2")) === names(stepped),
    `${names(moveSpaceOnto(facility, departments, "Lane 1", "Lane 2"))} vs ${names(stepped)}`);

  check("a drop on itself is a no-op, not a rewrite",
    moveSpaceOnto(facility, departments, "Lane 2", "Lane 2") === null);
  check("a drop on an unknown space is refused",
    moveSpaceOnto(facility, departments, "Lane 2", "Lane 99") === null);
  check("an unknown space cannot be dragged",
    moveSpaceOnto(facility, departments, "Lane 99", "Lane 2") === null);

  // --- the refusals that stop a drag writing a lie -----------------------------
  check("a drop into ANOTHER ZONE of the same department is refused",
    moveSpaceOnto(facility, departments, "Lane 1", "Leisure A") === null);
  check("a drop into the zone-less bucket is refused",
    moveSpaceOnto(facility, departments, "Lane 1", "Hot Tub") === null);
  check("a drop into ANOTHER DEPARTMENT is refused",
    moveSpaceOnto(facility, departments, "Lane 1", "Studio") === null);
  check("a drop into the whole-building bucket is refused",
    moveSpaceOnto(facility, departments, "Lane 1", "Parking Lot") === null);
  check("positive control: the same lane CAN be dropped inside its own zone",
    moveSpaceOnto(facility, departments, "Lane 1", "Lane 3") !== null);

  // --- everything the move did not touch stays put -----------------------------
  const far = moveSpaceOnto(facility, departments, "Lane 4", "Lane 1");
  check("a lane move leaves the other zones untouched",
    names(far).endsWith("Leisure A,Leisure B,Hot Tub,Studio,Weight Room,Parking Lot"), names(far));
  const otherDept = moveSpaceOnto(facility, departments, "Weight Room", "Studio");
  check("a move in one department leaves the other alone",
    names(otherDept).startsWith("Lane 1,Lane 2,Lane 3,Lane 4,Leisure A,Leisure B,Hot Tub"), names(otherDept));
  check("and moves the two it was given",
    names(otherDept).endsWith("Weight Room,Studio,Parking Lot"), names(otherDept));

  // --- saved order == rendered order --------------------------------------------
  check("what a move returns is exactly what the page renders top to bottom",
    names(flattenSections(buildSpaceSections(far, departments))) === names(far));

  // --- the drop-target set the chips light up from --------------------------------
  check("a lane's drop targets are its own zone, itself included",
    zoneSiblingIds(facility, departments, "Lane 2").join(",") === "Lane 1,Lane 2,Lane 3,Lane 4");
  check("a zone-less space's targets do not leak in the zones above it",
    zoneSiblingIds(facility, departments, "Hot Tub").join(",") === "Hot Tub");
  check("an unknown space offers no targets at all",
    zoneSiblingIds(facility, departments, "Lane 99").length === 0);

  // --- the index form both callers sit on -------------------------------------
  check("moving to the slot already held is refused",
    moveSpaceWithinZone(facility, departments, "Lane 2", 1) === null);
  check("an index past the end of the zone is refused",
    moveSpaceWithinZone(facility, departments, "Lane 2", 4) === null);
  check("a negative index is refused",
    moveSpaceWithinZone(facility, departments, "Lane 2", -1) === null);
}

// =============================================================================
// Sections 1+ — a real pointer, a real page, a real database
// =============================================================================

async function browser() {
  const { createClient } = await import("@supabase/supabase-js");
  const { stringToBase64URL } = await import("@supabase/ssr/dist/main/utils/base64url.js");
  const { chromium } = await import("playwright");

  const env = Object.fromEntries(
    fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );

  const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
  const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const COOKIE_NAME = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  function cookieParts(session) {
    const value = "base64-" + stringToBase64URL(JSON.stringify(session));
    const MAX = 3180;
    if (value.length <= MAX) return [{ name: COOKIE_NAME, value }];
    const out = [];
    for (let i = 0, n = 0; i < value.length; i += MAX, n++) out.push({ name: `${COOKIE_NAME}.${n}`, value: value.slice(i, i + MAX) });
    return out;
  }

  const stamp = Date.now().toString(36);
  const ids = { orgs: [], users: [] };

  try {
    const { data: org } = await admin.from("organizations")
      .insert({ name: `ZZ drag ${stamp}`, slug: `zz-drag-${stamp}`, status: "active" }).select("id").single();
    ids.orgs.push(org.id);

    const email = `zz-drag-${stamp}@example.invalid`;
    const password = `Zk!${stamp}aA9`;
    const { data: userData } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    ids.users.push(userData.user.id);
    // 'owner', not the pre-055 'admin' — reordering needs facility:edit.
    await admin.from("org_memberships").insert({ org_id: org.id, user_id: userData.user.id, role: "owner" });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password });

    const { data: facility } = await admin.from("facilities").insert({
      org_id: org.id, name: `ZZ Crystal Pool ${stamp}`, slug: `zz-drag-cp-${stamp}`,
      address_line1: "1 Test St", city: "Victoria", province: "BC", postal_code: "V0V 0V0", is_published: true,
    }).select("id").single();

    const { data: aquatics } = await admin.from("departments").insert({
      org_id: org.id, facility_id: facility.id, name: "Aquatics",
      slug: `zz-drag-aq-${stamp}`, display_order: 0, is_published: true,
    }).select("id").single();

    const LANES = ["Lane 1", "Lane 2", "Lane 3", "Lane 4", "Lane 5", "Lane 6"];
    const { error: zoneProbe } = await admin.from("spaces").select("zone_name").limit(1);
    const hasZones = !zoneProbe;

    // Distinct display_order from the start, so a wrong order later is the
    // page's doing and not a heap-order tie (the bug verify-aj was built on).
    let order = 1;
    const spaceIds = {};
    const addSpace = async (name, zone) => {
      const row = {
        org_id: org.id, facility_id: facility.id, department_id: aquatics.id,
        name, slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
        display_order: order++, is_published: true,
      };
      if (hasZones) row.zone_name = zone;
      const { data } = await admin.from("spaces").insert(row).select("id").single();
      spaceIds[name] = data.id;
    };
    for (const name of LANES) await addSpace(name, "Main Pool");
    // A second zone — the drag must refuse to cross into it.
    await addSpace("Leisure Area", "Leisure Pool");

    const browserInstance = await chromium.launch({ headless: !process.argv.includes("--headed") });
    const context = await browserInstance.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addCookies(cookieParts(signIn.session).map((c) => ({ ...c, domain: "localhost", path: "/" })));
    const page = await context.newPage();

    /**
     * dnd-kit's `attributes` bundle carries an `aria-describedby` built from a
     * counter that restarts on the client, so spreading it onto the handle
     * hydrates with a mismatch on every chip — silent in production, and it
     * leaves the page's event handlers unattached in the part of the tree React
     * gives up on. Cheap to watch for, so watched for.
     */
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(String(e.message)));

    /** The chips in render order, read the way the page actually lays them out. */
    const rendered = () =>
      page.locator("[data-space-id]").evaluateAll((els) =>
        els.map((e) => e.querySelector(".truncate")?.textContent?.trim()).filter(Boolean)
      );

    /** display_order as the database holds it, lowest first. */
    async function stored() {
      const { data } = await admin.from("spaces").select("name, display_order")
        .eq("facility_id", facility.id).order("display_order", { ascending: true });
      return data.map((r) => r.name);
    }

    /**
     * Drag one chip onto another with a real pointer.
     *
     * Presses on the grip, not the chip face — the face is the edit link, and
     * pressing it is how a user opens a space rather than moves it. The move is
     * stepped: dnd-kit only starts a drag after 4px of travel, and a single
     * jump from A to B produces one pointermove that the sensor never sees as
     * a drag beginning.
     */
    async function drag(fromName, toName) {
      const handle = page.locator(`[data-space-id="${spaceIds[fromName]}"] [data-drag-handle]`);
      const target = page.locator(`[data-space-id="${spaceIds[toName]}"]`);
      const a = await handle.boundingBox();
      const b = await target.boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
    }

    /** Both writes are optimistic — wait for the page to say it finished saving. */
    const settled = () => page.locator('[data-saving="false"]').first().waitFor({ timeout: 10000 });

    try {
      console.log("\n  1. the page, before anything is dragged\n");
      await page.goto(`${APP}/dashboard/spaces?facility=${facility.id}`, { waitUntil: "networkidle" });

      const before = await rendered();
      check("the six lanes render in display_order", before.slice(0, 6).join(",") === LANES.join(","), before.join(", "));
      check("every chip has a drag handle",
        (await page.locator("[data-space-id] [data-drag-handle]").count()) === 7,
        String(await page.locator("[data-space-id] [data-drag-handle]").count()));
      check("the arrows are still there too",
        (await page.locator('button[aria-label^="Move Lane "]').count()) === 12,
        String(await page.locator('button[aria-label^="Move Lane "]').count()));
      check("the drag layer hydrates cleanly",
        !consoleErrors.some((t) => /hydrat/i.test(t)),
        consoleErrors.find((t) => /hydrat/i.test(t))?.slice(0, 120));

      console.log("\n  2. a drag moves a lane, and the move is written\n");
      await drag("Lane 5", "Lane 1");
      const afterDrag = await rendered();
      check("Lane 5 lands where Lane 1 was",
        afterDrag.slice(0, 6).join(",") === "Lane 5,Lane 1,Lane 2,Lane 3,Lane 4,Lane 6", afterDrag.join(", "));
      check("positive control: that is not where it started", before.join(",") !== afterDrag.join(","));

      await settled();
      const storedAfterDrag = await stored();
      check("the database agrees with the screen",
        storedAfterDrag.slice(0, 6).join(",") === "Lane 5,Lane 1,Lane 2,Lane 3,Lane 4,Lane 6", storedAfterDrag.join(", "));
      const { data: rows } = await admin.from("spaces").select("display_order").eq("facility_id", facility.id);
      check("display_order is 1..N with no gaps or ties",
        new Set(rows.map((r) => r.display_order)).size === rows.length &&
        Math.max(...rows.map((r) => r.display_order)) === rows.length,
        rows.map((r) => r.display_order).sort((x, y) => x - y).join(","));

      await page.reload({ waitUntil: "networkidle" });
      const afterReload = await rendered();
      check("the drag survives a reload",
        afterReload.slice(0, 6).join(",") === "Lane 5,Lane 1,Lane 2,Lane 3,Lane 4,Lane 6", afterReload.join(", "));

      console.log("\n  3. a drag across a zone is refused, not approximated\n");
      if (hasZones) {
        const zoneBefore = await rendered();
        const { data: leisureBefore } = await admin.from("spaces")
          .select("zone_name, department_id, display_order").eq("id", spaceIds["Leisure Area"]).single();

        await drag("Lane 5", "Leisure Area");
        const zoneAfter = await rendered();
        check("the order does not change", zoneBefore.join(",") === zoneAfter.join(","), zoneAfter.join(", "));

        const { data: laneRow } = await admin.from("spaces")
          .select("zone_name, department_id").eq("id", spaceIds["Lane 5"]).single();
        check("the dragged lane keeps its own zone", laneRow.zone_name === "Main Pool", String(laneRow.zone_name));
        const { data: leisureAfter } = await admin.from("spaces")
          .select("zone_name, department_id, display_order").eq("id", spaceIds["Leisure Area"]).single();
        check("the space it was dropped on is untouched",
          leisureAfter.display_order === leisureBefore.display_order &&
          leisureAfter.zone_name === leisureBefore.zone_name);
        // Positive control. Without it, "the order did not change" would also
        // pass on a page where dragging had stopped working entirely.
        const slot = zoneAfter.indexOf("Lane 3");
        await drag("Lane 5", "Lane 3");
        const sameZone = await rendered();
        check("positive control: the SAME lane still drags inside its own zone",
          sameZone.indexOf("Lane 5") === slot, `wanted index ${slot} — got ${sameZone.join(", ")}`);
        await settled();
      } else {
        skipped("cross-zone drop refused", "migration 054 not applied — there are no zones to cross");
        skipped("dragged lane keeps its zone", "migration 054 not applied");
        skipped("drop target untouched", "migration 054 not applied");
        skipped("positive control: same-zone drag still works", "migration 054 not applied");
      }

      console.log("\n  4. the arrows and the chip's link still work\n");
      const armsBefore = await rendered();
      const first = armsBefore[0];
      await page.locator(`button[aria-label="Move ${first} down"]`).click();
      await page.waitForFunction(
        (name) => {
          const chips = [...document.querySelectorAll("[data-space-id] .truncate")].map((e) => e.textContent.trim());
          return chips[0] !== name;
        },
        first,
        { timeout: 5000 }
      );
      const armsAfter = await rendered();
      check("an arrow still moves a chip after a drag",
        armsAfter[1] === first && armsAfter[0] === armsBefore[1], armsAfter.join(", "));
      await settled();
      check("and the arrow's move is written too", (await stored())[1] === first, (await stored()).join(", "));

      await page.locator(`[data-space-id="${spaceIds["Lane 1"]}"] a[aria-label^="Edit "]`).click();
      await page.waitForURL(/\/spaces\/[0-9a-f-]+\/edit/, { timeout: 10000 });
      check("clicking a chip's face still opens the editor", page.url().includes(spaceIds["Lane 1"]), page.url());

      console.log("\n  5. on a phone\n");
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`${APP}/dashboard/spaces?facility=${facility.id}`, { waitUntil: "networkidle" });
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      check("no horizontal overflow at 390px", scrollW <= 390, `scrollWidth ${scrollW}`);
      const handleBox = await page.locator("[data-space-id] [data-drag-handle]").first().boundingBox();
      check("the handle is a full-height strip, not a glyph-sized target",
        handleBox.width >= 24 && handleBox.height >= 40,
        `${Math.round(handleBox.width)}x${Math.round(handleBox.height)}`);
      check("the handle does not swallow the tab order (the arrows are the keyboard path)",
        (await page.locator("[data-space-id] [data-drag-handle]").first().getAttribute("tabindex")) === "-1");
      await page.screenshot({ path: path.join(OUT, "spaces-drag-mobile.png"), fullPage: true });
    } finally {
      await browserInstance.close();
    }
  } finally {
    for (const id of ids.orgs) await admin.from("organizations").delete().eq("id", id);
    for (const id of ids.users) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: left } = await admin.from("organizations").select("id").like("name", `%${stamp}%`);
    console.log(`\n  teardown: ${left?.length ?? 0} fixture orgs left behind`);
  }
}

async function main() {
  await logic();
  if (LOGIC_ONLY) return;
  await browser();
}

main()
  .catch((e) => { fail++; console.error(`  ERROR ${e.stack ?? e.message}`); })
  .finally(() => {
    console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  });
