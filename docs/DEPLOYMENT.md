# Deployment

First deployment: Vercel + Supabase, 2026-08-07.

Work top to bottom. Each section depends on the one above it — there is no point
testing signup before the app boots, or Stripe before signup works.

---

## Status — 2026-08-07

**The app is live and healthy at `https://drop-in-ten.vercel.app`.** Remaining
work was deliberately deferred: there are no users yet, so feature work takes
priority over launch configuration. Nothing here degrades by waiting.

| Step | State |
|---|---|
| 1. Environment variables | **Done.** All 11 set for Production. |
| 2. Supabase auth URLs | **Done.** Site URL and Redirect URLs point at `drop-in-ten.vercel.app`. |
| 3. Custom SMTP | **Deferred** until the real Dropin domain exists — see below. |
| 4. Stripe webhook | **Not started.** Independent of everything else. |
| 5. Browser-verify CSP | **Headers verified in production**; in-browser render check still outstanding. |
| 6. Custom domain + raise HSTS | **Not started.** |

### Verified in production

Headers were checked live with `curl` against the deployed site:

- `/`, `/privacy`, `/terms`, `/login` — CSP with `frame-ancestors 'self'`,
  `X-Frame-Options: SAMEORIGIN`, HSTS, `nosniff`, `Referrer-Policy`
- `/widget/*` — `frame-ancestors *` and no `X-Frame-Options`, so embedding works
- `/embed/widget.js` — `nosniff`, cached, CORS open
- `/dashboard` — 307 to `/login`, so auth is enforced
- Exactly one CSP header per response
- No `localhost` or protected-alias URL baked into the built HTML

`Access-Control-Allow-Origin: *` appears on every route in production but is
**added by Vercel's CDN, not this app** — locally `/login` carries no such header
while `/widget` does, matching `next.config.ts` exactly, and there is no
`vercel.json`. Harmless: the CORS spec forbids pairing `*` with credentials, so
no cookie-bearing response can be read cross-origin.

### Three URLs exist. Only one is public.

| URL | Public? |
|---|---|
| `drop-in-ten.vercel.app` | **Yes — this is the one to use everywhere** |
| `drop-in-technical-recreation-solutions.vercel.app` | No — redirects to Vercel SSO |
| `drop-in-git-main-technical-recreation-solutions.vercel.app` | No — redirects to Vercel SSO |

The protected two are Vercel's team and git-branch aliases. Pointing anything at
them — `NEXT_PUBLIC_APP_URL`, a Supabase redirect, a Stripe webhook — produces a
login wall for users and machines alike. The Supabase Site URL was initially set
to the team alias for exactly this reason.

### The domain decision is now the bottleneck

Five separate things all point at the same address and change together:
`NEXT_PUBLIC_APP_URL`, the two Supabase auth URLs, the Stripe webhook endpoint,
the Resend sending domain, and raising `HSTS_MAX_AGE`. Deferring SMTP until the
domain exists avoids verifying a throwaway sending domain and replacing it later.

### Testing signup before SMTP

Supabase's built-in mailer allows ~2 sends/hour and generally only delivers to
addresses belonging to your Supabase organization. That is enough for a
one-off end-to-end test — sign up with the email tied to the Supabase account,
not an arbitrary address, or nothing arrives and a correct configuration looks
broken.

---

## Why this order

The app **refuses to start** if a required environment variable is missing
(`src/lib/env.ts`, validated from `src/instrumentation.ts`, added in `0030b2c`).
That is deliberate: a missing variable used to produce a *plausible but wrong*
app — paid customers silently on the free tier, visitor IP hashes silently
reversible — and a stopped deployment is the loud signal we want instead.

The practical consequence is that a missing variable looks like a failed
deployment, not a broken feature. Get section 1 right and most of the rest
follows.

---

## 1. Environment variables

### Required — the server will not boot without these

| Variable | What breaks if absent |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Every database call |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | All user-scoped queries |
| `SUPABASE_SERVICE_ROLE_KEY` | Signup, Stripe webhook, analytics, rate limiting |
| `STRIPE_SECRET_KEY` | Checkout and billing portal |
| `STRIPE_WEBHOOK_SECRET` | Webhook rejects every event; no subscription is ever recorded |
| `STRIPE_PRICE_PRO_MONTHLY` | Webhook cannot map a paid subscription to a tier |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY` | Same, for Enterprise |
| `ANALYTICS_IP_SALT` | IP hashes become trivially reversible — the "no raw PII" claim in the privacy policy fails |

### Also needed — not validated, so these fail quietly

| Variable | What breaks if absent or wrong |
|---|---|
| `NEXT_PUBLIC_APP_URL` | **Confirmation emails link nowhere.** See section 2. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Maps and address lookup |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side Stripe references |

### Two traps

**The Supabase integration's variable names may not match ours.** It injects
Supabase credentials automatically, but has historically named the anon key
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, while this codebase requires
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. If they differ, the first deploy fails
with a missing-variable error while the correct value sits right there under
another name. Check the injected names before debugging anything else.

**Generate a fresh `ANALYTICS_IP_SALT` for production.** Do not reuse the local
one. It is a per-deployment secret; sharing it across environments means a hash
from one is comparable to a hash from the other, which is the linkability the
salt exists to prevent.

### Verifying

A successful deploy is the test — the app cannot start with a required variable
missing. If it fails, the log names every missing variable at once rather than
one per attempt.

---

## 2. Supabase Auth URLs

Two separate things must agree, and neither is an environment variable:

1. **`NEXT_PUBLIC_APP_URL`** must be the real production URL. Confirmation
   emails are built from it — `src/app/api/auth/signup/route.ts` sends
   `${APP_URL}/callback?next=/dashboard/org/onboarding`.
2. **Supabase → Authentication → URL Configuration** must list that same URL as
   the Site URL, with the callback added to Redirect URLs. Supabase rejects
   redirects to URLs not on that list.

**This fails silently in both directions.** Signup is deliberately silent about
failures — the response is identical whether or not the address already exists,
which is what closes the account-enumeration hole (M4/M5). So a wrong URL
produces a user who is told to check their inbox, and nothing more. There is no
error to see.

**Test:** sign up with a real address, click the link in the email, and confirm
you land on the org onboarding page.

---

## 3. Custom SMTP — launch blocker

Supabase's built-in mailer allows roughly **two sends per hour**. Since `55c1aa1`
signup requires email confirmation, so beyond that limit real signups fail with
no visible error.

Supabase → Project Settings → Auth → SMTP. `.env.example` implies Resend via
`RESEND_FROM_EMAIL`; no application dependency is needed, this is Supabase-side
configuration.

**Until this is done, treat signup as demo-only.**

---

## 4. Stripe webhook

1. Create an endpoint in Stripe pointing at
   `https://<your-domain>/api/stripe/webhook`.
2. Set `STRIPE_WEBHOOK_SECRET` to **that endpoint's** signing secret. It is not
   the same as the Stripe CLI secret used locally. A mismatch means every event
   is rejected and no subscription is ever recorded — the exact failure class as
   finding M3.
3. In live mode, `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_ENTERPRISE_MONTHLY`
   are **different strings** from the test-mode IDs.

**Test:** complete a real checkout, then query the `subscriptions` table and
confirm a row exists with the right tier. A 200 response from the webhook is not
evidence — see the M3 write-up in `SECURITY.md` for why that specific mistake
was made once already.

---

## 5. Verify the CSP in a browser

`SECURITY.md` → M7 is closed on header evidence but was never confirmed against
a rendered page. With a live URL this is finally testable.

Load each of these and check the browser console is free of
`Content-Security-Policy` violations:

- `/search` — Mapbox. The riskiest one: mapbox-gl builds its tile worker from a
  `blob:` URL, which is why `worker-src blob:` is in the policy.
- A facility page with a map.
- The embedded widget, **framed on a different origin** — not just opened
  directly. Framing is the whole point of `frame-ancestors *` on `/widget`.
- `/dashboard/widget` — the preview pane. See the trap below.

**Known trap:** `frame-src 'self'` assumes `NEXT_PUBLIC_APP_URL` matches the
origin serving the page. On a preview deployment pointed at the production
domain they differ, and the widget preview pane silently goes blank while
everything else works.

---

## 6. Custom domain, then raise HSTS

`HSTS_MAX_AGE` in `next.config.ts` is currently **3600 (one hour)**, not the
production value.

HSTS is close to irreversible: once a browser sees the header for a host it
refuses plain HTTP for that host — and with `includeSubDomains`, for every
subdomain — until max-age expires, with no way to recall it. A two-year policy
published against a domain whose subdomains are not all HTTPS takes two years to
age out, per visitor.

**Raise to `63072000` once** the production domain is attached and every
subdomain you intend to use — marketing, docs, staging — serves HTTPS. Consider
`preload` only well after that; it bakes the domain into browser binaries and
removal takes months.

---

## Post-deploy checklist

Infrastructure items from `SECURITY.md` → Owner-only actions that only become
possible once deployed:

- [ ] Restrict `NEXT_PUBLIC_MAPBOX_TOKEN` to your domains in the Mapbox console.
      It ships to the browser, so an unrestricted token is billable by anyone.
- [ ] Spend caps and budget alerts: Vercel, Supabase, Stripe, Mapbox.
- [ ] Login rate limiting: Supabase → Authentication → Rate Limits. Cannot be
      done in app code — `LoginForm` calls `signInWithPassword()` straight from
      the browser, so the request never reaches this app.
- [ ] Confirm Supabase PITR/backups are on, and run one restore test.
- [ ] Enable `pg_cron` and schedule `sweep_rate_limits()` hourly (migration `025`).
- [ ] Fill in the `<Placeholder>` values in `/privacy` and `/terms` and have both
      reviewed by a lawyer.
- [ ] Set up alerting: repeated auth failures, 4xx/5xx spikes, unusual per-user
      spend.

---

## Related docs

| Doc | What it's for |
|---|---|
| [`SECURITY.md`](SECURITY.md) | Findings register, standing assumptions, owner-only actions |
| [`RESUME.md`](RESUME.md) | Session handoff — current state and what to pick up |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Cache Components / PPR work |
