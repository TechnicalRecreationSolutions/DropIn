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

| Severity | Open | Closed |
|---|---|---|
| Critical | 0 | 2 |
| High | 1 | 3 |
| Medium | 6 | 2 |
| Low | 4 | 0 |

**Not covered by that audit:** server/client components outside `src/app/api`
(swept for injection sinks, not individually audited for data access), and all
infrastructure — see [Owner-only actions](#owner-only-actions).

---

## Open findings

### H4 — Dependency vulnerabilities (11, 8 high)

`npm audit --omit=dev`. The one needing a decision rather than an upgrade:

- **`xlsx` (SheetJS)** — prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS
  (GHSA-5pgg-2g8v-p4x9). **No fix available on npm**; the maintainers moved
  distribution to their own registry, so the published package is stale. It
  parses attacker-supplied files at `src/app/api/import/route.ts:111`.
  Options: pin the vendor build from `cdn.sheetjs.com`, swap to a maintained
  reader, or restrict imports to CSV (papaparse) only.
- **`postcss`** (4 high) and **`sharp`/libvips** (4 CVEs) — both transitive via
  `next`; resolved by `next@16.3.0`, which is outside the current range.

### M1 — `widget_configs` is readable by anyone

`005_analytics_tables.sql` — `USING (TRUE)`. Anonymous callers can enumerate
every org's `org_id`, `facility_id` and `department_id`, **including unpublished
ones**. Low-sensitivity data, but it is a cross-tenant enumeration primitive that
feeds the other public endpoints. `GET /api/widget-config` already filters by
`orgId`, so the policy is broader than any caller needs.

### M2 — `organizations` exposes contact details and Stripe IDs to anon

`002_rls_policies.sql:56-58` — `USING (status = 'active' OR ...)` grants **all
columns**, including `email`, `phone`, `address_line1`, `postal_code` and
`stripe_customer_id` (added in `007`). Public discovery needs name/slug/city, not
the billing identifier. Needs a column-limited view or a narrowed policy.

### M4 — Account enumeration on signup

`src/app/api/auth/signup/route.ts` returns **409 "An account with that email
already exists"** versus 500/200 otherwise, so registered emails are
distinguishable. Org-name collisions leak the same way. Responses must be
identical in body and status regardless of existence.

### M5 — Email verification is disabled

`src/app/api/auth/signup/route.ts:47` — `email_confirm: true` marks every address
confirmed without checking it. Anyone can register an organization under someone
else's email.

### M7 — No CSP, no HSTS

`next.config.ts:54-69` sets `X-Frame-Options`, `nosniff`, `Referrer-Policy` and
`Permissions-Policy`, but no `Content-Security-Policy` and no
`Strict-Transport-Security` on the main route group. Also `X-Frame-Options:
ALLOWALL` (line 30) is not a valid header value and browsers ignore it — the
`frame-ancestors *` CSP beside it does carry the intent, so this is cosmetic.

### M8 — No privacy policy, terms, or cookie consent

No `privacy`, `terms`, `legal` or `cookie` route exists anywhere in `src/app`.
The app collects emails, hashed IPs and user agents. Required before launch in
both GDPR and CCPA terms, and the footer should link them.

### L1 — Raw Postgres errors returned to clients

`src/app/api/facility-maps/[id]/hotspots/route.ts:121,155` interpolate
`error.message` into the response body, leaking schema detail.

### L2 — `PATCH /api/sessions/[sessionId]` omits the role check its siblings have

`route.ts:36-42` verifies membership but not `owner|admin`. Intentional if
rescheduling counts as member-level schedule editing — but it is currently
undocumented and inconsistent with every neighbouring route. Decide and write it
down either way.

### L3 — Import row cap is enforced after parsing

`src/app/api/import/route.ts:128` checks `MAX_ROWS` only once the file is fully
parsed, so a 10 MB compressed spreadsheet pays its full expansion cost before
rejection. Rate limiting (H1) bounds how often this can be triggered but does not
bound the single-request cost.

### L4 — `.single()` on `org_memberships` breaks multi-org users

Every route uses `.single()`, which errors when a user belongs to more than one
org and surfaces as a 403. A correctness bug today, a support problem the first
time someone joins two organizations.

---

## Closed findings

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

---

## Owner-only actions

Not fixable from the codebase. Unticked items are outstanding.

- [ ] **Login rate limiting** — Supabase dashboard → Authentication → Rate Limits.
      Cannot be done in app code *(see H1)*.
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
