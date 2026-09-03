# Dashboard navigation performance

Investigation and fixes for sluggish page-to-page navigation in the dashboard,
2026-08-04.

## The finding

Navigation felt slow because **every dashboard click re-established who you
were from scratch**, one blocking Supabase round trip at a time.

Supabase is hosted (`*.supabase.co`), so each round trip costs ~80ms of network
latency no matter how trivial the query. The queries themselves were all
indexed and fast. The cost was the *number of sequential hops*, not the work in
any one of them.

A single navigation to `/dashboard/facilities/{id}` spent this before any HTML
could be sent:

| Hop | Where | Cost |
| --- | --- | --- |
| `auth.getUser()` | proxy | ~80ms |
| `org_memberships` lookup | proxy | ~80ms |
| `auth.getUser()` | `getOrgContext()` | ~80ms |
| `org_memberships` | `getOrgContext()` | ~85ms |
| `organizations` | `getOrgContext()` | ~85ms |
| `subscriptions` | `getOrgContext()` | ~85ms |
| `facilities` | page | ~85ms |
| `departments` | page | ~85ms |
| `schedule_groups` | page | ~85ms |
| `spaces` | page | ~85ms |

Ten sequential round trips, ~830ms, on every click.

### It was not a dev-mode artifact

The obvious suspect was Turbopack compiling routes on demand. It was not the
problem. Warm navigations — where Next.js reported `next.js: 9ms` — still took
848ms. Compilation was under 2% of the time.

Confirmed by comparing against `next build && next start`: production
`getOrgContext()` measures 155-165ms against dev's 163-191ms. Effectively
identical, because the cost is network latency that both modes pay equally.

## What changed

### 1. `getOrgContext()`: 4 round trips → 2

`org_memberships.org_id` and `subscriptions.org_id` are both FKs to
`organizations(id)`, so PostgREST can embed the whole chain in one request:

```ts
.from("org_memberships")
.select("*, organizations!inner(*, subscriptions(*))")
```

Verified against the live database that the embedded result is byte-identical
to the three separate queries it replaces.

> The generated `database.types.ts` does not model PostgREST embedded
> resources, so the row shape is declared explicitly and cast once. This is a
> types-generation gap, not a runtime limitation — the FKs exist and PostgREST
> resolves them.

### 2. Dropped the membership query from the proxy

The proxy ran an `org_memberships` query on every dashboard request purely to
redirect users with no org to onboarding. `(dashboard)/layout.tsx` already
loads the same data, so the check moved there and now costs nothing.

Next.js documents Proxy as being for optimistic checks, explicitly *not* "a
full session management or authorization solution". The authoritative checks
remain RLS in Postgres plus the server components that read the session.

`auth.getUser()` stays in the proxy. It is **not** interchangeable with
`getSession()` — `getSession()` reads the cookie without verifying it against
the auth server, so a crafted cookie would pass. It also has to stay because
Server Components cannot write cookies, so the proxy is the only place the
session cookie gets refreshed on page navigations.

### 3. Proxy no longer runs on `/api` or `/_next`

- **`/api`** — route handlers create their own Supabase client and call
  `getUser()` themselves. Unlike Server Components they *can* write cookies, so
  they refresh the session without help from the proxy. The proxy never gated
  any `/api` route, so no authorization changed.
- **`/_next`** — the matcher previously excluded only `_next/static` and
  `_next/image`, so `_next/webpack-hmr` was paying a full `getUser()` round
  trip on every dev HMR poll.

`/api/sessions/expand` went from 456ms to ~95ms on this change alone.

### 4. Parallelized independent page queries

`facilities/[facilityId]` and
`facilities/[facilityId]/departments/[departmentId]` each issued four
independent reads sequentially. Both now use `Promise.all`, with the `notFound()`
gates evaluated after the batch — the sibling reads are RLS-scoped and only
wasted on the 404 path.

### 5. Added `loading.tsx` for the dashboard

There was no `loading.tsx` anywhere in the app, so every click blocked on a
full server render with nothing on screen. The boundary sits at the
`/dashboard` segment deliberately: one in the root layout would sit *above* the
shared dashboard layout and never fire on sibling navigations.

### 6. `middleware.ts` → `proxy.ts`

Next.js 16 renamed the convention; the old name logged a deprecation warning on
every boot. Same functionality, and Proxy now defaults to the Node.js runtime.

## Results

Measured with `PERF_DEBUG=1 npm run dev`, warm (already-compiled) navigations:

| Route | Before | After | |
| --- | --- | --- | --- |
| `/dashboard/facilities/{id}` | 1569ms cold / ~850ms warm | **360-381ms** | −57% warm |
| `/dashboard/facilities/{id}/departments/{id}` | 949ms / 848ms | **587-620ms** | −30% |
| `/dashboard/.../schedule-groups/{id}` | 1670ms cold | **505-539ms** | −68% cold |
| `/api/sessions/expand` | 456ms | **95-106ms** | −78% |

Component breakdown per navigation:

| | Before | After |
| --- | --- | --- |
| proxy | 160-342ms | 74-90ms |
| `getOrgContext()` | 323-413ms | 163-191ms |
| Sequential round trips | 10 | 4 |

## Measuring it again

Instrumentation lives in `src/lib/perf.ts`, gated behind an env var so it costs
nothing — not even a timer call — when off:

```bash
PERF_DEBUG=1 npm run dev
```

It logs one line per scope, e.g.:

```
[perf] getOrgContext  getUser=79ms  membership+org+subscription=81ms  total=166ms
```

---

# Part 2 — Cache Components

Enabling [`cacheComponents`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
turns on Partial Prerendering for the whole app: every route ships a
prerendered static shell immediately, and per-user data streams in behind
Suspense boundaries.

## What this did and did not change

It did **not** make the server faster. Total response time for a dashboard
navigation is essentially unchanged — the same Supabase round trips still have
to happen. What changed is *when the user sees something*.

Measured on the public PPR routes, where it can be timed without a session:

| | shell (TTFB) | full response |
| --- | --- | --- |
| `/search` | **62-77ms** | 160-169ms |
| `/browse/[sport]` (fully cached) | 76-110ms | 77-112ms |

The shell lands roughly 2.5x earlier than the complete page. Dashboard routes
work the same way — sidebar, headings and skeletons paint from the shell while
the org lookup and page queries stream in behind them.

Every one of the app's 37 page routes now builds as `◐ (Partial Prerender)`,
including all 33 dashboard routes.

## The three non-obvious things

Most of the migration was mechanical. These three were not, and each cost a
build cycle to find:

1. **Calling an async function is enough to block.** The dashboard layout did
   not `await` anything, but it still called `getOrgContext()` to pass the
   promise down. That call reads cookies, and reading cookies outside a
   Suspense boundary blocks the shell whether or not you await the result. The
   lookup had to move inside the boundary — see
   `components/layout/DashboardChromeSections.tsx`.

2. **`usePathname()` is request data on a dynamic route.** `DashboardBottomNav`
   is a client component whose only sin is highlighting the active tab. On
   `/dashboard/facilities/[facilityId]` the pathname is not known at prerender
   time, so it blocked the entire shell exactly like an uncached query would.
   It now has its own boundary.

3. **A boundary in the layout does not cover sibling navigation.** `loading.tsx`
   is enough for a fresh page load, but when navigating from one dashboard page
   to another the shared layout is the entry point — anything above it has
   already rendered. Routes that must be instant need the boundary *inside the
   page*. This is why `/dashboard`, `/dashboard/facilities` and
   `/dashboard/schedule` were split into a static header plus a streamed body.

## Guarding against regressions

> **Superseded — see Part 3.** Next 16.3 renamed this config key to `instant`
> and validation is a dev-overlay insight, not a build failure. The exports
> below now read `export const instant = true` and cover 15 routes, not 3.

Three routes export `unstable_instant = { prefetch: "static" }`:

- `/dashboard`
- `/dashboard/facilities`
- `/dashboard/schedule`

Next.js validates at build time that these still produce a static shell from
every entry point. A future change that reintroduces blocking data access fails
`npm run build` instead of quietly making navigation feel slow again.

The dynamic routes (`[facilityId]`, `[departmentId]`) are deliberately not
validated. Validation on a dynamic route requires `prefetch: 'runtime'` plus
`samples` containing concrete param values — real facility UUIDs committed to
source, which would rot the moment the data changed. Those routes still get PPR;
they just do not get the build-time guarantee.

## Public data is now genuinely cached

`/browse/[sport]` and `/facility/[facilitySlug]` render identical output for
every visitor, so their queries moved into `use cache` functions with
`cacheLife('hours')`. `/facility/[facilitySlug]` also collapsed three sequential
queries into one cached unit with the two dependent reads issued in parallel,
and `generateMetadata` now shares that same cache entry instead of repeating the
facility lookup.

These use `createPublicClient()` (`lib/supabase/public.ts`) — a cookie-free anon
client added for this purpose. A cached function cannot read request data, and
the anonymous RLS view is exactly the public view these pages want. It is not
the admin client and has no elevated privileges.

## Other changes required by the migration

- Removed `runtime = "nodejs"` from four route handlers and
  `dynamic = "force-dynamic"` from the Stripe webhook. Both are the default for
  route handlers and are rejected outright when `cacheComponents` is enabled.
- The public footer's `new Date().getFullYear()` moved into a cached component.
  A static shell has no "now", so reading the clock during prerender is not
  allowed; giving the value a defined lifetime lets the year still roll over
  without a deploy.
- Added `loading.tsx` for `/widget/[orgId]`, `/facility/[facilitySlug]`,
  `/search` and org onboarding, which had no boundary at all.

## Sidebar tree behavior

Unrelated to performance, changed at the same time: clicking anywhere on a
facility or department row in the sidebar now navigates *and* toggles its
children. Previously only the small chevron toggled, and it was easy to miss.
The chevron remains as a visual affordance but is no longer a separate control
— it sits inside the link, so there is no sub-target that behaves differently
from the rest of the row.

---

## Known tradeoff

`/api/sessions/expand` performs no auth call of its own — it is dual-use
(public schedule grid and dashboard editor) and relies on RLS to scope rows.
With the proxy no longer refreshing cookies for `/api`, a request carrying an
expired access token will see only public sessions rather than all of the
user's. It fails **closed**, never open, and page navigations still refresh the
cookie through the proxy, so a stale token is unlikely in practice. Flagged
because it is a behavior change, however small.

---

# Part 3 — Local JWT verification

2026-09-02. Prompted by the report that clicking between dashboard pages
"takes a second and loads an empty screen where you can see the shadow of the
CTAs".

## Measuring it properly first

`scripts/verify/perf-nav.mjs` was written for this and is the tool to reach for
next time. It builds a throwaway org, signs in for real, and measures two
layers:

- **Server** — each route over HTTP, both as a document (a page load) and as
  the RSC payload the router actually fetches on a click.
- **Browser** — a real Chromium clicking the real sidebar links, timing from
  the click to `paint` (the destination's own heading on screen) and to
  `settled` (no `aria-busy` left in `<main>`, i.e. every skeleton replaced).

Two traps it had to work around, both of which produce confident nonsense:

- An RSC request without the router's `_rsc` hash is 307'd, so the first
  version measured redirects. The harness reads the hash out of the redirect
  once per route.
- Measuring "a heading exists" reports a constant ~60ms no matter what the
  server does, because React keeps the outgoing page mounted until the new one
  commits — the heading being matched belongs to the page being *left*. It has
  to be "the heading changed".

Dev-mode numbers are not production numbers, so the harness takes `--app=` and
`next.config.ts` takes `NEXT_DIST_DIR`, which lets a production build be made
and served on another port while `next dev` keeps running against `.next`.

## The finding

With `PERF_DEBUG=1` against `next start`, one navigation was:

| | |
| --- | --- |
| proxy `updateSession` → `auth.getUser()` | ~100ms |
| RSC tree → `auth.getUser()` | ~100ms |
| membership + org + subscription | ~78ms |
| the page's own queries | ~85ms |

**`auth.getUser()` was over half the page, and it was paid twice.** It is not a
database query — it is a network call to `/auth/v1/user` that this project pays
~100ms for on every single invocation.

## The fix

The project already issues **ES256** access tokens and publishes a JWKS, so the
token can be verified locally instead:

```
getClaims  = 1ms   (after a one-time key fetch)
getUser    = 98ms  (every call)
```

`src/lib/auth/claims.ts` holds `getClaims()` — the JWKS cached for the life of
the server process, and passed in explicitly. That cache is the whole point:
`supabase-js` caches the key set per *client instance*, and this app builds a
client per request, so without it every request re-fetches the key set and
gives back the 100ms.

`getOrgContext()`, `OrgGuard` and the dashboard chrome all now take identity
from `getClaims()`. `getUser()` remains for the one case that genuinely needs
fields outside the token — org onboarding reads `user_metadata`.

This is **not** `getSession()`, which decodes the cookie without checking
anything. `getClaims()` verifies the ES256 signature and the expiry with
WebCrypto: the same check Postgres performs on the JWT when RLS evaluates
`auth.uid()`. What it does not do is ask whether the session was revoked since
it was issued.

**That property is preserved elsewhere, deliberately:** the proxy still calls
`getUser()` on every dashboard navigation, so a revoked session is caught there
and redirected to /login before any of this runs. API route handlers also still
call `getUser()` themselves — the proxy does not run for `/api`, so that is
their only session check and it must stay a real one. The remaining ~100ms in
the proxy is the price of that; removing it would trade revocation checking for
speed, and that is a decision, not a cleanup.

`scripts/verify/verify-o.mjs` asserts the mechanism: `getClaims()` accepts a
genuine token (positive control) and rejects both a token whose `sub` was
rewritten to another user and one whose signature was altered, and over real
HTTP a tampered cookie renders neither user's org.

## Also changed

**`/dashboard` was three sequential waves, now two.** The overview awaited the
facility list, then issued five more reads. Only one of those five needs to
know which facility is selected; the other four are org-scoped and now go out
with the facility list. Note the `start()` helper there — a PostgREST builder is
lazy and issues nothing until something calls `.then()` on it, so assigning one
to a const does *not* start it, and code that looks parallel runs sequentially.

**`unstable_instant` was renamed to `instant` in Next 16.3.** All 15 pages still
exported the old name, which Next silently ignores, so the regression guard
those exports were added for had not been running since the upgrade. The
comments claiming a failing build were wrong too: instant validation surfaces in
the dev overlay and never blocks a build.

## Results

Production build, median of 5 warm runs, small fixture org:

| | before | after | |
| --- | --- | --- | --- |
| RSC navigation, full | 388ms | **273ms** | −30% |
| RSC navigation, streamed body | 275ms | **163ms** | −41% |
| `/dashboard` (the landing page) | 552ms | **428ms** | −22% |
| Browser: click → content | 413ms | **362ms** | −12% |
| Browser: skeleton on screen | 350ms | **300ms** | −14% |

## Why the browser numbers moved less than the server ones

React enforces a floor. `FALLBACK_THROTTLE_MS = 300` in `react-dom`: once a
Suspense fallback has been shown, the reveal is held for 300ms so a fallback
cannot flash away instantly. Every route now sits at exactly that floor — even
`/dashboard/settings`, whose server response is 184ms.

**So server work below ~300ms no longer changes what anyone sees.** The only way
past it is to not show a fallback at all, which means the content has to be
there before the click. See "What is left" below.

A DOM probe confirmed there is exactly one skeleton phase per navigation, not
two — the `/dashboard` `loading.tsx` does not fire on sibling navigations, so
there is no generic-then-specific double flash.

## Tried and rejected: `partialPrefetching`

Next 16.3's Partial Prefetching (one shared App Shell per route rather than a
prefetch per link) was enabled, measured, and removed again:

- **Production: no change.** Click-to-heading was already 63ms and the shell is
  prefetched under the old model too. The shell was never the slow part.
- **Dev: clearly worse** — settled went 490ms → 730ms. Every sidebar link
  visible on a page asks the single dev server to render another shell, and the
  navigation queues behind that work.

The reasoning is left as a comment in `next.config.ts` so it is not re-tried
blind. Worth revisiting if the sidebar ever links to many more routes.

## Tried and rejected: `use cache: private` on the org context

Wrapping `getOrgContext()` in `"use cache: private"` with a 5-minute `stale`
changed nothing measurable (412ms vs 413ms). The docs are explicit about why:
such a function "executes on every server render". The cached value rides along
in the App Shell, but the streamed body is a server render on the click, so it
re-runs there and the round trip is still paid. It also would have introduced up
to 5 minutes of staleness on the org name and the caller's role. Not worth it.

## What is left

Ranked by expected value. The first two are the only ways to get below the
300ms floor, and both are decisions rather than cleanups.

1. **Put `org_id` in the access token** via a Supabase custom access token hook.
   `getClaims()` is already free, so the org id would arrive with zero network
   calls and the membership round trip (~78ms) would disappear entirely — a
   page would be *one* round trip, its own query. It also opens the door to the
   page's data being fetched without first resolving identity. Needs a Postgres
   hook function and enabling the hook in the Supabase dashboard.
2. **`unstable_dynamicStaleTime` on dashboard pages.** Lets the router keep a
   page's dynamic payload for N seconds, so bouncing back to a page you were
   just on is instant with no skeleton at all. The trade is freshness: 14 call
   sites currently call `router.refresh()` after a mutation, and every mutation
   path would have to be audited before trusting this on a schedule editor.
3. **Remaining sequential pages.** `/dashboard` was fixed; others still have
   `await supabase` chains that could be waves.
4. **The proxy's `getUser()` (~100ms).** It gates the shell on every navigation
   and is what makes revocation take effect immediately. Replaceable with
   `getClaims()` for another ~100ms, at the cost of a revoked session staying
   usable until its token expires. A deliberate trade — see above.
5. **`/api/nav-tree` does its own `getUser()` + membership lookup.** React Query
   caches it for 30s so it is not per-click, but it duplicates work the layout
   already did, and its `getUser()` could be `getClaims()`.

## Visual transition

Separately from the timings: the body used to snap from skeleton to content in
one frame. `components/ui/streamed.tsx` wraps each page's streamed body in a
200ms fade — short, and disabled under `prefers-reduced-motion`. Verified with
full-page screenshot comparison against the previous build across eight routes:
pixel-identical once settled, so the wrapper introduces no layout change.
