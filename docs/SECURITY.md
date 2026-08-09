# Security register

The living record of Dropin's security posture: what was found, what is fixed,
what is still open, and what must stay true for the fixes to keep working.

**This file is the source of truth.** Chat transcripts are not — they disappear.
If a finding is not written here, it does not exist.

---

## How to maintain this document

Four rules. They are what keep it accurate rather than decorative.

1. **A finding is only CLOSED when it is verified against the live database or a
   running app** — not when the code is written, and not when a migration file
   exists. Record *how* it was verified, so the claim can be re-checked later.
2. **Never delete a closed finding.** Move it to [Closed](#closed-findings) with
   its date, migration number and commit. The history is what tells a future
   auditor which assumptions have already been tested and found false.
3. **Re-audit when the trust boundary moves** — a new public endpoint, a new RLS
   policy, a new role, a new third-party integration, or anything that touches
   `auth`, `service_role`, or a `WITH CHECK`.
4. **Update [Standing assumptions](#standing-assumptions) whenever a fix depends
   on something staying true.** That section is the regression checklist; if a
   future change violates a line in it, the fix above it is silently undone.

Severity: **Critical** = data breach, account takeover, financial loss or
unbounded cost is possible *right now* with no special access.

---

## Status at a glance

Last full audit: **2026-08-06**. Scope: all 27 route handlers, all 20 migrations,
secrets, headers and injection surfaces, repo-wide.

Remediation pass **2026-08-07** closed the seven findings that remained. Every
open item from the audit is now closed; `npm audit` reports **0 vulnerabilities**.

| Severity | Open | Closed |
|---|---|---|
| Critical | 0 | 2 |
| High | 0 | 4 |
| Medium | 0 | 8 |
| Low | 0 | 4 |

Two caveats on "0 open", because the number is easy to over-read:

- **These are code findings.** [Owner-only actions](#owner-only-actions) are
  still outstanding and one of them — custom SMTP — is a launch blocker.
- **M7's CSP was verified by curl, not by a browser.** The policy is correct by
  construction for every origin the app uses, but nobody has yet loaded the map
  or the embedded widget with it enforced. See the note under M7.

**Not covered by that audit:** server/client components outside `src/app/api`
(swept for injection sinks, not individually audited for data access), and all
infrastructure — see [Owner-only actions](#owner-only-actions).

---

## Open findings

None. The seven that remained after the 2026-08-06 audit were closed on
2026-08-07 — see [Closed findings](#closed-findings) for each, and the caveats
under [Status at a glance](#status-at-a-glance) for what "none" does *not* mean.

---

## Closed findings

### H4 — Dependency vulnerabilities (12 → 0)
**High · closed 2026-08-07 · no migration**

`npm audit --omit=dev` reported 12 (9 high). Three separate causes, three fixes:

- **`xlsx` (SheetJS)** — prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS
  (GHSA-5pgg-2g8v-p4x9), parsing attacker-supplied files in the import route.
  **No fix exists on npm**: the maintainers moved distribution to their own
  registry, so the published package is permanently stale. **Resolved by
  dropping the format** — `/api/import` is CSV-only via papaparse (already a
  dependency) and `xlsx` is uninstalled. Considered and rejected: pinning the
  vendor tarball from `cdn.sheetjs.com` (makes CI depend on a non-npm URL and
  takes the package out of `npm audit`'s view entirely) and swapping to
  `read-excel-file` (maintained, but keeps a spreadsheet parser on the untrusted
  path for a format staff can trivially export away from).
  **Product consequence:** staff with .xlsx schedules must Save As → CSV first.
  The uploader, the import page copy and the API error message all say so.
- **`shadcn`** — a dev-time scaffolding CLI sitting in `dependencies`, dragging
  `@modelcontextprotocol/sdk`, `hono`, `@hono/node-server`, `ts-morph`,
  `fast-uri` and `brace-expansion` into the production tree and contributing 4
  advisories. Nothing imports it (`components.json` is config, not a runtime
  dep). Moved to `devDependencies`, along with the type-only `@types/mapbox-gl`
  and `@types/papaparse`.
- **`postcss`** (4 high) and **`sharp`/libvips** (4 CVEs) — transitive via
  `next`. Resolved by `next` 16.2.10 → **16.3.0** (and `eslint-config-next` to
  match). A trailing `nanoid` advisory under the new postcss cleared with
  `npm audit fix`.

**Verified:** `npm audit` and `npm audit --omit=dev` both report **0
vulnerabilities**. `tsc --noEmit`, `eslint src` and `next build` all pass on
16.3.0, and the build output still shows `◐` (Partial Prerender) on every
dashboard route — the Next bump did not silently cost the PPR work in `aad5c3f`.

### M7 — No CSP, no HSTS
**Medium · closed 2026-08-07 · no migration**

`next.config.ts` set `X-Frame-Options`, `nosniff`, `Referrer-Policy` and
`Permissions-Policy` but no `Content-Security-Policy` and no
`Strict-Transport-Security`.

**Fixed by** a `contentSecurityPolicy(frameAncestors)` helper in
`next.config.ts`, applied twice: `'self'` for the app, `*` for `/widget/:path*`
so embedding still works. HSTS (`max-age=63072000; includeSubDomains`, no
`preload`) goes on a separate `/(.*)` block. `X-Frame-Options: ALLOWALL` was
deleted rather than corrected — it is not a value in the spec, browsers ignored
it, and omitting the header is what actually permits framing.

**The `script-src` compromise is deliberate and is the main thing to know here.**
It carries `'unsafe-inline'` rather than a nonce because nonces require
per-request rendering, and Next's own docs state PPR is incompatible with
nonce-based CSP — adopting them would undo `aad5c3f` wholesale. The policy still
blocks unlisted script origins, plugin embeds (`object-src 'none'`), base-tag
injection (`base-uri 'self'`) and form exfiltration (`form-action 'self'`).
Tightening further means experimental `sri` or giving up PPR.

**Verified** against `next start`: the app group returns `frame-ancestors
'self'`, `/widget/*` returns `frame-ancestors *`, HSTS appears on all three route
groups including `/embed`, and exactly **one** `Content-Security-Policy` header
is emitted (two matching blocks would make browsers enforce the *intersection*
of duplicates — a policy nobody wrote). Mapbox compatibility was verified by
inspecting `mapbox-gl`: it builds its tile worker via
`URL.createObjectURL(new Blob(...))`, which `worker-src blob:` covers, and the
only origins in its bundle are `api.mapbox.com` and `events.mapbox.com`, both
allowlisted.

> **Still to do:** load `/search` (Mapbox) and an embedded widget in a real
> browser with the policy enforced and confirm a clean console. curl proves the
> headers; only a browser proves nothing is blocked. This was attempted but the
> Chrome extension was not connected.

**Deployment trap:** `frame-src 'self'` assumes `NEXT_PUBLIC_APP_URL` matches the
origin serving the page. On a preview deployment pointed at the production
domain it does not, and the widget preview pane in `/dashboard/widget` silently
goes blank.

### M8 — No privacy policy, terms, or cookie consent
**Medium · closed 2026-08-07 · no migration**

**Fixed by** `/privacy` and `/terms` under `src/app/(public)/`, sharing
`src/components/legal/LegalDocument.tsx`. Linked from a new Legal column in the
public footer and from the signup form, whose "you agree to our Terms of Service
and Privacy Policy" line was previously plain text pointing nowhere.

Both were drafted **from the schema, not from a template** — the data inventory
matches `001_initial_schema.sql` and `005_analytics_tables.sql`, and the
processor table matches the origins allowlisted in the CSP. If either changes,
these pages are wrong until updated.

**Finding corrected while fixing it:** the audit called for cookie consent. The
app sets *only* Supabase auth session cookies and uses no `localStorage` or
`sessionStorage` anywhere (verified by grep) — no analytics, advertising or
profiling cookies exist. Strictly-necessary cookies do not require consent under
GDPR, so **no banner is needed**; the policy discloses them instead. Adding a
banner would have been cargo-culting.

**Verified:** both routes return 200 and prerender as static, titles resolve
through the root `%s | Dropin` template, and the footer links appear in the
served HTML.

> **Not launch-ready without you.** Both documents need review by a qualified
> lawyer, and the facts only you can supply — legal entity name, jurisdiction,
> contact address, retention periods — render as visible amber
> `[placeholders]` so an unreviewed document cannot quietly go live looking
> finished. Search for `<Placeholder>` in both files.

### L1 — Raw Postgres errors returned to clients
**Low · closed 2026-08-07 · no migration**

`facility-maps/[id]/hotspots/route.ts` interpolated `error.message` into two
response bodies. Both already logged the real error server-side, so the
interpolation was pure leak and was simply removed.

**Scope was larger than the audit recorded:**
`facility-maps/[id]/context-elements/route.ts` had the identical pattern in two
more places. Fixed there too. A repo-wide grep now finds no remaining
`error.message` in any response body; the surviving matches are a server-side
log, a regex test in the signup route, and thrown `Error`s in the Stripe webhook
whose only caller is Stripe.

### L2 — `PATCH /api/sessions/[sessionId]` role check
**Low · closed 2026-08-07 · no code change**

Resolved as **working as intended — no check should be added.** The audit read
this as inconsistent with sibling routes, but the inconsistency runs the other
way: `POST /api/sessions` has the same membership-only check, and `001_initial_
schema.sql:60` defines `member` as "read + schedule editing only". Migration
`024` (H3) deliberately left `sessions`, `session_exceptions` and
`session_spaces` member-writable at the RLS layer for exactly that reason while
narrowing every *structural* table to `org_can_manage()`.

Drag-to-reschedule is schedule editing. Adding `owner|admin` here would have
contradicted both the role model and the RLS layer, and would have broken
members' documented ability to edit schedules. The gap was documentation, so the
route now carries a comment saying this and pointing here.

### L3 — Import row cap enforced after parsing
**Low · closed 2026-08-07 · no migration**

`MAX_ROWS` was checked only after the file was fully parsed, so a compressed
spreadsheet paid its whole expansion cost before rejection.

**Fixed by** stopping the reader early instead: papaparse gets
`preview: MAX_ROWS + 1` (one past the cap, so "exactly at the cap" is still
distinguishable from "over it"). The xlsx branch that motivated the finding —
compressed input was the whole concern — no longer exists (H4).

**Second hole found while fixing it:** `POST /api/import/commit` took
`rows: z.array(z.any())` with **no cap at all**, so the limit could be skipped
entirely by posting JSON directly, and it *trusted the client's own `_errors`
array* — posting `_errors: []` wrote a row that had never been validated. The
schema now caps at `MAX_ROWS`, and validation is recomputed server-side via the
shared `validateRow` rather than believed. `validateRow` and the row types moved
to `src/lib/import/rows.ts` so both routes share one implementation without a
route file exporting runtime code.

### L4 — `.single()` on `org_memberships` breaks multi-org users
**Low · closed 2026-08-07 · no migration**

18 call sites across 17 route files used `.single()`, which returns PGRST116
rather than a row for *any* user in more than one org — surfacing as a 403 to a
legitimate member.

**Fixed by** `src/lib/auth/membership.ts` (`getRouteMembership`,
`getAuthedMembership`), which orders by `joined_at` and takes the first — the
same "active org" rule `getOrgContext()` already used for Server Components.
Twelve files carried a byte-identical local `getMembership` helper (confirmed by
hashing each block) and now import the shared one; the rest were inline. A
leftover `as unknown as` cast in `stripe/create-portal` disappeared with it,
since the helper is typed.

**Standing requirement:** `getRouteMembership` and `getOrgContext` must keep the
same ordering. If a page renders org A's data while its own mutation routes
resolve to org B, saves land silently in the wrong org. Recorded in
[Standing assumptions](#standing-assumptions).

**Not an org switcher.** A real one needs the active org held in the session
rather than derived. This makes multi-org users work instead of 403, and puts
the choice in one place for when a switcher does land.

**Verified:** a repo-wide grep finds no remaining `.single()` on
`org_memberships`; `tsc`, `eslint` and `next build` pass.

### C1 — Any authenticated user could become platform superadmin
**Critical · closed 2026-08-06 · migration `022` · commit `aca0c3d`**

`public.is_superadmin()` read `auth.users.raw_user_meta_data` — the column behind
Supabase's `user_metadata`, which **the user writes themselves** via
`auth.updateUser()`. One browser-console call granted unrestricted read/write
across every tenant, through the 15 `FOR ALL USING (is_superadmin())` policies.
`src/proxy.ts:53` had the same flaw gating `/admin`.

Migration `002`'s comment claimed superadmin was "set via service role client
only — never via UI." That was an assumption about how the value would be
written, not a constraint on who could write it.

**Fixed by** reading `raw_app_meta_data` (service-role writable only) in both the
SQL function and `src/proxy.ts`.

**Verified** against the live DB: the escalation was actually executed
(`user_metadata.role='superadmin'` confirmed written back via the Admin API) and
still granted nothing — 0 invitations and 0 subscriptions visible. A **positive
control** granting genuine `app_metadata` superadmin returned the planted
invitation, proving the result was a real signal and not an always-empty query.

### C2 — All pending invitation tokens and staff emails were world-readable
**Critical · closed 2026-08-06 · migration `023` · commit `aca0c3d`**

`invitations_public_read_by_token` was
`USING (accepted_at IS NULL AND expires_at > NOW())`. The name says *by_token*;
the predicate has none. An RLS `USING` clause is evaluated per row against the
session, so it cannot express "only if you supplied the secret" — filtering
client-side narrows the *response*, not the *grant*. Anonymous callers could read
every pending invitation platform-wide, `token` and `email` included.

**Fixed by** dropping the policy. `invitations_admin_all` and
`invitations_superadmin_all` remain, so staff management is unaffected.

**Verified** by planting a real invitation with the service role and confirming
an anonymous client still saw zero rows. (The first attempt returned `[]` against
an empty table, which proved nothing — hence the planted row.)

**When the accept flow is built**, do not re-add a public SELECT policy. Use the
`SECURITY DEFINER` lookup documented in migration `023`, which takes the token as
an argument and returns neither token nor email.

### H1 — No rate limiting existed anywhere
**High · closed 2026-08-06 · migration `025` · commit `aca0c3d`**

Zero rate-limit code and no Redis/Upstash dependency. The comment in
`analytics/track/route.ts` claiming edge limiting was aspirational, and the Proxy
matcher excludes `/api` entirely.

**Fixed by** a Postgres-backed `rate_limits` table plus an atomic
`check_rate_limit()`, wrapped by `src/lib/rate-limit.ts`:

| Endpoint | Limit | Keyed on |
|---|---|---|
| `/api/auth/signup` | 5 / 10 min | IP |
| `/api/analytics/track` | 60 / min | IP |
| `/api/stripe/create-checkout` | 10 / 5 min | user id |
| `/api/import` | 10 / 5 min | user id |

Postgres rather than Upstash so the fix went live on migration rather than
waiting on a new vendor; `src/lib/rate-limit.ts` is a single seam to swap behind
if `/api/analytics/track` ever gets hot. **Fails open** by design — a limiter that
takes the site down when it breaks is worse than the abuse it prevents.

**Verified** live: `check_rate_limit` returned `[true, true, true, false]` at
limit 3.

> **Login is not covered and cannot be from this codebase.** `LoginForm.tsx:24`
> calls `supabase.auth.signInWithPassword()` directly from the browser, so the
> request never reaches this app. See [Owner-only actions](#owner-only-actions).

### H2 — Anyone could write unlimited rows to `analytics_events`
**High · closed 2026-08-06 · migration `025` · commit `aca0c3d`**

`analytics_public_insert` was `WITH CHECK (TRUE)` — anonymous inserts straight
into PostgREST with any `org_id`, bypassing the API route entirely, so
route-level rate limiting could never have closed it.

**Fixed by** dropping the policy. It was unnecessary: `/api/analytics/track`
inserts with the service-role client, which bypasses RLS. Nothing in the app ever
inserted analytics as anon.

**Verified** live: anonymous insert now returns
`42501 new row violates row-level security policy`.

### M3 — Stripe webhook silently dropped paid customers' entitlements
**Medium · closed 2026-08-06 · commit pending · no migration needed**

Four separate silent-failure paths in `src/app/api/stripe/webhook/route.ts`, all
ending the same way: HTTP 200 with no entitlement written.

1. **Receipt was conflated with success.** The `stripe_events` row was inserted
   *before* `handleEvent` ran, and a throwing handler was caught, logged and
   answered with 200. Stripe saw success and never retried — while the
   idempotency check now matched the existing row, so any redelivery returned
   `{skipped:true}`. The entitlement was unrecoverable without manual repair.
2. **`getPlanTierFromPriceId(priceId) ?? "free"`** silently downgraded a paying
   customer whenever a price ID was unrecognised. Not hypothetical: `PLANS`
   reads `stripePriceId` from `STRIPE_PRICE_PRO_MONTHLY` /
   `STRIPE_PRICE_ENTERPRISE_MONTHLY`, so a missing env var in any environment
   maps *every* paid subscription to `null` → `"free"`.
3. **`subscriptions.upsert()` and `.update()` were unchecked.** A failed write
   returned 200 having written nothing.
4. **The `stripe_events` insert was unchecked**, so two concurrent deliveries
   could both pass the pre-check and both process.

**Fixed by** treating the insert as a *claim*: `processed` stays false until the
handler succeeds. On conflict the handler skips only if `processed = true`,
otherwise it falls through and retries. Handler failure returns 500 so Stripe
retries with backoff. Unknown prices and failed writes now throw instead of
degrading. The `processed` column (`004_stripe_tables.sql:44`) was already there
and unused.

**Verified** end-to-end against the live DB with genuinely HMAC-signed payloads
posted over HTTP — every assertion reads the database back, per the standing rule
that a 200 is not evidence:

| Check | Result |
|---|---|
| Valid event writes entitlement and marks processed | `plan_tier=pro`, `processed=true` |
| Replay of a completed event | `200 {skipped:true}` |
| Unknown price | `500`, `processed=false`, `plan_tier` stays `pro` (old code wrote `free`) |
| **Retry of a failed event** | `500`, reprocessed — **old code returned `200 skipped` here** |
| Failed event succeeds on later redelivery | `200`, `processed=true` |
| Forged signature | `400`, never recorded |

> Same failure class as the API-version drift incident — see
> `feedback_stripe_api_version_drift`.

### M1 + M2 — Two over-broad public read policies
**Medium ×2 · closed 2026-08-06 · migration `026` · commit pending**

**M2** — `orgs_public_read_active` was
`USING (status = 'active' OR id = ANY(user_org_ids()) OR is_superadmin())`.
RLS is row-level, never column-level, so "anyone may read active orgs" meant
anyone may read *every column*: `email`, `phone`, `address_line1`,
`postal_code`, and `stripe_customer_id`.

Confirmed live before the fix — an anonymous client read a real
`stripe_customer_id` straight out of the table.

Column `GRANT`s cannot fix this: they are per database *role*, and an org member
is the same `authenticated` role as any other logged-in user, so a grant wide
enough for a member to read their own billing details is wide enough for a
stranger to read everyone's. The fix is a **projection, not a policy tweak**.

- Base table → members and superadmins only (`orgs_members_read`).
- New `public.organizations_public` view exposing `id, name, slug, description,
  logo_url, website_url, city, province, country` for active orgs, granted to
  `anon` and `authenticated`.
- `src/app/widget/[orgId]/page.tsx` — the *only* anonymous reader of
  `organizations` in the app (verified by sweeping every call site) — now reads
  the view.

The view is deliberately a **definer** view (`security_invoker = false`): it
intentionally bypasses the members-only policy, and its `WHERE` clause plus its
column list *are* the access control. Anything added to that SELECT list becomes
world-readable.

**M1** — `widget_configs_public_read` was literally `USING (TRUE)`. Now split
into a members-read policy (own org, any publish state — the dashboard editor
needs drafts) and a public policy that only exposes configs whose facility and
department are actually published. The colours were never the issue; the leak
was `facility_id`/`department_id` for **unpublished** content. Bare `org_id` is
not a leak — widget embeds are addressed as `/widget/[orgId]`.

**Verified** against the live DB, before and after:

| Check | Before | After |
|---|---|---|
| anon reads org contact/billing columns | **2 rows incl. `stripe_customer_id`** | 0 rows |
| `organizations_public` serves id/name/slug | n/a | 1 row |
| view exposes `email` / `stripe_customer_id` | n/a | rejected — column does not exist |
| anon reads config for an **unpublished** facility | **1 row** | 0 rows |
| anon reads config for a **published** facility | 1 row | 1 row (widget still works) |

**Regression-checked**, because this policy is on the dashboard's hot path:

| Check | Result |
|---|---|
| `getOrgContext()`'s `organizations!inner(*, subscriptions(*))` embed | works |
| Member reads their **own** org's `email`/`phone` | works |
| Member reads **another** org's row on the base table | 0 rows |
| Member discovers other orgs via the view | works |
| `/widget/[orgId]` renders for a real org | HTTP 200, org name present |

### M4 + M5 — Account enumeration, and signup with an address you don't own
**Medium ×2 · closed 2026-08-06 · commit pending · no migration needed**

Both lived in `src/app/api/auth/signup/route.ts` and shared one root cause: the
route created accounts with `admin.auth.admin.createUser({ email_confirm: true })`.

- **M5.** That call **overrode the project's own setting.** `/auth/v1/settings`
  reports `mailer_autoconfirm: false` — Supabase was configured to require
  verification all along, and the app was bypassing it, marking every address
  confirmed without checking it. Anyone could register an organization under
  someone else's email and get a working login.
- **M4.** The admin path errors on duplicates, so the route answered
  **409 "An account with that email already exists"**, making registered
  addresses enumerable. Org-name collisions leaked identically.

**Fixed by** switching to the ordinary `supabase.auth.signUp()` flow, which
honours `mailer_autoconfirm` and sends a confirmation email. Organization
creation moved out of signup to `/dashboard/org/onboarding` (existing screen,
existing `/api/auth/onboard-org`), so nothing is created until the address is
proven. The org name rides along in `user_metadata` purely to prefill that form —
user-writable, so treated as untrusted and re-validated on submit.

**The subtle part, and the reason a first attempt failed.** Surfacing *any*
Supabase-side error reopens enumeration in inverted form. A new address triggers
an email; an existing one does not. So when the mailer errors, the new address
fails and the existing one succeeds — error means "free", success means "taken".
An attacker induces it at will by exhausting the send quota. This was not
theoretical: the first version of the fix was measured doing exactly that
(`fresh=429`, `existing=200`). The handler now returns an **identical body and
status in every case** and logs failures server-side instead. The 429 from our
own IP-keyed rate limiter is fine — it fires regardless of whether the address
exists, so it is not an oracle.

Related hardening in the same path: `/api/auth/onboard-org` gained its own rate
limit (org creation moved there, so signup's limit no longer covered it), and
`/(auth)/callback` now rejects non-relative `next` values — that parameter is
attacker-supplied and is now part of the emailed confirmation link.

**Verified** against a running server and the live DB:

| Check | Result |
|---|---|
| Existing address returns same **status** as fresh | `200` vs `200` (was `409` vs `200`) |
| Existing address returns same **body** as fresh | byte-identical |
| Response contains no existence wording | confirmed |
| Duplicate **org name** no longer leaks | identical `200` |
| No organization created pre-confirmation | 0 rows |
| Unconfirmed account cannot sign in | `Email not confirmed`, no session |
| Positive control: same account after confirming | signs in — proves the block is the confirmation state, not the credentials |

**Not verified:** that `signUp` produces an unconfirmed *user row*, because the
default Supabase mailer quota (~2/hour without custom SMTP) was exhausted and no
user is created when the send fails. Inferred from `mailer_autoconfirm: false`
plus the removal of every `createUser` call. Re-run after SMTP is configured.

> ⚠️ **Operational consequence.** Signup now depends on email delivery. With the
> built-in mailer that is roughly **two accounts per hour** — previously
> invisible, because auto-confirm meant no mail was sent at all. **Custom SMTP is
> now a launch blocker,** not a nice-to-have. See
> [Owner-only actions](#owner-only-actions).

### M6 — Analytics IP salt fell back to a public constant
**Medium · closed 2026-08-06 · commit pending · no migration needed**

`src/app/api/analytics/track/route.ts` read
`process.env.ANALYTICS_IP_SALT ?? "dropin-default-salt"`. The date component of
the hash is public, so that env var *is* the entire secret. Missing in an
environment, every visitor IP hash became reproducible across the whole IPv4
space in minutes — the "we store no raw PII" guarantee failing with no symptom.

**Fixed as part of a wider fail-fast pass** on environment configuration, since
this was the same shape as M3: degrade quietly rather than fail loudly.

- **`src/lib/env.ts`** — `requireEnv()` throws instead of defaulting;
  `validateServerEnv()` checks all eight required server variables and reports
  *every* missing one in a single error. Reporting them one at a time is how
  people end up setting a variable in Preview and missing Production.
- **`src/instrumentation.ts`** — Next calls `register()` once per server
  instance, before any request is served, so a misconfigured deployment refuses
  to boot. Deliberately **not** validated at module load: that would make
  `next build` require production secrets, breaking contributors and CI for no
  security gain. A failed boot is the loud signal; a build that needs live Stripe
  keys is not.
- Guarded to `NEXT_RUNTIME === "nodejs"` — the Proxy runs on Edge, where these
  secrets are neither present nor needed.

**Also hardened alongside it** (the config half of M3): Stripe price IDs moved
out of `plans.ts` into server-only `src/lib/stripe/prices.ts`. `plans.ts` is
imported by `BillingClient.tsx`, a **client component**, so it ships to the
browser where non-`NEXT_PUBLIC_` vars are `undefined` — the price IDs were
silently `null` in the bundle, harmless only because nothing client-side read
them. The split makes that structural rather than incidental. `create-checkout`
now throws (500) instead of returning 400 *"This plan is not available for
checkout"*, which made a broken deployment look like a deliberate product state.

**Verified:**
- Unit: complete env passes; a missing var is rejected; a whitespace-only value
  is rejected; three missing vars are reported in one error; `requireEnv` names
  what breaks.
- **Boot:** with `ANALYTICS_IP_SALT` blanked, `next dev` logged
  `An error occurred while loading instrumentation hook: Server startup aborted…`
  and the port **actively refused connections**. Restored and re-verified
  byte-identical afterwards.
- Live Stripe API: both price IDs resolve to active prices at 49.00 / 199.00 CAD
  monthly, matching `plans.ts`. (Test mode — **production needs live price IDs,
  which are different strings.** See [Owner-only actions](#owner-only-actions).)

### H3 — The `member` role had full CRUD on every structural table
**High · closed 2026-08-06 · migration `024` · commit `aca0c3d`**

Every resource table carried `FOR ALL USING (org_id = ANY(user_org_ids()))` with
no role predicate, contradicting `001_initial_schema.sql:60` ("member: read +
schedule editing only"). The API routes check `owner|admin`, but the publishable
key is in the browser — a member calls PostgREST directly and the API is simply
not in the path.

**Fixed by** `public.org_can_manage()` and narrowing structural tables to
`owner|admin`. Member SELECT survives via each table's existing `*_public_read_*`
policy; `session_templates` and `session_template_spaces` had none, so they got
explicit member-read policies. `sessions`, `session_exceptions` and
`session_spaces` are **deliberately unchanged** — that is the schedule editing the
role model grants members.

**Verified** live with a real `member`-role user: `UPDATE` and `DELETE` on
`facilities` both affected 0 rows, while `session_templates` reads still worked.

**Behaviour change:** `src/components/schedule-group/ScheduleGroupForm.tsx:156-160`
writes `schedule_groups` directly from the browser — the app's only direct client
write. A `member` using that form now gets a save failure, surfaced as a generic
error rather than a permission message. Worth improving if non-admin staff are
ever onboarded.

---

## Standing assumptions

These must stay true or a closed finding silently reopens. Treat a PR that
violates one as a security regression.

1. **`is_superadmin()` reads `raw_app_meta_data`, never `raw_user_meta_data`.**
   `user_metadata` is user-writable. The same applies to `src/proxy.ts` and any
   future admin gate. *(C1)*
2. **No RLS policy grants anonymous SELECT on `staff_invitations`.** A token
   cannot be checked in a `USING` clause. *(C2)*
3. **Structural writes go through `org_can_manage()`; only
   `sessions` / `session_exceptions` / `session_spaces` are member-writable.** *(H3)*
4. **`analytics_events` has no anonymous INSERT policy.** The service-role route
   is the only write path. *(H2)*
5. **New public or paid endpoints call `checkRateLimit()`.** The Proxy matcher
   excludes `/api`, so nothing guards a route by default. *(H1)*
6. **The service-role key stays in `src/lib/supabase/admin.ts` and route handlers
   only.** Never a client component, never a `NEXT_PUBLIC_` variable.
7. **`subscriptions` has no client-side INSERT/UPDATE/DELETE policy.** Entitlements
   are written only by the Stripe webhook via service role. This is what makes the
   usage-limit bypass class impossible — do not add a write policy for convenience.
8. **Stripe webhooks verify the signature against the raw, unparsed body** before
   any processing.
9. **Prices and plan tiers come from `src/lib/stripe/plans.ts`**, never from client
   input.
10. **The `stripe_events` insert is a claim, not a completion.** `processed` flips
    to true only after the handler succeeds; a failed handler returns non-2xx so
    Stripe retries. Every webhook handler must therefore stay idempotent, and no
    handler may degrade to a default on unrecognised input — throw instead. *(M3)*
11. **`.env.local` stays gitignored.** Only `.env.example`, with placeholders.
12. **No `process.env.X ?? fallback` for anything security-relevant.** A default
    that is merely *plausible* produces a wrong app rather than a stopped one.
    Add the variable to `REQUIRED_SERVER_ENV` in `src/lib/env.ts` and read it via
    `requireEnv()`. *(M6)*
13. **`src/lib/stripe/plans.ts` stays free of secrets** — it is imported by a
    client component. Anything env-derived belongs in `src/lib/stripe/prices.ts`.
    *(M6)*
14. **`/api/auth/signup` returns an identical status and body in every outcome.**
    Never surface a Supabase-side error from it. A new address sends mail and an
    existing one does not, so any error that reaches the caller is an inverted
    existence oracle. Log server-side instead. *(M4)*
15. **Signup never auto-confirms.** No `email_confirm: true`, no
    `admin.createUser` on the signup path, and `mailer_autoconfirm` stays off.
    Organizations are created only after confirmation. *(M5)*
16. **`/(auth)/callback` only redirects to same-origin relative paths.** `next`
    is attacker-supplied and now appears in emailed links.
17. **The `organizations` table is members-only; anonymous discovery goes through
    `organizations_public`.** That view is a definer view with no row-level
    protection beyond its own `WHERE status = 'active'`, so **every column added
    to it becomes world-readable**. Never put contact or billing fields there.
    *(M2)*
18. **No RLS policy uses `USING (TRUE)`.** If a table needs public reads, tie
    them to a publish flag or an owning row, not to nothing. *(M1)*
19. **`getRouteMembership()` and `getOrgContext()` resolve to the same org.**
    Both take the earliest membership by `joined_at`. If they ever disagree, a
    page renders one org's data while its own mutation routes write to another,
    and saves land silently in the wrong tenant. Change both or neither. *(L4)*
20. **Route handlers do not query `org_memberships` directly.** Use the helpers
    in `src/lib/auth/membership.ts`. A new inline `.single()` re-introduces the
    403-for-multi-org-users bug one route at a time. *(L4)*
21. **The import path never gains a spreadsheet parser again** without a
    deliberate decision. `xlsx` was removed because it parses untrusted input
    and has no patched npm release; CSV via papaparse is the whole supported
    surface. *(H4)*
22. **Exactly one `Content-Security-Policy` header is emitted per response.**
    Browsers enforce the intersection of duplicate CSP headers, which silently
    produces a policy nobody wrote. Only `/widget/:path*` and the catch-all app
    block may set it, and they must stay disjoint. *(M7)*
23. **`shadcn` stays in `devDependencies`.** It is a scaffolding CLI; in
    `dependencies` it pulls an MCP SDK and an HTTP server into production. *(H4)*
24. **`org-media` keeps its `allowed_mime_types` raster-only — never `image/svg+xml`.**
    SVG is a script-bearing document format, and Storage is served from
    `*.supabase.co`, which this app's own CSP trusts in `img-src`. An uploaded
    SVG opened directly executes against the Storage origin. *(Storage, 030)*
25. **Every `org-media` write policy keys off `public.org_media_org_id(name)`,
    which returns NULL rather than raising on a malformed path.** A bare
    `::UUID` cast inside a policy turns a junk path into a 500 instead of a
    denial, and lets a caller distinguish "rejected" from "malformed". *(Storage, 030)*
26. **`org-media` writes stay folder-scoped: `events`/`brochure` member-writable,
    `facilities`/`schedules`/`org` via `org_can_manage()`.** This is assumption 3
    applied to images; widening it to one role for the whole bucket reopens H3
    for uploads. *(Storage, 030)*

---

## Storage: what the `org-media` bucket does and does not protect

Added by migration `030`. Recorded here because it is the first place this app
serves user-supplied files, and because one property of it is a deliberate
accepted risk rather than a control.

**The bucket is public-read.** Any object in it is readable by anyone holding
its URL — including an image attached to a facility or schedule group that has
not been published. Paths carry a random UUID filename and no listing is
exposed, so objects are not enumerable, but that is unguessability, not
authorization.

This was chosen over private-plus-signed-URLs because these assets are facility
photos, event pictures and brochure covers whose purpose is to be shown to the
public, and because signed URLs expire — a widget embedded on a third-party page
would serve images that rot, and every render would need a round trip to
re-sign. `next.config.ts` and the CSP were already written for the public shape.

**Consequences to hold in mind:**

- Nothing sensitive belongs in this bucket. There is no per-object publish gate.
- Deleting a record does not delete its images. See the orphan-sweep note in
  `src/components/media/README.md`.
- Uploading is authorized entirely by storage RLS, because the browser uploads
  directly. There is no route handler in the path to add a check to — if a new
  folder kind is introduced, it needs a policy in a migration or it silently
  denies (safe) or falls under an existing predicate (not necessarily safe).

**Verified** against the live bucket with two real users, an admin and a member:
member can write `events/` and `brochure/` but not `facilities/`; admin can;
neither can write into another org's folder; anonymous cannot write at all; SVG,
`text/plain` and a 6 MB file are all rejected for an authorized user; malformed
and unknown-kind paths deny without a database error; public read returns the
actual bytes with the right content type. 19 assertions, 0 failures.

---

## Owner-only actions

Not fixable from the codebase. Unticked items are outstanding.

- [ ] **⚠️ Configure custom SMTP** (Supabase dashboard → Project Settings → Auth →
      SMTP), e.g. Resend. **Launch blocker since M4/M5**: signup now sends a
      confirmation email, and the built-in mailer allows only ~2 per hour, so
      real signups will silently fail beyond that. Note `.env.example` references
      `RESEND_FROM_EMAIL` but `resend` is not installed — Supabase-side SMTP
      config needs no app dependency.
- [ ] **Login rate limiting** — Supabase dashboard → Authentication → Rate Limits.
      Cannot be done in app code *(see H1)*.
- [ ] Keep `mailer_autoconfirm` **disabled**. Turning it on re-opens M5 —
      accounts would again be usable without proving address ownership.
- [ ] Confirm hosting provider; enable WAF / DDoS protection in front of autoscaling
- [ ] Spend caps and budget alerts: Vercel, Supabase, Stripe, Mapbox
- [ ] Restrict `NEXT_PUBLIC_MAPBOX_TOKEN` to your domains in the Mapbox console
- [ ] **Confirm all eight required vars are set in Production**, not just Preview.
      Since M6 the server refuses to boot without them, so a missing one is now a
      failed deployment rather than a silent defect — check before deploying.
- [ ] **Set *live-mode* `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_ENTERPRISE_MONTHLY`
      in production.** The local values are test-mode price IDs; live mode uses
      different strings. Verify with Stripe dashboard in Live mode, or by clicking
      Upgrade on the deployed site.
- [ ] Verify Supabase PITR/backups are on, and run a restore test
- [ ] Enable `pg_cron` and schedule `sweep_rate_limits()` hourly (migration `025`)
- [ ] Review Supabase auth logs for any `updateUser` call setting a `role` field
      *(retroactive check for C1 exploitation)*
- [ ] Set up alerting: repeated auth failures, 4xx/5xx spikes, unusual per-user spend
- [ ] **Have `/privacy` and `/terms` reviewed by a lawyer, and fill in the
      `<Placeholder>` values** — legal entity name, jurisdiction, contact
      address, retention periods, liability cap. They render as visible amber
      highlights, so the pages are launch-blocking by construction *(M8)*.
- [ ] **Load `/search` and an embedded widget in a browser with the CSP live**
      and confirm a clean console. Headers are verified; runtime is not *(M7)*.

---

## Verifying against the live database

Migration files are not evidence — this project applies migrations manually, so
the files and the database can drift. Always check the database.

```sql
-- Full policy inventory
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies WHERE schemaname = 'public'
 ORDER BY tablename, policyname;

-- Confirm the C1 fix is actually live
SELECT prosrc FROM pg_proc WHERE proname = 'is_superadmin';
```

### Harness pattern that works

A Node script using the service-role client to create a temp org, a
**`member`**-role user, a facility and an invitation; run the real attacks; then
delete everything in a `finally` block. Three traps that produced *false green
results* the first time:

1. **`auth.updateUser()` needs `setSession()`, not just an `Authorization`
   header.** With only a header it fails `Auth session missing!`, the attack never
   fires, and the test passes vacuously.
2. **An empty result is not proof.** `[]` from an empty table looks identical to
   `[]` from a working policy. Plant a row first.
3. **Add a positive control, and run it last.** Granting genuine superadmin proves
   the "0 rows" signal is real — but run it before the member-restriction tests and
   those report false failures, because they are then measuring a superadmin.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-06 | First full audit. C1, C2, H1, H2, H3 closed (migrations `022`–`025`, commit `aca0c3d`), verified live. 13 findings remain open. |
| 2026-08-06 | M3 closed — Stripe webhook claim/commit semantics, plus three further silent-failure paths found while fixing it (unchecked `subscriptions` writes, unchecked event insert, `?? "free"` price fallback). Verified with signed payloads over HTTP. 12 open. |
| 2026-08-06 | M6 closed — fail-fast env validation at server boot (`src/lib/env.ts`, `src/instrumentation.ts`), Stripe price IDs split into server-only `prices.ts`. Verified by blanking a variable and confirming the server refuses to start. 11 open. |
| 2026-08-06 | M4 + M5 closed — signup moved to `auth.signUp()`, org creation deferred to post-confirmation onboarding, responses made uniform. A first attempt still leaked existence when the mailer errored; caught by measurement, then fixed. **Custom SMTP is now a launch blocker.** 9 open. |
| 2026-08-06 | M1 + M2 closed — migration `026`. `organizations` is members-only with a curated `organizations_public` view for discovery; `widget_configs` public reads tied to publish state. Live before/after confirmed a real `stripe_customer_id` was anon-readable and no longer is. 7 open. |
| 2026-08-07 | L1–L4 closed. Each turned out slightly different from its write-up: L1's leak also existed in `context-elements`; L2 was correct as written and needed documenting, not a role check; L3 revealed `/api/import/commit` had **no** row cap and trusted client-supplied `_errors`; L4 replaced 18 `.single()` sites with a shared helper. 3 open. |
| 2026-08-07 | M7 closed — CSP + HSTS in `next.config.ts`, invalid `X-Frame-Options: ALLOWALL` removed. `script-src` keeps `'unsafe-inline'` because nonces are incompatible with PPR; recorded as a deliberate ceiling. Verified by curl on all three route groups; browser verification still outstanding. 2 open. |
| 2026-08-07 | M8 closed — `/privacy` and `/terms` drafted from the schema, linked from footer and signup. Cookie-consent element of the finding dismissed: only strictly-necessary auth cookies exist, so no banner is required. Both documents need legal review before launch. 1 open. |
| 2026-08-07 | H4 closed — **`npm audit` now reports 0 vulnerabilities** (from 12). `xlsx` removed and imports restricted to CSV; `shadcn` moved out of `dependencies`, taking 4 advisories with it; `next` 16.2.10 → 16.3.0 cleared `postcss` and `sharp`. PPR confirmed intact after the bump. **0 open.** |
