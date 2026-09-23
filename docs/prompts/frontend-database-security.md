# Prompt — the front end and the database

**Audit the whole path from a browser to a row in Postgres, as if nothing had
ever been audited.**

This file is a *prompt*, not a report. Hand it to a fresh agent (or read it
yourself) and work it top to bottom. Findings go in
[`docs/SECURITY.md`](../SECURITY.md), which is the register; this file is the
method that fills it. The re-runnable half of the method is
[`scripts/security/sweep.mjs`](../../scripts/security/sweep.mjs) — see
[§5, The loop](#5-the-loop).

**Start from zero.** `docs/SECURITY.md` records a 2026-08-06 audit and nineteen
closed findings. Read it *after* you have formed your own view, never before:
its closed findings are the answers to last year's exam, and four of them turned
out to be different from their write-ups. A closed finding is a hypothesis that
was tested once, on a codebase roughly thirty migrations and several thousand
lines ago. Re-derive the boundary from the code that exists today, then
reconcile.

---

## 0. How to use this

One pass = §1 (build the map) → §3 (work every class) → §4 (write the findings)
→ §5 (close the loop). A pass is not finished when the reading is done. It is
finished when every class in §3 has either a finding in the register or a
recorded negative result naming *how* it was checked.

Three things that are not evidence and must never be written down as if they
were: the code says so; a comment says so; a previous audit said so. This
codebase is unusually well commented, and the comments are mostly right — which
is exactly what makes them dangerous to audit against. A policy comment
describes the policy that was written, not the policy that is in the database.
Migrations here are **applied by hand**, so the migration file and the live
schema drift by construction.

---

## 1. What you are auditing: seven paths from a browser to a row

Draw this before looking for bugs. Every finding in the register that mattered
was a path someone had not drawn.

| # | Path | What stands between the caller and the data |
|---|---|---|
| **P1** | Browser → PostgREST directly (`https://<ref>.supabase.co/rest/v1/…`) | **RLS only.** The publishable key ships in the JS bundle. Anyone can `curl` this. |
| **P2** | Browser → Route Handler (51 of them) → `lib/supabase/server.ts` | Route auth (`getUser` + `getRouteMembership` + `requirePermission`) **and** RLS as that user. |
| **P3** | Browser → Route Handler → `lib/supabase/admin.ts` | **Route auth only.** The service role bypasses RLS entirely. Four call sites. |
| **P4** | Browser → Server Component → `lib/supabase/server.ts` | Layout/page guards **and** RLS. The output is an RSC payload the browser can read in full. |
| **P5** | Anonymous browser → cached page / `use cache` → `lib/supabase/public.ts` | RLS as `anon`, **and the result is shared between every visitor**. |
| **P6** | Stripe → `/api/stripe/webhook` → service role → `subscriptions` | Signature verification + idempotency. No user involved. |
| **P7** | Browser → Supabase Storage (`org-media`) directly | Storage RLS policies on `storage.objects`. The client-side size/MIME checks are a courtesy. |

`src/proxy.ts` is **not** on this list, on purpose. It is an optimistic redirect
for `/dashboard/*`, it does not run on `/api/*` at all (read its matcher), and
Next's own docs say not to treat Proxy as an authorization solution. If you find
yourself writing "the proxy protects X", you have found a bug: it protects
nothing that P1 can reach.

The load-bearing consequence of P1: **anything enforced only in TypeScript is
advisory.** `src/lib/auth/roles.ts` and `src/lib/auth/guard.ts` exist to produce
a legible 403 and to decide what the navigation offers. The control is the
policy in Postgres. Every check in §3 that names a route must therefore be asked
twice — once of the route, once of PostgREST with the same credentials.

---

## 2. Ground rules for evidence

These are the rules `scripts/verify/README.md` learned the hard way, restated
for an audit, where a false green is worse than no check at all.

1. **A positive control on every check.** An empty result set proves nothing:
   `[]` from a working policy and `[]` from an empty table are byte-identical.
   Before asserting "anon cannot read `sessions`", prove with the service role
   that rows exist to be read, and that anon *can* read something else.
2. **Never the service role for the thing under test.** It bypasses RLS, so it
   makes any policy test pass. It builds fixtures and tears them down; a really
   signed-in user, or a really anonymous `fetch`, does the acting.
3. **Falsify every check that passes.** Break the control deliberately — remove
   the `.eq("org_id", …)`, restore the old policy, strip the signature — and
   confirm the check goes red. A check that has never been red is a check whose
   locator may be pointed at the wrong thing. Two harnesses in this repo were
   passing against the sidebar rather than the tile they named.
4. **Test the mechanism, not the outcome.** "The request 403s" is satisfied by a
   route that 403s everyone, including the coordinator whose job it is. Assert
   the denial *and* the matching permit, in the same run.
5. **Verify against the live database, not the migration file.** Migrations are
   applied by hand here. `supabase/migrations/*.sql` is a record of intent;
   `select * from pg_policies` is the truth.
6. **Two roles wherever a role distinction is the point.** Four roles exist —
   `owner`, `manager`, `coordinator`, `aux` (migration 055). A fixture that
   inserts `role: "admin"` fails its insert *silently* and then 403s everything,
   which reads like a product bug rather than a fixture one. Around twenty-five
   harnesses still do this.

---

## 3. The weakness classes

Work each one. For each: the claim, why this particular stack is prone to it,
how to look, and what would count as proof.

### W1 — Who the caller is

**Claim:** every authorization decision is made from a credential that cannot be
forged by the person presenting it.

**Why here:** three different functions answer "who is this?" — `getClaims()`
(local ES256 verification, ~1 ms), `getUser()` (network, ~100 ms), and
`getSession()`, which decodes the cookie and checks *nothing*. They look
interchangeable at the call site and are not. There is a fourth answer,
`auth.uid()` inside RLS, and it is the only one Postgres believes.

**Look:**

```bash
grep -rn "getSession()" src                       # must be zero for authorization
grep -rn "user_metadata" src supabase/migrations  # user-writable; never for authz
grep -rn "app_metadata" src supabase/migrations
```

- Does anything branch on `user_metadata`? It is writable by the user through
  `auth.updateUser()` from the browser. `raw_app_meta_data` is service-role-only.
- Does `getClaims()`'s JWKS fetch fail open? Read `src/lib/auth/claims.ts`: what
  happens when the key set is unreachable — deny, or fall back to a network
  `getUser()`?
- The revocation window: a locally verified token stays acceptable until it
  expires. How long is this project's access-token lifetime, and what actually
  re-checks revocation? (The proxy, for `/dashboard/*` only — and the proxy does
  not run on `/api/*`.)

**Proof:** tamper with a real access token — flip a byte in the payload, re-sign
with a key you control, present an expired one — and drive a route with it.
`scripts/verify/verify-o.mjs` is the existing shape of this.

### W2 — RLS completeness

**Claim:** every table has RLS enabled, and a policy for every verb the app
performs, `WITH CHECK` included.

**Why here:** 38 tables, 156 `CREATE POLICY` statements across 58 migrations,
applied by hand. Two failure modes: a new table shipped without
`ENABLE ROW LEVEL SECURITY` (wide open to P1), and an UPDATE policy with a
`USING` clause and no `WITH CHECK` — which lets a caller read a row they own and
write it into someone else's tenancy.

**Look:**

```bash
grep -rho "CREATE TABLE[^(]*" supabase/migrations/*.sql | sort -u
grep -rho "ALTER TABLE [a-z_.]* ENABLE ROW LEVEL SECURITY" supabase/migrations/*.sql | sort -u
grep -rn "FOR UPDATE" supabase/migrations/*.sql   # each needs a WITH CHECK
grep -rn "USING (true)\|USING (TRUE)" supabase/migrations/*.sql
```

Then, against the live database:

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' order by 1;

select tablename, policyname, cmd, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, cmd;
```

- Any table with `relrowsecurity = false` is a P1 hole, full stop.
- Any `cmd = 'UPDATE'` row with `with_check IS NULL` is a tenancy-move hole.
- Any `qual = 'true'` outside a deliberate public projection is finding M1 again.
- Table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. Check who
  owns these tables and whether any application path connects as that role.
- `SECURITY DEFINER` helpers (`user_org_ids()`, `org_can_manage()`, and 30-odd
  others) run as their owner. Each needs a pinned `search_path`, or a caller who
  can create objects in a schema earlier on the path can substitute a function
  the policy then trusts.

**Proof:** as anon, and as a signed-in member of org B, `curl` PostgREST for a
row belonging to org A, with the service role confirming that row exists.

### W3 — Column exposure and definer views

**Claim:** no column a stranger should not see is reachable by a stranger.

**Why here:** **RLS is row-level, never column-level.** A policy that lets you
read a row lets you read every column of it. The register's M2 is exactly this:
"anyone may read active orgs" meant anyone could read `email`, `phone`,
`address_line1`, `postal_code` and `stripe_customer_id`. The fix was a
projection — `organizations_public`, a **definer view** whose column list *is*
the access control. That makes the view a standing liability: a column added to
it becomes world-readable with no policy change and no error.

**Look:**

```bash
grep -rn "CREATE OR REPLACE VIEW\|security_invoker" supabase/migrations/*.sql
grep -rn "GRANT SELECT" supabase/migrations/*.sql
```

```sql
select table_name, grantee, privilege_type from information_schema.role_table_grants
 where grantee in ('anon','authenticated') and table_schema = 'public' order by 1;
select viewname, definition from pg_views where schemaname = 'public';
```

- For every view granted to `anon`, list its columns and justify each one.
- Is `security_invoker` set as intended on each? A definer view deliberately
  bypasses the base table's RLS, so its `WHERE` clause is the whole control.
- Sidecar tables are the other half of this pattern: `session_internal` exists so
  staff-only facts are not columns on `sessions`. Confirm nothing has quietly
  added a staff-only column back onto a publicly readable table.

**Proof:** `curl` the view as anon and diff the returned keys against the
justified list. Do the same for `sessions`, `spaces`, `departments`,
`facilities` and `organizations`.

### W4 — Tenant isolation

**Claim:** an org can reach its own rows and no others; a coordinator can reach
their departments' rows and no others.

**Why here:** almost nothing a coordinator touches carries a `department_id`.
Authorization has to walk `session → schedule_group → department`
(`src/lib/auth/scope-lookup.ts`), and that walk returns **three** values: an id;
`null`, meaning the row genuinely has no department (owner/manager territory);
and `undefined`, meaning no such row, or not in this org — a 404, never a 403.
Flattening `null` and `undefined` hands managers authority over rows that do not
exist and tells a coordinator their department is wrong.

**Look:**

```bash
# mutating queries that address a row by id without also pinning the org
grep -rn "\.eq(\"id\"" src/app/api | grep -v org_id
grep -rn "departmentOf" src/app/api | wc -l
```

- For each `[id]` route: is the org pinned in the query, or is RLS the only thing
  standing between orgs? (RLS *should* be enough — verify that it is, rather than
  assuming the missing `.eq` is harmless.)
- Nested writes: does any route insert a child row with a parent id taken from
  the body without checking the parent's org? `session_spaces`,
  `membership_scopes`, `widget_config_scopes` and `session_template_*` are the
  shapes to check.
- `/api/sessions/batch` takes an array. Does it authorize **every element**, or
  only the first?

**Proof:** two real orgs, both populated. Every cross-org attempt answers 404 or
403, and the same call inside the caller's own org succeeds — both halves, one
run.

### W5 — Mass assignment and privileged columns

**Claim:** no request body can set a column that decides authority, identity,
money or publication.

**Why here:** fifteen of the 51 route handlers do not import `zod`, and
Supabase's `.update(body)` writes whatever keys it is handed. The columns that
must never come from a body: `org_id`, `user_id`, `role`, `plan_tier`, `status`,
`approved_at`/`approved_by`, `stripe_customer_id`, `stripe_subscription_id`,
`slug` (a global namespace since migration 057), `published_at`, any
`display_order` that encodes authority, and anything on `session_internal`.

**Look:**

```bash
for f in $(find src/app/api -name route.ts); do grep -q 'from "zod"' "$f" || echo "$f"; done
grep -rn "\.update(body\|\.insert(body\|\.update({ \.\.\.\|\.insert({ \.\.\." src/app/api
grep -rn "org_id:\|role:\|plan_tier:\|status:" src/app/api | grep -v "membership\.\|org\.id\|orgId"
```

- Zod strips unknown keys by default — but only if the route writes
  `parsed.data` rather than the raw body. Check which object reaches `.update()`.
- Trigger-locked columns are the backstop (migration 057 locks `approved_at`).
  Enumerate the locks and confirm each still exists in the live database.

**Proof:** POST a body carrying the extra key. The response may well be 200 —
what matters is the row afterwards, read with the service role.

### W6 — The public read surface

**Claim:** exactly the rows an organization has chosen to publish are visible to
a stranger, and nothing else.

**Why here:** publication is not one flag. It is `schedule_groups.status` plus
`published_at`; per-week review rows (migration 037 — a week of a published
schedule stays hidden until reviewed `approved`); facility `is_listed` for the
directory (052); org verification (057); widget scope rows (043); and the
occupancy disclosure split (046). Six independent gates, any one of which a new
query can forget, and the failure is silent: an unpublished schedule that
renders looks exactly like a published one.

**Surfaces:** `/facility/[facilitySlug]`, `/find`, `/widget/[orgId]`,
`/embed/widget.js`, `/api/public/v1/directory`, `/api/sessions/expand`,
`/api/facility-maps/public`, `sitemap.xml`, `robots.txt`.

**Look:** for each, read the query and list which of the six gates it applies.
Then ask the opposite question — which rows would appear if that gate were
dropped? — and build that fixture.

**Proof:** one org containing a draft schedule, a published schedule with an
unreviewed week, a published-and-approved week, an unlisted facility, and a
session carrying a `session_internal` row. Fetch every public surface
anonymously and assert precisely which appear. The internal sidecar must appear
in no payload — including the RSC stream and the widget JSON, which are both
readable in full by anyone who opens the network tab.

### W7 — The cache boundary

**Claim:** nothing user-specific is ever stored in a cache entry another user
can be served.

**Why here:** `cacheComponents: true` (PPR) is on, so every route ships a
prerendered shell. `use cache` functions may not read cookies — which is *why*
`lib/supabase/public.ts` exists — and that guardrail is a build-time error, so
the dangerous shape is the one that compiles: a cached function taking a
user-scoped argument, or a `cacheTag` not keyed by tenant. The tag is also the
invalidation key: `facilitySlugCacheTag(slug)` and `widgetConfigCacheTag(orgId)`
must be revalidated by *every* write that changes what they render, or a revoked
publication keeps serving.

**Look:**

```bash
grep -rln "use cache" src
grep -rn "cacheTag(\|cacheLife(\|revalidateTag(" src
grep -rn "Cache-Control" src/app/api          # any authed route with a public cache?
```

- Is `createClient` from `lib/supabase/server` imported by any file containing
  `use cache`?
- Does any authenticated route set `Cache-Control: public`, or an `s-maxage`
  without `private`? Vercel's CDN will happily share it.
- Does `/api/sessions/expand` vary its cache key on everything that changes its
  answer — org, facility, filters, audience (staff vs patron), week?

**Proof:** request a cached surface as user A, then as user B and as anon, and
diff. Then publish/unpublish and confirm the surface flips within the documented
window. Judge cache freshness on a **production build**, never `next dev`, which
serves stale segments for minutes.

### W8 — Service-role blast radius

**Claim:** every service-role call re-derives its own authorization, because RLS
is not there to catch it.

**Why here:** four files hold the key — `analytics/track`, `auth/onboard-org`,
`stripe/webhook`, `lib/rate-limit`. Two are reachable by unauthenticated
callers. It is also the one secret whose leak cannot be contained without a
rotation.

**Look:**

```bash
grep -rn "createAdminClient" src | grep -v "supabase/admin.ts"
grep -rln '"use client"' src | xargs grep -ln SERVICE_ROLE 2>/dev/null
grep -rn "SUPABASE_SERVICE_ROLE_KEY" src .env.example
```

For each of the four: what does it take from the caller, and what does it write?
`onboard-org` is the sharpest — it creates an organization and the caller's
membership in it. Can it be called twice? With someone else's `user_id`? Can it
make the caller an `owner` of an existing org?

**Proof:** grep the built client bundle for the key itself. That is the check
that cannot be argued with:

```bash
NEXT_DIST_DIR=.next-audit npx next build
grep -rl "$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2- | tr -d '\r')" .next-audit/static || echo "not in the bundle"
```

### W9 — Billing and entitlement

**Claim:** what an organization is entitled to is decided by what Stripe actually
billed, written by a signature-verified webhook, and readable-but-not-writable
by the browser.

**Why here:** `subscriptions` is the only table whose contents are worth money.
The register's M3 was this class: the webhook silently dropped entitlements
because a field was nested differently than the code expected, and the 200
response looked fine.

**Look:**

```bash
grep -rn "CREATE POLICY" supabase/migrations/*.sql | grep -i subscription
grep -rn "plan_tier\|getPlanTierFromPriceId" src/lib src/app/api
```

- Does `subscriptions` have **any** client-side INSERT/UPDATE/DELETE policy? It
  must not. Confirm in `pg_policies`, not in the migration file.
- Does the tier come from the price id on the subscription (what Stripe billed)
  or from `metadata.tier` (what we claimed at checkout)? When they disagree, the
  money is the truth.
- Can a client choose the price? `/api/stripe/create-checkout` takes a `tier`
  enum, not a price id — confirm no path accepts a raw `price_…` from a body.
- Is the webhook idempotent, and does a failed handler return non-2xx so Stripe
  retries? Does any handler fall back to a default tier on unrecognised input? A
  default is either a free upgrade or a silent downgrade.
- Is the Stripe API version pinned, and does the handler read the fields that
  version actually sends? Verify against a **real event payload and a database
  row**, not a 200 response.

**Proof:** replay a captured `customer.subscription.updated` with a tampered body
and confirm the 400; replay it twice unmodified and confirm one write; `curl`
PostgREST as an org owner attempting to PATCH `subscriptions` with
`plan_tier=enterprise`, and confirm the row is unchanged afterwards.

**Payment tiers are being refined.** Stripe holds two products today and will
hold more. Feature gating is deliberately **not built yet** (see
[`docs/pricing-tiers.md`](../pricing-tiers.md)); do not build it as part of an
audit. What the audit owes the future gating is the list of properties it will
have to satisfy — [§6](#6-what-tier-gating-will-have-to-satisfy) — plus a check
that the entitlement *record* is already unforgeable, which is the part that
cannot be retrofitted.

### W10 — Cost and abuse

**Claim:** no anonymous caller can make this deployment expensive, and no read
silently truncates.

**Why here:** Supabase and Vercel both bill on usage, there are no spend caps
yet, and `/api/sessions/expand` turns one request into recurrence expansion
across a date range. Separately: **PostgREST caps a response at 1,000 rows with
no error.** A `.limit(5000)` returns 1,000 and reports it as a total. That is a
correctness bug that becomes a security one when the truncated thing is a count
used as a limit or an audit.

**Look:**

```bash
for f in $(find src/app/api -name route.ts); do grep -q checkRateLimit "$f" || echo "unthrottled: $f"; done
grep -rn "\.limit([0-9]\{4,\}" src        # anything at or above 1000 is suspect
grep -rn "\.range(" src
```

- Every public or paid endpoint must call `checkRateLimit()`. The proxy matcher
  excludes `/api`, so **nothing is throttled by default**.
- Is the bucket keyed by something the caller cannot rotate for free — IP for
  anon, user id for authenticated? Is the identifier hashed, given `/privacy`
  says IPs are not stored?
- Is there an upper bound on the date range `/api/sessions/expand` accepts, on
  the array `/api/sessions/batch` accepts, and on the CSV import's row count —
  and is the cap applied *before* the work, not after?

**Proof:** flood a route and watch for a 429, then check the stored bucket key is
a digest rather than an address. A run that never sees a 429 has proven nothing:
confirm the limit is reachable.

### W11 — Injection and untrusted output

**Claim:** no caller-supplied string changes the meaning of a query, a document
or a page.

**Why here:** four distinct sinks, only one of which is classic SQL.

- **PostgREST filter strings.** `.or()` takes a filter *expression*;
  interpolating user input into one is this stack's SQL injection. `.ilike()`
  values are encoded, but `%` and `_` in a user's term are still wildcards, and a
  pathological pattern is a CPU bill.
- **CSV.** A cell beginning `=`, `+`, `-` or `@` executes when the export is
  opened in Excel. Quoting does not neutralise it; a prefix does.
- **HTML.** The CSP here carries `script-src 'unsafe-inline'` — a deliberate
  trade for PPR — so the XSS ceiling is set by React's escaping, not by the
  policy. Any `dangerouslySetInnerHTML` is load-bearing.
- **Redirects.** `next`/`redirectTo` parameters appear in emailed links.

**Look:**

```bash
grep -rn "\.or(\`\|\.or(.*\${" src
grep -rn "ilike\|\.like(\|textSearch" src
grep -rn "dangerouslySetInnerHTML\|innerHTML" src
grep -rn "redirectTo\|searchParams.get(\"next\")" src/app
```

**Proof:** send `a,b`, `*`, `%`, `)` and `,or(` through every search and filter
parameter and compare the row set against the same query run with the service
role. Export a cell containing `=1+1` and read the bytes.

### W12 — Secrets and configuration

**Claim:** no secret reaches the browser, and no missing variable produces a
plausible-but-wrong app.

**Why here:** `NEXT_PUBLIC_` is a compile-time inlining rule, not a convention —
one prefix typo publishes a secret to every visitor. And the register's M6 was a
fallback: `process.env.X ?? "some-constant"` made IP hashes reversible in any
environment that forgot the variable, with nothing failing.

**Look:**

```bash
grep -rn "NEXT_PUBLIC_" src | grep -iv "SUPABASE_URL\|PUBLISHABLE_KEY\|APP_URL"
grep -rn "process.env.[A-Z_]* ??\|process.env.[A-Z_]* ||" src
grep env .gitignore
git log --all --diff-filter=A --name-only | grep -i "env.local" || echo "never committed"
```

- Is every security-relevant variable in `REQUIRED_SERVER_ENV` and read through
  `requireEnv()`?
- Does anything imported by a client component read `process.env` at all?
  `lib/stripe/plans.ts` is imported client-side — it must stay secret-free.
- When was the service-role key last rotated, and who holds it?

### W13 — Storage

**Claim:** the bucket enforces what the upload form claims.

**Why here:** the browser talks to Storage directly (P7), so
`validateImageFile()` is advisory. The bucket is single, public and path-scoped —
`org/<org_id>/<kind>/…` — so the *path* is the tenancy boundary and the policy
has to parse it. A malformed path must deny, not raise: a bare `::UUID` cast
inside a policy turns a junk path into a 500 and hands the caller an oracle. SVG
must stay off `allowed_mime_types` — Storage is served from `*.supabase.co`,
which this app's own CSP trusts in `img-src`.

**Look:**

```bash
grep -rn "org-media\|storage.objects\|allowed_mime_types\|file_size_limit" supabase/migrations/*.sql
```

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage';
```

**Proof:** signed in as a member of org A, upload directly to Storage with a path
under org B, a 20 MB file, and an `image/svg+xml`. All three must fail at the
bucket, not at the form.

### W14 — What gets logged, and what gets returned

**Claim:** errors tell the caller nothing about the schema, and the logs hold no
raw PII.

**Why here:** returning a raw PostgREST error (finding L1) leaks table, column
and policy names — a free schema dump. And `activity_log`, `analytics_events`
and `rate_limits` are three tables the app writes *about* its users; each is a
place where a "we don't store that" claim can quietly become false.

**Look:**

```bash
grep -rn "error.message\|error\.details\|error\.hint" src/app/api
grep -rn "console.log\|console.error" src/app/api | head -40
grep -rn "x-forwarded-for\|user_agent" src/lib src/app/api
```

- Does any route return a Postgres error object to the client?
- Does `activity_log` store values from fields that may contain personal data,
  and does `/privacy` match what the three tables actually hold?
- Is the analytics IP hash salted per deployment and rotated daily?

### W15 — Headers, CORS and framing

**Claim:** the widget is framable everywhere, the dashboard nowhere, and exactly
one CSP header is emitted.

**Why here:** two `headers()` blocks set CSP, and browsers enforce the
**intersection** of duplicate CSP headers — producing a policy nobody wrote.
`/widget/*` sets `Access-Control-Allow-Origin: *`, which is right for a public
read-only embed and would be a disaster on anything that mutates.

**Look:**

```bash
curl -sI https://<host>/                    | grep -i "content-security-policy\|x-frame\|strict-transport"
curl -sI https://<host>/widget/<orgId>      | grep -i "content-security-policy\|access-control"
curl -sI https://<host>/api/sessions/expand | grep -i "access-control\|cache-control"
```

- Exactly one CSP header per response, on both branches.
- Does any `/api/*` route echo an `Origin` header back in
  `Access-Control-Allow-Origin`, especially alongside credentials?
- Is HSTS still on the short rollout value, and is that still deliberate?

### W16 — UI gating is not a control

**Claim:** every button hidden from a role is also refused by the route *and* by
a policy.

**Why here:** `isReadOnly(role)` and `can(actor, perm, deptId)` decide what
renders. The scoped-permission trap runs both ways: `can()` without a department
answers **false for a coordinator**, so page-level gating uses
`!isReadOnly(role)` — and a route that gates on that same loose check is now
weaker than the UI implies.

**Look:** build the matrix. Rows: the four roles plus anon. Columns: each of the
~30 permissions in `src/lib/auth/roles.ts`. Fill every cell three times — what
the UI shows, what the route answers, what PostgREST answers. A row where the
three disagree is a finding: where the UI is *stricter* it is a UX bug; where it
is *looser* it is a vulnerability.

**Proof:** `scripts/verify/verify-al.mjs` already drives the role matrix against
PostgREST directly. Extend it rather than re-inventing it — after checking its
fixtures do not insert the invalid `"admin"` role.

---

## 4. Writing a finding

Into `docs/SECURITY.md`, in its existing format. A finding is worth writing only
if it says all of:

- **What is exposed or forgeable**, concretely — which rows, which columns,
  which action, by whom.
- **The reproduction**, as a command someone else can run.
- **Why the obvious mitigation does not already cover it** — name the layer you
  checked (route, policy, trigger, header) and what it actually said.
- **Severity.** Critical = data breach, account takeover, financial loss or
  unbounded cost is possible *right now*, with no special access.

Do not write a finding whose evidence is "the code looks wrong". Run it. Six
confident claims in one previous session were overturned by measurement.

And when a fix depends on something staying true, add that sentence to
**Standing assumptions**. That section, not the finding, is what stops a future
change from silently reopening the hole.

---

## 5. The loop

An audit that happens once is a snapshot of a moving target. The loop is what
makes it a property of the codebase.

### The engine

```bash
node scripts/security/sweep.mjs                 # static: no server, no database
node scripts/security/sweep.mjs --live          # + anonymous probes against PostgREST
node scripts/security/sweep.mjs --live --app=http://localhost:3001
node scripts/security/sweep.mjs --json          # machine-readable, for a scheduled run
node scripts/security/sweep.mjs --falsify       # self-test: prove the checks can go red
```

Every check names the class above that it belongs to. A check that cannot be
automated is printed as `MANUAL` against the section of this file that describes
it, so the count of un-automated checks stays visible rather than forgotten.

### One pass

1. `node scripts/security/sweep.mjs --live` — the engine.
2. Triage every red: a real finding, or a check whose assumption has drifted?
   Fix the check in the same pass. A sweep nobody trusts is a sweep nobody runs.
3. Work the `MANUAL` list in §3 for everything the sweep cannot see.
4. Write findings into `docs/SECURITY.md`; add standing assumptions for the fixes.
5. Falsify at least one green per class you touched, and record what you broke.
6. Re-run until the only reds are findings you have written down.

### When to re-enter the loop

Rule 3 of the register: **re-audit when the trust boundary moves.** Concretely,
any of these starts a pass, and the pass is part of that work rather than a
follow-up:

- a new table, or any migration containing `CREATE POLICY`, `WITH CHECK`,
  `SECURITY DEFINER`, `GRANT`, or a view;
- a new route under `src/app/api`, or a new public page;
- a new `createAdminClient()` call site;
- a new role, permission or scope kind;
- a new third-party integration, inbound or outbound;
- **anything touching billing, price ids or the tier mapping** — which the next
  few months will, repeatedly;
- a Next.js or `@supabase/*` major version bump.

### Keeping it honest

Recorded numbers expire on their own. "0 open findings", "npm audit clean" and
"38 tables with RLS" are all true on the day they are measured and
unfalsifiable afterwards. The sweep re-measures them; the register's job is to
say when they were last measured, by what, and what would have made them red.

---

## 6. What tier gating will have to satisfy

Not to be built now. Recorded here because an audit is the right moment to fix
the requirements, and because building gating against the wrong entitlement
source is a rewrite rather than a patch.

Two Stripe products exist today and more are coming; the mapping lives in
[`docs/pricing-tiers.md`](../pricing-tiers.md), and the decision to hold
enforcement until there is a paying customer stands.

When it is built:

1. **Entitlement is read from the database, server-side, per request.** Never
   from a JWT claim minted at checkout, never from client state, never from
   Stripe `metadata`. `subscriptions.plan_tier`, written only by the webhook, is
   the single source.
2. **The gate is a policy first and a UI second.** If Pro-only means anything, it
   means the `anon` and `authenticated` roles cannot perform the action through
   PostgREST — the same P1 argument as every other control here. A gate that
   exists only in React is a pricing suggestion.
3. **Limits are counted server-side against a paged read.** PostgREST's 1,000-row
   cap makes "count the org's facilities" quietly wrong at scale, which is how a
   limit becomes unenforceable for exactly the customers it exists for.
4. **Downgrade is a defined state, not an error.** What happens to the eleventh
   facility when an org drops to a ten-facility tier? Decide explicitly —
   read-only, hidden, or blocked-on-write — and make the webhook's cancellation
   path produce it deterministically.
5. **Every new price id is a boundary move.** Adding a product means adding its
   env var to `REQUIRED_SERVER_ENV`, extending `getPlanTierFromPriceId()` so an
   unknown price **throws rather than defaulting**, and re-entering the loop.
6. **The free tier is the default for an org with no subscription row**, and that
   default is produced by the same function that maps a paid price — not by a
   `?? "free"` somewhere else that will drift from it.

---

## 7. Deliberately out of scope

Name these in the pass, so "not covered" is not mistaken for "covered and clean":

- **Infrastructure.** Supabase project settings, spend caps, backups, Vercel
  environment variables and access, DNS, the domain. Owner-only actions;
  `docs/SECURITY.md` tracks them in its own section.
- **Custom SMTP.** Still a launch blocker; the default Supabase mailer is shared
  and rate-limited.
- **Denial of service beyond cost.** Rate limiting here bounds the bill, not a
  determined flood.
- **Supabase's own platform security.** Assumed, not audited.
- **Dependency CVEs.** `npm audit` covers these and goes stale on its own —
  re-run it inside the pass rather than quoting a previous number.
