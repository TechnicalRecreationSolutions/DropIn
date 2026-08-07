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

## Still open

Ranked by expected value.

1. **Two `getUser()` calls per navigation (~160ms).** The proxy and the RSC
   tree each verify the session independently. This is now the single largest
   remaining cost. Next.js documents passing data from proxy to app via headers,
   but a header-based identity hand-off needs care to ensure a client-supplied
   header can never be trusted. Worth doing, not worth rushing.
2. **Remaining sequential pages.** Only the hottest routes were parallelized or
   split. Others still have sequential `await supabase` chains behind a single
   `loading.tsx` boundary.
3. **Extend `unstable_instant` coverage.** The three validated routes could
   become many. Each needs its page split into a static header and a streamed
   body first.
4. **`/api/nav-tree` does its own `getUser()` + membership lookup.** React Query
   caches it for 60s so it is not per-click, but it duplicates work the layout
   already did.
5. **Instant-navigation DevTools.** Setting
   `experimental.instantNavigationDevToolsToggle` adds a panel that freezes the
   UI at the static shell, which makes it easy to see exactly what paints
   first. Not enabled — it is a debugging aid, not a runtime improvement.

## Known tradeoff

`/api/sessions/expand` performs no auth call of its own — it is dual-use
(public schedule grid and dashboard editor) and relies on RLS to scope rows.
With the proxy no longer refreshing cookies for `/api`, a request carrying an
expired access token will see only public sessions rather than all of the
user's. It fails **closed**, never open, and page navigations still refresh the
cookie through the proxy, so a stale token is unlikely in practice. Flagged
because it is a behavior change, however small.
