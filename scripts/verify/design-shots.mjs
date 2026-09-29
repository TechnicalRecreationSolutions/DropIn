/**
 * Screenshots for the design work in docs/DESIGN.md §10.
 *
 * Unlike the verify-* harnesses this asserts almost nothing about behaviour. It
 * takes the pictures §10 asks for (1440 px and 390 px, light and dark) of every
 * dashboard screen, from one fixture that is kept between runs so a "before"
 * and an "after" show the same data.
 *
 *   npm run dev
 *   node scripts/verify/design-shots.mjs --setup                 # build the fixture once
 *   node scripts/verify/design-shots.mjs --shots --label=before  # every route, 4 pictures each
 *   node scripts/verify/design-shots.mjs --shots --label=after --only=settings,login
 *   node scripts/verify/design-shots.mjs --landing --label=before
 *   node scripts/verify/design-shots.mjs --compare=landing-before,landing-after
 *   node scripts/verify/design-shots.mjs --teardown              # delete the fixture
 *
 * Options: --app=http://localhost:3000  --out=.design-shots  --only=a,b (substring
 * of a route name)  --widths=1440,390  --themes=light,dark  --headed
 *
 * What it does check, because a picture of an error page is worthless: every
 * route answers below 400, nothing is logged to console.error, and the page is
 * not wider than the viewport. Those are printed as FAIL and set the exit code.
 *
 * The landing page is compared pixel for pixel (--compare) because the brief
 * for the dashboard redesign is that the landing page must not change.
 */
import fs from "fs";
import path from "path";

const arg = (name, fallback = null) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = (name) => process.argv.includes(`--${name}`);

const APP = arg("app", "http://localhost:3000");
const OUT = arg("out", ".design-shots");
const LABEL = arg("label", "shots");
const ONLY = arg("only")?.split(",").filter(Boolean) ?? null;
const WIDTHS = arg("widths", "1440,390").split(",").map(Number);
const THEMES = arg("themes", "light,dark").split(",");
const STATE = path.join(OUT, "fixture.json");

let fail = 0;
const bad = (msg) => {
  fail++;
  console.log(`  FAIL  ${msg}`);
};

function readEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

async function clients() {
  const { createClient } = await import("@supabase/supabase-js");
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  return {
    url,
    admin: createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
    anon: createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }),
  };
}

const must = (label, { data, error }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────
//
//   ZZ Design Org
//     └── ZZ Design Centre (published)
//           ├── Aquatics  ── Lanes 1-6 ── Lap Swim (published), Public Swim (published),
//           │                             Aquafit (draft)
//           └── Gymnasium ── Court A/B ── Open Gym (published)
//         four session templates, one live notice, one double-booked lane
//
// The double booking is deliberate: it is what puts the warning and conflict
// states on screen.
async function setup() {
  if (fs.existsSync(STATE)) {
    console.log(`  fixture already exists (${STATE}); --teardown first to rebuild it`);
    return;
  }
  const { admin } = await clients();
  const stamp = Date.now().toString(36);

  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Local wall-clock digits in UTC slots, as the app stores them.
  const at = (offset, hh, mm = "00") => `${day(offset)}T${hh}:${mm}:00Z`;

  const org = must(
    "org",
    await admin
      .from("organizations")
      .insert({ name: `ZZ Design ${stamp}`, slug: `zz-design-${stamp}`, status: "active" })
      .select("id")
      .single()
  );
  const state = { stamp, orgId: org.id, users: [] };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  try {
    const email = `zz-design-owner-${stamp}@example.invalid`;
    const password = `Zk!${stamp}aA9`;
    const u = must("createUser", await admin.auth.admin.createUser({ email, password, email_confirm: true }));
    state.users.push(u.user.id);
    state.email = email;
    state.password = password;
    must(
      "membership",
      await admin.from("org_memberships").insert({ org_id: org.id, user_id: u.user.id, role: "owner", email }).select("id").single()
    );

    const facility = must(
      "facility",
      await admin
        .from("facilities")
        .insert({
          org_id: org.id,
          name: `ZZ Design Centre ${stamp}`,
          slug: `zz-design-centre-${stamp}`,
          address_line1: "1 Test St",
          city: "Victoria",
          province: "BC",
          postal_code: "V0V 0V0",
          is_published: true,
        })
        .select("id, slug")
        .single()
    );
    state.facilityId = facility.id;
    state.facilitySlug = facility.slug;

    const mkDept = async (name, order) =>
      must(
        `department ${name}`,
        await admin
          .from("departments")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            name,
            slug: `zz-${name.toLowerCase()}-${stamp}`,
            display_order: order,
            is_published: true,
          })
          .select("id")
          .single()
      );
    const aquatics = await mkDept("Aquatics", 0);
    const gym = await mkDept("Gymnasium", 1);
    state.departmentId = aquatics.id;

    const mkSpace = async (name, deptId, order) =>
      must(
        `space ${name}`,
        await admin
          .from("spaces")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            department_id: deptId,
            name,
            slug: `zz-${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
            display_order: order,
            is_published: true,
          })
          .select("id")
          .single()
      );
    const lanes = [];
    for (let i = 1; i <= 6; i++) lanes.push(await mkSpace(`Lane ${i}`, aquatics.id, i));
    const courtA = await mkSpace("Court A", gym.id, 7);
    const courtB = await mkSpace("Court B", gym.id, 8);
    state.spaceId = lanes[0].id;

    const mkGroup = async (deptId, name, status, sport) =>
      must(
        `group ${name}`,
        await admin
          .from("schedule_groups")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            department_id: deptId,
            name,
            slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
            sport_category: sport,
            activity_type: "drop_in",
            status,
            source: "manual",
            starts_on: day(-30),
            ends_on: day(90),
            published_at: status === "published" ? new Date().toISOString() : null,
          })
          .select("id")
          .single()
      );
    const lap = await mkGroup(aquatics.id, "Lap Swim", "published", "swimming");
    const pub = await mkGroup(aquatics.id, "Public Swim", "published", "swimming");
    const aquafit = await mkGroup(aquatics.id, "Aquafit", "draft", "swimming");
    const openGym = await mkGroup(gym.id, "Open Gym", "published", "basketball");
    state.scheduleGroupId = lap.id;

    const templateIds = {};
    const templates = [
      ["Lap Swim", "#3B82F6", 60],
      ["Public Swim", "#10B981", 90],
      ["Aquafit", "#F59E0B", 45],
      ["Open Gym", "#EF4444", 120],
    ];
    for (const [i, [name, color, minutes]] of templates.entries()) {
      const t = must(
        `template ${name}`,
        await admin
          .from("session_templates")
          .insert({
            org_id: org.id,
            facility_id: facility.id,
            department_id: i < 3 ? aquatics.id : gym.id,
            name,
            color,
            default_duration_minutes: minutes,
            display_order: i,
          })
          .select("id")
          .single()
      );
      templateIds[name] = t.id;
      if (i === 0) state.templateId = t.id;
    }

    const DAILY = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU";
    // A session has no name of its own: it takes its template's, or its
    // schedule's when it has no template ("Family Swim" below).
    const mkSession = async (groupId, title, start, end, spaces) => {
      const [sh, sm] = start.split(":");
      const s = must(
        `session ${title}`,
        await admin
          .from("sessions")
          .insert({
            org_id: org.id,
            schedule_group_id: groupId,
            template_id: templateIds[title] ?? null,
            rrule: DAILY,
            dtstart: at(-7, sh, sm),
            dtend_time: `${end}:00`,
            valid_from: day(-7),
            valid_until: null,
            source: "manual",
            is_active: true,
          })
          .select("id")
          .single()
      );
      if (spaces.length) {
        must(
          `session_spaces ${title}`,
          await admin.from("session_spaces").insert(spaces.map((sp) => ({ session_id: s.id, space_id: sp.id, org_id: org.id })))
        );
      }
      return s;
    };
    const first = await mkSession(lap.id, "Lap Swim", "06:00", "08:30", lanes.slice(0, 4));
    await mkSession(pub.id, "Public Swim", "09:00", "11:00", lanes);
    await mkSession(lap.id, "Lap Swim", "12:00", "13:30", lanes.slice(0, 3));
    await mkSession(pub.id, "Family Swim", "12:00", "13:30", lanes.slice(2, 6)); // Lane 3 is double-booked
    await mkSession(aquafit.id, "Aquafit", "14:00", "14:45", lanes.slice(4, 6));
    await mkSession(pub.id, "Public Swim", "18:30", "20:30", lanes);
    await mkSession(openGym.id, "Open Gym", "10:00", "12:00", [courtA, courtB]);
    await mkSession(openGym.id, "Open Gym", "17:00", "21:00", [courtA]);
    state.sessionId = first.id;

    // Optional: the table may not match on an older database. A missing notice
    // costs one banner in the pictures, not the run.
    const notice = await admin.from("facility_notices").insert({
      org_id: org.id,
      facility_id: facility.id,
      headline: "Hot tub closed for maintenance",
      body: "Reopens Thursday morning.",
      category: "maintenance",
      severity: "caution",
      is_published: true,
      starts_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    if (notice.error) console.log(`  (notice skipped: ${notice.error.message})`);

    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(`  fixture built: org ${org.id}, facility ${facility.id}`);
    console.log(`  sign in as ${email} / ${password}`);
  } catch (e) {
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(`  setup failed (${e.message}); tearing down what was made`);
    await teardown();
    throw e;
  }
}

async function teardown() {
  if (!fs.existsSync(STATE)) {
    console.log("  no fixture to remove");
    return;
  }
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const { admin } = await clients();
  await admin.from("organizations").delete().eq("id", state.orgId);
  for (const id of state.users ?? []) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: left } = await admin.from("organizations").select("id").eq("id", state.orgId);
  fs.rmSync(STATE);
  console.log(`  teardown: ${left?.length ?? 0} fixture orgs left behind`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
function routes(s) {
  const f = s.facilityId;
  const q = `?facility=${f}`;
  return [
    // name, path, signed in?
    ["home", `/dashboard${q}`, true],
    ["analytics", `/dashboard/analytics${q}`, true],
    ["analytics-attendance", `/dashboard/analytics/attendance${q}`, true],
    ["analytics-utilization", `/dashboard/analytics/utilization${q}`, true],
    ["schedule", `/dashboard/schedule${q}`, true],
    ["schedule-session-new", `/dashboard/schedule/sessions/new${q}`, true],
    ["schedule-session-edit", `/dashboard/schedule/sessions/${s.sessionId}/edit`, true],
    ["sessions", `/dashboard/sessions${q}`, true],
    ["sessions-new", `/dashboard/sessions/new${q}`, true],
    ["sessions-edit", `/dashboard/sessions/${s.templateId}/edit`, true],
    ["facilities", `/dashboard/facilities`, true],
    ["facilities-new", `/dashboard/facilities/new`, true],
    ["facility-edit", `/dashboard/facilities/${f}/edit`, true],
    ["facility-status", `/dashboard/facilities/${f}/status`, true],
    ["departments", `/dashboard/departments${q}`, true],
    ["departments-new", `/dashboard/departments/new${q}`, true],
    ["department-edit", `/dashboard/facilities/${f}/departments/${s.departmentId}/edit`, true],
    ["schedule-group-edit", `/dashboard/facilities/${f}/schedule-groups/${s.scheduleGroupId}/edit`, true],
    ["schedule-group-new", `/dashboard/facilities/${f}/schedule-groups/new`, true],
    ["spaces", `/dashboard/spaces${q}`, true],
    ["space-new", `/dashboard/facilities/${f}/spaces/new`, true],
    ["space-edit", `/dashboard/facilities/${f}/spaces/${s.spaceId}/edit`, true],
    ["map", `/dashboard/map${q}`, true],
    ["widget", `/dashboard/widget`, true],
    ["conflicts", `/dashboard/conflicts${q}`, true],
    ["counts", `/dashboard/counts${q}`, true],
    ["activity", `/dashboard/activity`, true],
    ["import", `/dashboard/import`, true],
    ["settings", `/dashboard/settings`, true],
    ["settings-account", `/dashboard/settings/account`, true],
    ["settings-billing", `/dashboard/settings/billing`, true],
    ["settings-contact", `/dashboard/settings/contact`, true],
    ["settings-danger", `/dashboard/settings/danger`, true],
    ["settings-data-sources", `/dashboard/settings/data-sources`, true],
    ["settings-permissions", `/dashboard/settings/permissions`, true],
    ["settings-public", `/dashboard/settings/public`, true],
    ["settings-staff", `/dashboard/settings/staff`, true],
    ["deck", `/dashboard/schedule/deck${q}`, true],
    ["login", `/login`, false],
    ["signup", `/signup`, false],
    // The public surfaces wear the centre's brand (.org-theme) and must not
    // pick up Dropin's palette. Shot so a leak shows up as a changed picture.
    ["public-facility", `/facility/${s.facilitySlug}`, false],
    ["public-widget", `/widget/${s.orgId}`, false],
    ["public-find", `/find`, false],
  ];
}

async function signIn(state) {
  const { anon, url } = await clients();
  const { stringToBase64URL } = await import("@supabase/ssr/dist/main/utils/base64url.js");
  const { data, error } = await anon.auth.signInWithPassword({ email: state.email, password: state.password });
  if (error) throw new Error(`sign in: ${error.message}`);
  const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + stringToBase64URL(JSON.stringify(data.session));
  const MAX = 3180;
  const parts = [];
  if (value.length <= MAX) parts.push({ name, value });
  else for (let i = 0, n = 0; i < value.length; i += MAX, n++) parts.push({ name: `${name}.${n}`, value: value.slice(i, i + MAX) });
  const host = new URL(APP).hostname;
  return parts.map((c) => ({ ...c, domain: host, path: "/" }));
}

async function shoot(page, file, { fullPage = true } = {}) {
  // Let fonts and late client fetches land; networkidle alone returns before
  // React Query's second wave on several dashboard pages.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, fullPage, animations: "disabled" });
}

async function shots() {
  if (!fs.existsSync(STATE)) throw new Error("no fixture; run --setup first");
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const { chromium } = await import("playwright");
  const dir = path.join(OUT, LABEL);
  fs.mkdirSync(dir, { recursive: true });

  const list = routes(state).filter(([name]) => !ONLY || ONLY.some((o) => name.includes(o)));
  const cookies = await signIn(state);
  const browser = await chromium.launch({ headless: !flag("headed") });
  const report = [];
  try {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width, height: width < 600 ? 844 : 900 },
          colorScheme: theme === "dark" ? "dark" : "light",
          reducedMotion: "reduce",
          isMobile: width < 600,
          hasTouch: width < 600,
        });
        await context.addInitScript((t) => {
          try {
            localStorage.setItem("dropin-theme", t);
          } catch {}
        }, theme);
        const authed = await browser.newContext(); // placeholder so cookies never leak to the signed-out pages
        await authed.close();

        for (const [name, route, needsAuth] of list) {
          await context.clearCookies();
          if (needsAuth) await context.addCookies(cookies);
          const page = await context.newPage();
          const errors = [];
          page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text().slice(0, 200));
          });
          page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
          const tag = `${name} ${width}px ${theme}`;
          try {
            const res = await page.goto(APP + route, { waitUntil: "networkidle", timeout: 90000 });
            const status = res?.status() ?? 0;
            if (status >= 400) bad(`${tag}: HTTP ${status}`);
            // The dashboard's theme is applied by the top bar from localStorage;
            // the signed-out pages have no top bar, so set the class here too.
            // Public org-themed pages take their theme from their own config.
            if (!name.startsWith("public-")) {
              await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
            }
            await shoot(page, path.join(dir, `${name}.${width}.${theme}.png`));
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth
            );
            if (overflow > 1 && name !== "deck") bad(`${tag}: page is ${overflow}px wider than the viewport`);
            if (errors.length) bad(`${tag}: console errors: ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
            report.push({ name, width, theme, status, overflow, errors: errors.length });
            console.log(`  shot  ${tag}  (${status})`);
          } catch (e) {
            bad(`${tag}: ${e.message.split("\n")[0]}`);
          } finally {
            await page.close();
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n  ${report.length} pictures in ${dir}`);
}

// The landing page and the other marketing surfaces, light only (they have no
// dark mode). Reduced motion stops the hero's rotation so two runs can match.
async function landing() {
  const { chromium } = await import("playwright");
  const dir = path.join(OUT, `landing-${LABEL}`);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ headless: !flag("headed") });
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 900 },
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      for (const [name, route] of [
        ["landing", "/"],
        ["privacy", "/privacy"],
        ["terms", "/terms"],
      ]) {
        const page = await context.newPage();
        const res = await page.goto(APP + route, { waitUntil: "networkidle", timeout: 90000 });
        if ((res?.status() ?? 0) >= 400) bad(`${name} ${width}px: HTTP ${res?.status()}`);
        // Walk the page once so anything revealed on scroll has rendered.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
        });
        await shoot(page, path.join(dir, `${name}.${width}.png`));
        console.log(`  shot  ${name} ${width}px`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// Pixel comparison of two directories of pictures with the same file names.
// Done in a browser canvas so the harness needs no image library.
async function compare(spec) {
  const [a, b] = spec.split(",").map((d) => path.join(OUT, d));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let differing = 0;
  try {
    for (const file of fs.readdirSync(a).filter((f) => f.endsWith(".png")).sort()) {
      if (!fs.existsSync(path.join(b, file))) {
        bad(`${file}: missing from ${b}`);
        continue;
      }
      const [A, B] = [a, b].map((d) => "data:image/png;base64," + fs.readFileSync(path.join(d, file)).toString("base64"));
      const result = await page.evaluate(
        async ([A, B]) => {
          const load = (src) =>
            new Promise((res, rej) => {
              const i = new Image();
              i.onload = () => res(i);
              i.onerror = rej;
              i.src = src;
            });
          const [ia, ib] = await Promise.all([load(A), load(B)]);
          if (ia.width !== ib.width || ia.height !== ib.height)
            return { sized: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
          const px = (img) => {
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext("2d");
            g.drawImage(img, 0, 0);
            return g.getImageData(0, 0, img.width, img.height).data;
          };
          const [da, db] = [px(ia), px(ib)];
          let n = 0,
            minY = Infinity,
            maxY = -1,
            maxDelta = 0;
          for (let i = 0; i < da.length; i += 4) {
            const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
            if (d > 0) {
              n++;
              if (d > maxDelta) maxDelta = d;
              const y = Math.floor(i / 4 / ia.width);
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
          // A picture of where: the second image faded, differing pixels in red.
          const c = document.createElement("canvas");
          c.width = ib.width;
          c.height = ib.height;
          const g = c.getContext("2d");
          g.drawImage(ib, 0, 0);
          const out = g.getImageData(0, 0, ib.width, ib.height);
          for (let i = 0; i < da.length; i += 4) {
            const differs = da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2];
            if (differs) {
              out.data[i] = 255;
              out.data[i + 1] = 0;
              out.data[i + 2] = 0;
            } else {
              for (let k = 0; k < 3; k++) out.data[i + k] = 255 - (255 - out.data[i + k]) * 0.25;
            }
          }
          g.putImageData(out, 0, 0);
          return { n, total: da.length / 4, minY, maxY, maxDelta, diff: n > 0 ? c.toDataURL("image/png") : null };
        },
        [A, B]
      );
      if (result.sized) {
        differing++;
        bad(`${file}: size changed, ${result.sized}`);
      } else if (result.n > 0) {
        differing++;
        fs.mkdirSync(path.join(b, "diff"), { recursive: true });
        fs.writeFileSync(path.join(b, "diff", file), Buffer.from(result.diff.split(",")[1], "base64"));
        bad(
          `${file}: ${result.n} of ${result.total} pixels differ (largest channel difference ${result.maxDelta}/255, rows ${result.minY}-${result.maxY})`
        );
      } else {
        console.log(`  SAME  ${file}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n  ${differing} differing pictures`);
}

const run = async () => {
  if (flag("setup")) await setup();
  if (flag("landing")) await landing();
  if (flag("shots")) await shots();
  if (arg("compare")) await compare(arg("compare"));
  if (flag("teardown")) await teardown();
};

run()
  .catch((e) => {
    fail++;
    console.error(`  ERROR ${e.message}`);
  })
  .finally(() => {
    console.log(`  ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  });
