/**
 * The security sweep — the re-runnable half of docs/prompts/frontend-database-security.md.
 *
 *   node scripts/security/sweep.mjs                  # static only: no server, no database
 *   node scripts/security/sweep.mjs --live           # + anonymous probes against PostgREST
 *   node scripts/security/sweep.mjs --live --app=http://localhost:3001   # + response headers
 *   node scripts/security/sweep.mjs --falsify        # self-test: every static check must go red
 *   node scripts/security/sweep.mjs --json           # machine-readable
 *
 * ## What this is
 *
 * One check per line, each tagged with the weakness class (W1..W16) from the
 * prompt. It is the *loop*: the prompt is the method, this is what makes a pass
 * cheap enough to repeat on every boundary move.
 *
 * ## What it is not
 *
 * Not a scanner, and not a proof of security. Three quarters of the prompt
 * cannot be automated — a cross-org fetch needs two real orgs, a cache test
 * needs a production build, a role matrix needs four signed-in users. Those
 * print as MANUAL with the section that describes them, so the un-automated
 * surface stays visible instead of being quietly dropped from the count.
 *
 * ## Reviewed exceptions
 *
 * Several checks carry a `reviewed` map: a call site that looks like the bug
 * but is not, with the reason written next to it. That is deliberate. The
 * alternative — loosening the pattern until the site stops matching — also
 * stops the *next* site matching, and the next one may be the real thing.
 * A reviewed entry is a claim someone checked on a date; re-check it when the
 * file changes. An unreviewed hit is red.
 *
 * ## The rules it follows (§2 of the prompt)
 *
 * - **Positive control.** Every live probe expecting "anon sees nothing" first
 *   proves with the service role that there is something to see. When there is
 *   not, it reports INCONCLUSIVE rather than green: an empty table and a
 *   working policy return the same bytes.
 * - **The service role never tests the thing under test.** Here it only counts
 *   rows to establish controls.
 * - **Every check can go red.** `--falsify` re-runs each static check against a
 *   deliberately poisoned copy of the evidence and reports BLIND if the check
 *   still passes. A check that has never been red has proven nothing.
 *
 * Exit code is 1 if anything FAILed, so a scheduled run can gate on it.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ARGS = process.argv.slice(2);
const LIVE = ARGS.includes("--live");
const JSON_OUT = ARGS.includes("--json");
const FALSIFY = ARGS.includes("--falsify");
const APP = ARGS.find((a) => a.startsWith("--app="))?.slice(6) ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// Allowlists. Every entry is a decision, and the comment is the reason.
// A new file appearing in one of these positions is meant to fail until someone
// writes the reason down — that is the point of listing them here rather than
// pattern-matching a directory.
// ─────────────────────────────────────────────────────────────────────────────

/** Files permitted to hold the service-role key. See prompt W8. */
const SERVICE_ROLE_CALLERS = [
  "src/app/api/analytics/track/route.ts", // public write path; RLS denies anon INSERT by design
  "src/app/api/auth/onboard-org/route.ts", // creates the org + the caller's membership
  "src/app/api/stripe/webhook/route.ts", // entitlements; no user session exists
  "src/lib/rate-limit.ts", // writes buckets for callers who have no session
];

/** Relations deliberately readable by `anon`. See prompt W3. */
const PUBLIC_RELATIONS = ["organizations_public"];

/**
 * The columns `organizations_public` may expose. This is a definer view: its
 * column list *is* the access control, so a column added to it becomes
 * world-readable with no policy change and no error.
 *
 * `is_verified` is `approved_at IS NOT NULL` (migration 057) — whether an org
 * is verified is public by design, because the directory is built on it. The
 * timestamp and the approver are deliberately not here.
 */
const ORGS_PUBLIC_COLUMNS = [
  "id",
  "name",
  "slug",
  "description",
  "logo_url",
  "website_url",
  "city",
  "province",
  "country",
  "is_verified",
];

/** `NEXT_PUBLIC_` variables that are meant to be in the browser bundle. */
const PUBLIC_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
];

/**
 * Route handlers that legitimately establish no user identity. Each still has
 * to be rate limited — an unauthenticated route with no throttle is someone
 * else's bill, and the proxy matcher excludes `/api`, so nothing here is
 * protected by default.
 */
const UNAUTHENTICATED_ROUTES = {
  "src/app/api/stripe/webhook/route.ts": "the Stripe signature is the credential",
  "src/app/api/facility-maps/public/route.ts": "published floorplan read",
  "src/app/api/public/v1/directory/route.ts": "public directory API",
  "src/app/api/analytics/track/route.ts": "anonymous page views",
  "src/app/api/facility-maps/public/route.ts": "public floorplan read",
  "src/app/api/auth/signup/route.ts": "creates the account",
  "src/app/api/invitations/[token]/route.ts": "the token is the credential",
  "src/app/api/invitations/[token]/accept/route.ts": "the token is the credential",
};

/** Ways a route can establish who is calling. All of them end at a verified token. */
const AUTH_MARKERS = /getUser\(|getClaims\(|getAuthedMembership\(|getRouteMembership\(|getOrgContext\(/;

/**
 * Unauthenticated routes that deliberately have no rate limit. Only one, and
 * the reason is specific to it: throttling a webhook drops events, and Stripe
 * then retries them for three days. The signature check runs before any
 * database work, so an unsigned flood buys a signature computation.
 */
const THROTTLE_EXEMPT = {
  "src/app/api/stripe/webhook/route.ts": "throttling it would drop signed events Stripe then retries",
};

/**
 * Tables anon must never read a row from. Probed live; the control comes from
 * the service role counting what is actually there.
 *
 * A table that happens to be empty makes its probe meaningless — `[]` from a
 * working policy and `[]` from an empty table are the same bytes — so it
 * reports INCONCLUSIVE rather than green. The second element names the harness
 * that builds a fixture and proves it properly, so an inconclusive line is a
 * pointer rather than a shrug. This sweep does not insert rows into the live
 * database to manufacture its own controls; that is what those harnesses are.
 */
const PRIVATE_TABLES = [
  ["organizations", null],
  ["org_memberships", "verify-al"],
  ["membership_scopes", "verify-al"],
  ["staff_invitations", "verify-al (anon read of a pending token)"],
  ["invitation_scopes", "verify-al"],
  ["subscriptions", null],
  ["stripe_events", null],
  ["analytics_events", "verify-l"],
  ["activity_log", "verify-j"],
  ["rate_limits", "verify-af"],
  ["session_internal", "verify-v (the staff-only sidecar)"],
  ["session_conflict_dismissals", "verify-k"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Evidence. Collected once; every static check is a pure function of it, which
// is what makes --falsify possible.
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(p, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

/**
 * Comments removed, so a check is neither satisfied nor tripped by prose.
 * `src/proxy.ts` contains the sentence "must not use getSession() here", and
 * migration 022's header explains what `user_metadata` is — a naive grep reads
 * both as code.
 */
const stripTsComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSqlComments = (sql) => sql.replace(/^\s*--.*$/gm, "");

function collect() {
  const srcFiles = walk(path.join(ROOT, "src"), [".ts", ".tsx"]).map((p) => {
    const raw = fs.readFileSync(p, "utf8");
    return { path: rel(p), raw, code: stripTsComments(raw) };
  });
  const migrations = walk(path.join(ROOT, "supabase", "migrations"), [".sql"])
    .sort()
    .map((p) => {
      const raw = fs.readFileSync(p, "utf8");
      return { path: rel(p), raw, sql: stripSqlComments(raw) };
    });

  return {
    srcFiles,
    routes: srcFiles.filter((f) => /^src\/app\/api\/.*\/route\.ts$/.test(f.path)),
    migrations,
    allSql: migrations.map((m) => m.sql).join("\n"),
    nextConfig: fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8"),
    gitignore: fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"),
  };
}

/** Deep-enough clone for poisoning: every check reads only strings and arrays. */
const cloneFacts = (f) => ({
  ...f,
  srcFiles: f.srcFiles.map((x) => ({ ...x })),
  migrations: f.migrations.map((x) => ({ ...x })),
  routes: undefined, // rebuilt below so routes and srcFiles stay the same objects
});

function facts(f) {
  const c = cloneFacts(f);
  c.routes = c.srcFiles.filter((x) => /^src\/app\/api\/.*\/route\.ts$/.test(x.path));
  return c;
}

const file = (f, p) => f.srcFiles.find((x) => x.path === p);

const ok = (detail) => ({ ok: true, detail });
const bad = (detail, hits = []) => ({ ok: false, detail, hits });

/**
 * Split hits into the ones someone has already looked at and the ones nobody
 * has. `reviewed` is `{ key: reason }`; a hit whose key is absent is red.
 */
function triage(hits, reviewed, noun) {
  const unknown = hits.filter((h) => !(h.key in reviewed));
  if (unknown.length) {
    return bad(
      `${unknown.length} unreviewed ${noun} (${Object.keys(reviewed).length} previously reviewed)`,
      unknown.map((h) => h.label)
    );
  }
  return ok(`${hits.length} ${noun}, each reviewed: ${Object.keys(reviewed).length} on file`);
}

/** Policy statements, with the ones later dropped by name removed. */
function livePolicies(f) {
  const policies = [];
  for (const m of f.migrations) {
    for (const match of m.sql.matchAll(/CREATE\s+POLICY\s+"?([^"\n]+?)"?\s+ON\s+([a-z_.]+)([\s\S]*?);/gi)) {
      const name = match[1].trim();
      const table = match[2].replace(/^public\./, "");
      policies.push({ name, table, body: match[3], migration: m.path, key: `${table}::${name}` });
    }
  }
  const byKey = new Map();
  for (const p of policies) byKey.set(p.key, p); // a re-creation supersedes the earlier shape
  return [...byKey.values()].filter((p) => {
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lastDrop = f.migrations
      .filter((m) => new RegExp(`DROP\\s+POLICY[^;]*"?${escaped}"?\\s+ON`, "i").test(m.sql))
      .at(-1);
    return lastDrop ? p.migration > lastDrop.path : true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Static checks
// ─────────────────────────────────────────────────────────────────────────────

const STATIC = [
  {
    id: "W1.1",
    claim: "No authorization reads getSession() (it verifies nothing)",
    run: (f) => {
      const hits = f.srcFiles.filter((s) => /\bgetSession\s*\(/.test(s.code)).map((s) => s.path);
      return hits.length ? bad(`${hits.length} call site(s)`, hits) : ok("0 call sites");
    },
    poison: (f) => {
      file(f, "src/proxy.ts").code += "\nconst { data } = await supabase.auth.getSession();";
      return f;
    },
  },
  {
    id: "W1.2",
    claim: "Nothing reads user_metadata outside a reviewed, non-authorizing use",
    reviewed: {
      // Prefills the org-name field on the onboarding form. The value is
      // displayed and re-submitted, never compared against a permission — and
      // the file says so. Anything new here is a privilege decision made from
      // a field the user writes themselves.
      "src/app/(auth)/dashboard/org/onboarding/page.tsx": "prefills a text input; explicitly untrusted",
    },
    run: (f, reviewed) => {
      // In SQL, only the surviving definition counts. Migration 002's
      // is_superadmin() read raw_user_meta_data — finding C1 — and 022 replaced
      // it. A check that reads every migration file for ever reports a hole
      // that was closed, and a checker that cries wolf gets muted.
      const hits = f.srcFiles
        .filter((s) => /user_metadata/.test(s.code))
        .map((s) => ({ key: s.path, label: s.path }));

      const lastDefinition = new Map();
      for (const m of f.migrations) {
        for (const x of m.sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?(?:public\.)?([a-z_]+)[\s\S]*?\$\$[\s\S]*?\$\$/gi
        )) {
          lastDefinition.set(x[1], { body: x[0], migration: m.path });
        }
      }
      for (const [name, def] of lastDefinition) {
        if (/raw_user_meta_data/i.test(def.body))
          hits.push({ key: `${def.migration}::${name}`, label: `${name}() in ${def.migration}` });
      }

      // Anything outside a function body — a policy, a view, a trigger — has no
      // supersession story, so it counts wherever it appears.
      for (const m of f.migrations) {
        // `COMMENT ON … IS '…'` is documentation that happens to live in SQL —
        // 022's says "NEVER change this to raw_user_meta_data", which is the
        // opposite of the bug.
        const outsideFunctions = m.sql
          .replace(/\$\$[\s\S]*?\$\$/g, "")
          .replace(/COMMENT\s+ON[\s\S]*?;/gi, "");
        if (/raw_user_meta_data/i.test(outsideFunctions))
          hits.push({ key: `${m.path}::inline`, label: `${m.path} (outside a function body)` });
      }

      return triage(hits, reviewed, "reference(s)");
    },
    poison: (f) => {
      file(f, "src/proxy.ts").code += "\nconst role = user.user_metadata?.role;";
      return f;
    },
  },
  {
    id: "W2.1",
    claim: "Every table created by a migration has RLS enabled",
    run: (f) => {
      const created = new Set();
      const dropped = new Set();
      for (const m of f.migrations) {
        for (const x of m.sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(?:public\.)?([a-z_]+)"?/gi))
          created.add(x[1]);
        for (const x of m.sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(?:public\.)?([a-z_]+)"?/gi))
          dropped.add(x[1]);
      }
      const enabled = new Set(
        [...f.allSql.matchAll(/ALTER\s+TABLE\s+"?(?:public\.)?([a-z_]+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)].map(
          (x) => x[1]
        )
      );
      const missing = [...created].filter((t) => !dropped.has(t) && !enabled.has(t));
      return missing.length
        ? bad(`${missing.length} table(s) with no ENABLE ROW LEVEL SECURITY`, missing)
        : ok(`${created.size - dropped.size} live tables, all enabled`);
    },
    poison: (f) => {
      f.migrations.push({ path: "supabase/migrations/999_poison.sql", raw: "", sql: "CREATE TABLE secrets (id uuid);" });
      f.allSql += "\nCREATE TABLE secrets (id uuid);";
      return f;
    },
  },
  {
    id: "W2.2",
    claim: "No live policy is USING (true)",
    run: (f) => {
      const hits = livePolicies(f)
        .filter((p) => /USING\s*\(\s*true\s*\)/i.test(p.body))
        .map((p) => `${p.table}::${p.name} (${p.migration})`);
      return hits.length ? bad(`${hits.length} permissive policy(ies)`, hits) : ok("none");
    },
    poison: (f) => {
      f.migrations.push({
        path: "supabase/migrations/999_poison.sql",
        raw: "",
        sql: 'CREATE POLICY "poison_read" ON sessions FOR SELECT USING (true);',
      });
      return f;
    },
  },
  {
    id: "W2.3",
    claim: "Every UPDATE policy without a WITH CHECK has been reviewed",
    // Postgres uses the USING expression as the WITH CHECK when the latter is
    // omitted, so a missing WITH CHECK is not automatically a tenancy-move
    // hole — it is a hole only when USING does not constrain the columns being
    // written. That distinction is not decidable from the text, so each one is
    // read once and recorded here.
    reviewed: {
      "organizations::orgs_admin_update":
        "USING pins id to the caller's orgs, so the post-image is checked against the same predicate; " +
        "status/approved_at/approved_by are additionally trigger-locked (057)",
    },
    run: (f, reviewed) => {
      const hits = livePolicies(f)
        .filter((p) => /FOR\s+UPDATE/i.test(p.body) && !/WITH\s+CHECK/i.test(p.body))
        .map((p) => ({ key: p.key, label: `${p.key} (${p.migration})` }));
      return triage(hits, reviewed, "UPDATE policy(ies) with no WITH CHECK");
    },
    poison: (f) => {
      f.migrations.push({
        path: "supabase/migrations/999_poison.sql",
        raw: "",
        sql: 'CREATE POLICY "poison_update" ON sessions FOR UPDATE USING (org_id = ANY(user_org_ids()));',
      });
      return f;
    },
  },
  {
    id: "W2.4",
    claim: "Every SECURITY DEFINER function pins its search_path",
    run: (f) => {
      const hits = [];
      for (const m of f.migrations) {
        for (const x of m.sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?(?:public\.)?([a-z_]+)[\s\S]*?(?=CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|\$\$\s*;|$)/gi
        )) {
          if (/SECURITY\s+DEFINER/i.test(x[0]) && !/SET\s+search_path/i.test(x[0])) hits.push(`${x[1]} (${m.path})`);
        }
      }
      return hits.length ? bad(`${hits.length} definer function(s) with no search_path`, hits) : ok("all pinned");
    },
    poison: (f) => {
      f.migrations.push({
        path: "supabase/migrations/999_poison.sql",
        raw: "",
        sql: "CREATE FUNCTION public.poison() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;",
      });
      return f;
    },
  },
  {
    id: "W3.1",
    claim: "Only allowlisted relations are granted to anon",
    run: (f) => {
      const hits = [];
      for (const x of f.allSql.matchAll(
        /GRANT\s+([A-Z, ]+)\s+ON\s+(?:TABLE\s+)?"?(?:public\.)?([a-z_]+)"?\s+TO\s+([^;]+);/gi
      )) {
        const [, priv, relation, grantees] = x;
        if (!/anon/i.test(grantees)) continue;
        if (!PUBLIC_RELATIONS.includes(relation)) hits.push(`${priv.trim()} ON ${relation}`);
      }
      return hits.length ? bad(`${hits.length} unlisted grant(s) to anon`, hits) : ok(PUBLIC_RELATIONS.join(", "));
    },
    poison: (f) => {
      f.allSql += "\nGRANT SELECT ON public.subscriptions TO anon, authenticated;";
      return f;
    },
  },
  {
    id: "W3.2",
    claim: "organizations_public exposes only its justified columns",
    run: (f) => {
      const defs = [...f.allSql.matchAll(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.organizations_public\s+AS([\s\S]*?);/gi)];
      if (!defs.length) return bad("view definition not found — has it been renamed?");
      const body = defs.at(-1)[1];
      const cols = body
        .slice(0, body.search(/\bFROM\b/i))
        .replace(/^\s*SELECT/i, "")
        .split(",")
        .map((c) => c.trim().split(/\s+/).pop().replace(/"/g, ""))
        .filter(Boolean);
      const extra = cols.filter((c) => !ORGS_PUBLIC_COLUMNS.includes(c));
      return extra.length ? bad(`${extra.length} unjustified column(s)`, extra) : ok(`${cols.length} columns`);
    },
    poison: (f) => {
      f.allSql +=
        "\nCREATE OR REPLACE VIEW public.organizations_public AS SELECT id, name, email, stripe_customer_id FROM organizations WHERE status = 'active';";
      return f;
    },
  },
  {
    id: "W5.1",
    claim: "Every route that reads a body validates it with a schema",
    reviewed: {
      // Multipart upload, not JSON: the file is size-capped before parsing
      // (MAX_FILE_SIZE), the row count before mapping (MAX_ROWS), and each row
      // by validateRow(). A zod schema over a CSV buffer would add nothing.
      "src/app/api/import/route.ts": "formData + validateRow()/MAX_ROWS, not a JSON body",
    },
    run: (f, reviewed) => {
      const hits = f.routes
        .filter((r) => /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)/.test(r.code))
        .filter((r) => /request\.json\(\)|req\.json\(\)|formData\(\)/.test(r.code))
        .filter((r) => !/from\s+"zod"/.test(r.code) && !/\.(safeParse|parse)\(/.test(r.code))
        .map((r) => ({ key: r.path, label: r.path }));
      return triage(hits, reviewed, "route(s) parsing a body without zod");
    },
    poison: (f) => {
      f.routes[0].code = "export async function POST(request: Request) { const body = await request.json(); }";
      return f;
    },
  },
  {
    id: "W5.2",
    claim: "Nothing written to the database derives from an unvalidated body",
    run: (f) => {
      const hits = [];
      for (const r of f.routes) {
        for (const m of r.code.matchAll(/\.(update|insert|upsert)\(\s*([A-Za-z_$][\w$]*)\b/g)) {
          const [, verb, name] = m;
          if (/^(body|json|raw|input)$/.test(name)) {
            hits.push(`${r.path}: .${verb}(${name})`);
            continue;
          }
          // Resolve the local: a payload built by spreading parsed.data is the
          // validated object under another name; one that spreads the raw body
          // is the bug this check exists for.
          const decl = new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]{0,400}?)\\n\\s*\\};`).exec(r.code);
          if (decl && /\.\.\.\s*(body|json|raw|input)\b/.test(decl[1])) hits.push(`${r.path}: .${verb}(${name}) spreads the raw body`);
        }
      }
      return hits.length ? bad(`${hits.length} raw write(s)`, hits) : ok("all writes come from validated objects");
    },
    poison: (f) => {
      f.routes[0].code += '\nawait supabase.from("sessions").update(body).eq("id", id);';
      return f;
    },
  },
  {
    id: "W5.3",
    claim: "No privileged column is assigned from request input without review",
    reviewed: {
      // This route's whole purpose is changing someone's role. The enum
      // excludes "owner", invitableRolesFor() bounds it by the actor's own
      // role, canModifyMembership() blocks the owner row and self-edits, and
      // migration 055 §7 repeats all three as policies.
      "src/app/api/staff/members/[id]/route.ts::role": "the role-change endpoint; bounded by 055 §7 + canModifyMembership()",
    },
    run: (f, reviewed) => {
      const re =
        /\b(org_id|user_id|role|plan_tier|approved_at|approved_by|stripe_customer_id|stripe_subscription_id)\s*:\s*(body|parsed|json|payload|input)\b/g;
      const hits = [];
      for (const r of f.routes)
        for (const m of r.code.matchAll(re))
          hits.push({ key: `${r.path}::${m[1]}`, label: `${r.path}: ${m[1]} from ${m[2]}` });
      return triage(hits, reviewed, "assignment(s)");
    },
    poison: (f) => {
      f.routes[0].code += "\nconst row = { org_id: body.org_id, name };";
      return f;
    },
  },
  {
    id: "W7.1",
    claim: "No `use cache` module imports the cookie-backed Supabase client",
    run: (f) => {
      const hits = f.srcFiles
        .filter((s) => /["']use cache["']/.test(s.code))
        .filter((s) => /from\s+"@\/lib\/supabase\/server"/.test(s.code))
        .map((s) => s.path);
      return hits.length ? bad(`${hits.length} module(s)`, hits) : ok("none");
    },
    poison: (f) => {
      file(f, "src/lib/directory/listings.ts").code += '\nimport { createClient } from "@/lib/supabase/server";';
      return f;
    },
  },
  {
    id: "W7.2",
    claim: "No authenticated route sets a shared (public) Cache-Control",
    run: (f) => {
      const hits = f.routes
        .filter((r) => /Cache-Control[^\n]*public/i.test(r.code))
        .filter((r) => AUTH_MARKERS.test(r.code))
        .map((r) => r.path);
      return hits.length ? bad(`${hits.length} route(s)`, hits) : ok("none");
    },
    poison: (f) => {
      f.routes.find((x) => AUTH_MARKERS.test(x.code)).code += '\nheaders.set("Cache-Control", "public, s-maxage=60");';
      return f;
    },
  },
  {
    id: "W8.1",
    claim: "The service-role client is imported only by allowlisted files",
    run: (f) => {
      const hits = f.srcFiles
        .filter((s) => s.path !== "src/lib/supabase/admin.ts")
        .filter((s) => /createAdminClient/.test(s.code))
        .map((s) => s.path)
        .filter((p) => !SERVICE_ROLE_CALLERS.includes(p));
      return hits.length ? bad(`${hits.length} unlisted call site(s)`, hits) : ok(`${SERVICE_ROLE_CALLERS.length} listed`);
    },
    poison: (f) => {
      file(f, "src/lib/auth/roles.ts").code += '\nimport { createAdminClient } from "@/lib/supabase/admin";';
      return f;
    },
  },
  {
    id: "W8.2",
    claim: "No client component references the service-role key",
    run: (f) => {
      const hits = f.srcFiles
        .filter((s) => /["']use client["']/.test(s.raw))
        .filter((s) => /SERVICE_ROLE|createAdminClient/.test(s.code))
        .map((s) => s.path);
      return hits.length ? bad(`${hits.length} client component(s)`, hits) : ok("none");
    },
    poison: (f) => {
      f.srcFiles.find((s) => /["']use client["']/.test(s.raw)).code += "\nconst k = process.env.SUPABASE_SERVICE_ROLE_KEY;";
      return f;
    },
  },
  {
    id: "W9.1",
    claim: "subscriptions has no client-side write policy (entitlements are webhook-only)",
    run: (f) => {
      const hits = livePolicies(f)
        .filter((p) => p.table === "subscriptions" && /FOR\s+(INSERT|UPDATE|DELETE|ALL)/i.test(p.body))
        .map((p) => `${p.name} (${p.migration})`);
      return hits.length ? bad(`${hits.length} write policy(ies)`, hits) : ok("read-only to clients");
    },
    poison: (f) => {
      f.migrations.push({
        path: "supabase/migrations/999_poison.sql",
        raw: "",
        sql: 'CREATE POLICY "subs_write" ON subscriptions FOR UPDATE USING (org_id = ANY(user_org_ids())) WITH CHECK (true);',
      });
      return f;
    },
  },
  {
    id: "W9.2",
    claim: "An unknown Stripe price throws rather than defaulting to a tier",
    run: (f) => {
      const prices = file(f, "src/lib/stripe/prices.ts");
      if (!prices) return bad("src/lib/stripe/prices.ts not found");
      const mapper = prices.code.slice(prices.code.indexOf("getPlanTierFromPriceId"));
      return /\?\?\s*["']free["']|return\s+["']free["']/.test(mapper)
        ? bad("the price → tier mapping has a default branch")
        : ok("no default branch in getPlanTierFromPriceId");
    },
    poison: (f) => {
      file(f, "src/lib/stripe/prices.ts").code += '\nexport function getPlanTierFromPriceId(id: string) { return map[id] ?? "free"; }';
      return f;
    },
  },
  {
    id: "W9.3",
    claim: "No route accepts a raw Stripe price id from the caller",
    run: (f) => {
      const hits = f.routes.filter((r) => /price_?[iI]d\s*[:=]\s*(body|parsed|json|payload|input)\b/.test(r.code)).map((r) => r.path);
      return hits.length ? bad(`${hits.length} route(s)`, hits) : ok("tier enum only");
    },
    poison: (f) => {
      f.routes[0].code += "\nconst priceId = body.priceId;";
      return f;
    },
  },
  {
    id: "W10.1",
    claim: "Every unauthenticated route is declared and rate limited",
    run: (f) => {
      const unauth = f.routes.filter((r) => !AUTH_MARKERS.test(r.code));
      const hits = [
        ...unauth.map((r) => r.path).filter((p) => !(p in UNAUTHENTICATED_ROUTES)).map((p) => `${p} (not declared public)`),
        ...unauth
          .filter((r) => !/checkRateLimit/.test(r.code) && !(r.path in THROTTLE_EXEMPT))
          .map((r) => `${r.path} (no checkRateLimit)`),
      ];
      return hits.length ? bad(`${hits.length} issue(s)`, hits) : ok(`${unauth.length} public routes, all throttled`);
    },
    poison: (f) => {
      f.routes.push({ path: "src/app/api/poison/route.ts", raw: "", code: "export async function GET() { return Response.json({}); }" });
      return f;
    },
  },
  {
    id: "W10.2",
    claim: "No query asks PostgREST for more than its 1,000-row ceiling",
    run: (f) => {
      const hits = [];
      for (const s of f.srcFiles)
        for (const m of s.code.matchAll(/\.limit\(\s*([\d_]+)\s*\)/g))
          if (Number(m[1].replace(/_/g, "")) >= 1000) hits.push(`${s.path}: .limit(${m[1]})`);
      return hits.length ? bad(`${hits.length} truncating read(s)`, hits) : ok("none");
    },
    poison: (f) => {
      f.srcFiles[0].code += "\nawait q.limit(5000);";
      return f;
    },
  },
  {
    id: "W11.1",
    claim: "No PostgREST filter expression interpolates anything unreviewed",
    reviewed: {
      // Both interpolate a server-computed ISO date, never a caller's string.
      // A `.or()` argument is a filter *expression*, so a caller-controlled
      // value here is this stack's SQL injection.
      "src/app/api/sessions/expand/route.ts": "interpolates a server-computed range boundary (ISO date)",
      "src/lib/directory/listings.ts": "interpolates a server-computed cutoff date",
    },
    run: (f, reviewed) => {
      const hits = [];
      for (const s of f.srcFiles)
        for (const m of s.code.matchAll(/\.or\(\s*`([^`]*)`/g))
          if (/\$\{/.test(m[1])) hits.push({ key: s.path, label: `${s.path}: .or(\`${m[1].slice(0, 50)}…\`)` });
      return triage(hits, reviewed, "interpolated .or() filter(s)");
    },
    poison: (f) => {
      f.srcFiles[0].code += "\nawait q.or(`name.ilike.%${input}%`);";
      return f;
    },
  },
  {
    id: "W11.2",
    claim: "No raw HTML is injected into the DOM",
    run: (f) => {
      const hits = f.srcFiles.filter((s) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(s.code)).map((s) => s.path);
      return hits.length ? bad(`${hits.length} sink(s)`, hits) : ok("none");
    },
    poison: (f) => {
      f.srcFiles[0].code += "\nel.innerHTML = value;";
      return f;
    },
  },
  {
    id: "W11.3",
    claim: "CSV export neutralises spreadsheet formulas",
    run: (f) => {
      const csv = f.srcFiles.find((s) => s.path === "src/lib/analytics/csv.ts");
      if (!csv) return bad("src/lib/analytics/csv.ts not found — has the export moved?");
      const guard = /\/\^\[[^\]]*=[^\]]*\]/.test(csv.code); // a leading-character class containing '='
      const prefixes = /["']'["']\s*\+|\+\s*["']'["']/.test(csv.code); // and a quote prefixed onto the value
      return guard && prefixes ? ok("a leading =/+/-/@ is prefixed with an apostrophe") : bad("no formula guard found in csv.ts");
    },
    poison: (f) => {
      f.srcFiles.find((s) => s.path === "src/lib/analytics/csv.ts").code = "export function toCsv(rows) { return rows.join(','); }";
      return f;
    },
  },
  {
    id: "W12.1",
    claim: "No unexpected NEXT_PUBLIC_ variable exists (the prefix inlines it into the bundle)",
    run: (f) => {
      const found = new Set();
      for (const s of f.srcFiles) for (const m of s.code.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) found.add(m[0]);
      const extra = [...found].filter((v) => !PUBLIC_ENV.includes(v));
      return extra.length ? bad(`${extra.length} unlisted variable(s)`, extra) : ok(`${found.size} listed`);
    },
    poison: (f) => {
      f.srcFiles[0].code += "\nconst s = process.env.NEXT_PUBLIC_SERVICE_ROLE_KEY;";
      return f;
    },
  },
  {
    id: "W12.2",
    claim: "No secret has a fallback value (a plausible default is worse than a crash)",
    run: (f) => {
      const hits = [];
      const re = /process\.env\.([A-Z0-9_]*(?:SECRET|KEY|SALT|TOKEN|PASSWORD|SERVICE_ROLE|WEBHOOK)[A-Z0-9_]*)\s*(\?\?|\|\|)/g;
      for (const s of f.srcFiles)
        for (const m of s.code.matchAll(re))
          if (!m[1].startsWith("NEXT_PUBLIC_")) hits.push(`${s.path}: ${m[1]} ${m[2]}`);
      return hits.length ? bad(`${hits.length} fallback(s)`, hits) : ok("none");
    },
    poison: (f) => {
      f.srcFiles[0].code += '\nconst salt = process.env.ANALYTICS_IP_SALT ?? "dropin";';
      return f;
    },
  },
  {
    id: "W12.3",
    claim: ".env.local is ignored by git",
    run: (f) => (/\.env/.test(f.gitignore) ? ok("ignored") : bad(".env is not in .gitignore")),
    poison: (f) => {
      f.gitignore = "node_modules\n.next\n";
      return f;
    },
  },
  {
    id: "W13.1",
    claim: "No migration puts an SVG mime type on the org-media bucket",
    run: (f) => {
      const hits = f.migrations.filter((m) => /image\/svg/i.test(m.sql)).map((m) => m.path);
      return hits.length ? bad("an SVG mime type appears in a migration", hits) : ok("none");
    },
    poison: (f) => {
      f.migrations.push({
        path: "supabase/migrations/999_poison.sql",
        raw: "",
        sql: "update storage.buckets set allowed_mime_types = array['image/svg+xml'];",
      });
      return f;
    },
  },
  {
    id: "W14.1",
    claim: "No route returns a Postgres error message to the caller",
    reviewed: {
      // All three surface a message raised by a SECURITY DEFINER function that
      // was written for a person ("Transfer ownership before leaving this
      // organization"), with a generic fallback. Worth re-reading if those
      // functions ever raise something Postgres wrote instead.
      "src/app/api/staff/members/leave/route.ts": "human-written RAISE from leave_organization(), with a fallback",
      "src/app/api/staff/transfer-ownership/route.ts": "human-written RAISE from transfer_ownership(), with a fallback",
      "src/app/api/activity/[id]/revert/route.ts": "human-written RAISE from revert_activity(), with a fallback",
    },
    run: (f, reviewed) => {
      const hits = [];
      for (const r of f.routes)
        if (/error:\s*(?:error\.(message|details|hint)|`[^`]*\$\{error\.(message|details|hint)})/.test(r.code))
          hits.push({ key: r.path, label: r.path });
      return triage(hits, reviewed, "route(s) returning a database error");
    },
    poison: (f) => {
      f.routes[0].code += "\nreturn NextResponse.json({ error: error.message }, { status: 400 });";
      return f;
    },
  },
  {
    id: "W15.1",
    claim: "Exactly two blocks set a CSP header (browsers intersect duplicates)",
    run: (f) => {
      const n = (f.nextConfig.match(/key:\s*"Content-Security-Policy"/g) ?? []).length;
      return n === 2 ? ok("2: /widget/:path* and the catch-all") : bad(`${n} CSP header declaration(s) in next.config.ts`);
    },
    poison: (f) => {
      f.nextConfig += '\n{ key: "Content-Security-Policy", value: "default-src *" }';
      return f;
    },
  },
  {
    id: "W16.1",
    claim: "No route resolves the caller's membership with its own inline query",
    reviewed: {
      // The first three address memberships as the *resource* — listing,
      // changing and transferring them is what they are for. The last two are
      // not the caller's own membership either: expand reads every org the
      // caller belongs to, to decide staff vs patron disclosure, and
      // onboard-org creates the row that the helpers would look for.
      "src/app/api/staff/members/[id]/route.ts": "memberships are the resource",
      "src/app/api/staff/invitations/route.ts": "reads the invitee's memberships",
      "src/app/api/staff/transfer-ownership/route.ts": "moves the owner row",
      "src/app/api/sessions/expand/route.ts": "reads ALL of the caller's orgs for the staff/patron split, not one",
      "src/app/api/auth/onboard-org/route.ts": "creates the membership row",
    },
    run: (f, reviewed) => {
      const hits = f.routes
        .filter((r) => /from\("org_memberships"\)/.test(r.code))
        .map((r) => ({ key: r.path, label: r.path }));
      return triage(hits, reviewed, "inline membership query(ies)");
    },
    poison: (f) => {
      f.routes.find((r) => !/org_memberships/.test(r.code)).code +=
        '\nconst { data } = await supabase.from("org_memberships").select("role").single();';
      return f;
    },
  },
];

/** Everything the prompt asks for that a static or anonymous check cannot answer. */
const MANUAL = [
  ["W1", "Tamper with a real access token and drive a route with it (scripts/verify/verify-o.mjs)"],
  ["W2", "pg_policies / pg_class against the LIVE database — migrations here are applied by hand"],
  ["W3", "Diff the columns anon actually receives from each public relation"],
  ["W4", "Two populated orgs: every cross-org call answers 404/403 and the in-org call succeeds"],
  ["W5", "POST a body with a privileged extra key; read the row back with the service role"],
  ["W6", "A fixture holding a draft, an unreviewed week, an approved week, an unlisted facility and a session_internal row"],
  ["W7", "Two users + anon against a PRODUCTION build; publish/unpublish and watch the flip"],
  ["W8", "grep the built client bundle for the service-role key (prompt W8)"],
  ["W9", "Replay a captured Stripe event: tampered → 400, twice → one write; PATCH subscriptions as an owner"],
  ["W10", "Flood a public route until a 429 appears, then confirm the stored bucket key is a digest"],
  ["W13", "Upload to Storage directly under another org's path, 20 MB, and image/svg+xml"],
  ["W16", "The four-role × ~30-permission matrix, filled three times (UI, route, PostgREST)"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Live probes. Anonymous by construction; the service role only builds controls.
// ─────────────────────────────────────────────────────────────────────────────

function readEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

async function rest(base, key, pathAndQuery, init = {}) {
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const range = res.headers.get("content-range"); // "0-4/57"
  const total = range && range.includes("/") ? Number(range.split("/")[1]) : null;
  return { status: res.status, body, total };
}

async function liveChecks(results) {
  const env = readEnv();
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const svcKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !anonKey || !svcKey) {
    results.push({ id: "LIVE", cls: "live", state: "FAIL", claim: ".env.local is missing a key", detail: "" });
    return;
  }

  // The control for every negative below: the anon key can read *something*.
  // 206, not 200: PostgREST answers Partial Content whenever a limit or range
  // narrows the result, and `Prefer: count=exact` makes every call here one of
  // those. Asserting 200 turned a working control into an INCONCLUSIVE and, with
  // it, every negative below into an unproven claim.
  const control = await rest(base, anonKey, `${PUBLIC_RELATIONS[0]}?select=id&limit=1`);
  const controlOk = [200, 206].includes(control.status) && (control.total ?? 0) > 0;
  results.push({
    id: "LV0",
    cls: "W3",
    state: controlOk ? "PASS" : "INCONCLUSIVE",
    claim: `positive control: anon can read ${PUBLIC_RELATIONS[0]}`,
    detail: controlOk
      ? `${control.total} row(s) — the negatives below are therefore meaningful`
      : `status ${control.status}, total ${control.total} — the negatives below prove nothing`,
  });

  for (const [table, provenBy] of PRIVATE_TABLES) {
    const truth = await rest(base, svcKey, `${table}?select=*&limit=1`);
    const seen = await rest(base, anonKey, `${table}?select=*&limit=1`);
    const rows = Array.isArray(seen.body) ? seen.body.length : 0;
    const blocked = seen.status >= 400 || (seen.total ?? rows) === 0;

    let state;
    let detail;
    if (truth.status >= 400) {
      state = "INCONCLUSIVE";
      detail = `the service role could not read it either (${truth.status}) — table may not exist`;
    } else if ((truth.total ?? 0) === 0) {
      state = "INCONCLUSIVE";
      detail = `the table is empty, so an empty anon read proves nothing${
        provenBy ? ` — ${provenBy} builds a fixture and proves it` : ""
      }`;
    } else if (blocked) {
      state = "PASS";
      detail = `${truth.total} row(s) exist; anon got ${seen.status === 200 ? "0 rows" : `HTTP ${seen.status}`}`;
    } else {
      state = "FAIL";
      detail = `anon read ${rows} row(s); columns: ${Object.keys(seen.body[0] ?? {}).join(", ")}`;
    }
    results.push({ id: `LV.${table}`, cls: "W2/W3", state, claim: `anon cannot read ${table}`, detail });
  }

  // A write, not a read: INSERT is a separate policy and a separate mistake.
  const wrote = await rest(base, anonKey, "analytics_events", {
    method: "POST",
    body: JSON.stringify({ org_id: "00000000-0000-0000-0000-000000000000", event_type: "sweep_probe" }),
  });
  results.push({
    id: "LV.write",
    cls: "W2",
    state: wrote.status >= 400 ? "PASS" : "FAIL",
    claim: "anon cannot INSERT into analytics_events",
    detail: `HTTP ${wrote.status}${wrote.status < 400 ? " — A ROW WAS WRITTEN" : ""}`,
  });

  // Entitlement forgery: the shape that costs money.
  const upgraded = await rest(base, anonKey, "subscriptions?plan_tier=eq.free", {
    method: "PATCH",
    body: JSON.stringify({ plan_tier: "enterprise" }),
  });
  const changed = Array.isArray(upgraded.body) ? upgraded.body.length : 0;
  results.push({
    id: "LV.entitlement",
    cls: "W9",
    state: upgraded.status >= 400 || changed === 0 ? "PASS" : "FAIL",
    claim: "anon cannot raise a plan tier",
    detail: `HTTP ${upgraded.status}, ${changed} row(s) returned`,
  });

  if (APP) await headerChecks(results);
}

async function headerChecks(results) {
  const probe = async (id, url, assert) => {
    try {
      const res = await fetch(url, { redirect: "manual" });
      const { state, detail } = assert(res);
      results.push({ id, cls: "W15", state, claim: `headers: ${new URL(url).pathname}`, detail });
    } catch (err) {
      results.push({ id, cls: "W15", state: "INCONCLUSIVE", claim: `headers: ${url}`, detail: err.message });
    }
  };

  await probe("HD.csp", `${APP}/`, (res) => {
    const raw = res.headers.get("content-security-policy");
    if (!raw) return { state: "FAIL", detail: "no Content-Security-Policy header" };
    // fetch() joins duplicate headers with ", " — two policies means the
    // browser enforces their intersection, which is a policy nobody wrote.
    const policies = raw.split(",").filter((p) => /default-src/.test(p)).length;
    if (policies > 1) return { state: "FAIL", detail: `${policies} policies in one header` };
    return { state: "PASS", detail: `1 policy; frame-ancestors ${/frame-ancestors ([^;]+)/.exec(raw)?.[1] ?? "?"}` };
  });

  await probe("HD.frame", `${APP}/`, (res) => {
    const xfo = res.headers.get("x-frame-options");
    const hsts = res.headers.get("strict-transport-security");
    return xfo
      ? { state: "PASS", detail: `X-Frame-Options: ${xfo}; HSTS: ${hsts ?? "absent"}` }
      : { state: "FAIL", detail: "no X-Frame-Options on the app origin" };
  });

  await probe("HD.widget", `${APP}/widget/00000000-0000-0000-0000-000000000000`, (res) => {
    const csp = res.headers.get("content-security-policy") ?? "";
    const framable = /frame-ancestors \*/.test(csp);
    const xfo = res.headers.get("x-frame-options");
    if (!framable) return { state: "FAIL", detail: `widget is not framable: ${csp.slice(0, 80)}` };
    if (xfo) return { state: "FAIL", detail: `X-Frame-Options: ${xfo} on the widget route` };
    return { state: "PASS", detail: "frame-ancestors *, no X-Frame-Options" };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

function runStatic(base, results) {
  for (const check of STATIC) {
    let outcome;
    try {
      outcome = check.run(facts(base), check.reviewed ?? {});
    } catch (err) {
      outcome = { ok: false, detail: `check threw: ${err.message}`, hits: [] };
    }
    results.push({
      id: check.id,
      cls: check.id.split(".")[0],
      state: outcome.ok ? "PASS" : "FAIL",
      claim: check.claim,
      detail: outcome.detail,
      hits: outcome.hits ?? [],
    });
  }
}

/**
 * The self-test. Each check is re-run against evidence poisoned in exactly the
 * way the check exists to catch; one that still passes is reported BLIND, which
 * is worse news than any red above it.
 */
function runFalsify(base, results) {
  for (const check of STATIC) {
    if (!check.poison) {
      results.push({ id: check.id, cls: check.id.split(".")[0], state: "MANUAL", claim: check.claim, detail: "no poison defined" });
      continue;
    }
    let outcome;
    try {
      outcome = check.run(check.poison(facts(base)), check.reviewed ?? {});
    } catch (err) {
      outcome = { ok: false, detail: `threw: ${err.message}` };
    }
    results.push({
      id: check.id,
      cls: check.id.split(".")[0],
      state: outcome.ok ? "BLIND" : "BITES",
      claim: check.claim,
      detail: outcome.ok ? "poisoned evidence still passed" : `caught: ${outcome.detail}`,
    });
  }
}

const COLOR = { PASS: "\x1b[32m", BITES: "\x1b[32m", FAIL: "\x1b[31m", BLIND: "\x1b[31m", INCONCLUSIVE: "\x1b[33m", MANUAL: "\x1b[36m" };

async function main() {
  const base = collect();
  const results = [];

  if (FALSIFY) {
    runFalsify(base, results);
  } else {
    runStatic(base, results);
    if (LIVE) await liveChecks(results);
    for (const [cls, what] of MANUAL) {
      results.push({ id: `${cls}.manual`, cls, state: "MANUAL", claim: what, detail: "docs/prompts/frontend-database-security.md" });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ when: new Date().toISOString(), live: LIVE, falsify: FALSIFY, results }, null, 2));
  } else {
    const label = FALSIFY ? "self-test (poisoned evidence)" : LIVE ? "static + live" : "static only";
    console.log(`\nSecurity sweep — ${label} — ${new Date().toISOString().slice(0, 19)}Z\n`);
    for (const r of results) {
      console.log(`${COLOR[r.state] ?? ""}${r.state.padEnd(12)}\x1b[0m ${r.id.padEnd(20)} ${r.claim}`);
      if (r.detail) console.log(`${" ".repeat(33)}${r.detail}`);
      for (const hit of (r.hits ?? []).slice(0, 12)) console.log(`${" ".repeat(35)}- ${hit}`);
      if ((r.hits ?? []).length > 12) console.log(`${" ".repeat(35)}… ${r.hits.length - 12} more`);
    }
    const count = (s) => results.filter((r) => r.state === s).length;
    console.log(
      `\n${count("PASS") + count("BITES")} pass · ${count("FAIL") + count("BLIND")} fail · ` +
        `${count("INCONCLUSIVE")} inconclusive · ${count("MANUAL")} manual\n`
    );
    if (!LIVE && !FALSIFY) console.log("Static only. Run with --live for the anonymous PostgREST probes.\n");
  }

  process.exit(results.some((r) => r.state === "FAIL" || r.state === "BLIND") ? 1 : 0);
}

main();
