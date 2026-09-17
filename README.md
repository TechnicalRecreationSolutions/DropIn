# Dropin

**Drop-in schedules for sport and recreation centres.**

Dropin is the tool a pool, arena or community centre uses to keep one drop-in schedule up to date and publish it everywhere it needs to appear: the centre's own public page, an embeddable widget on the website it already has, and — if the centre opts in — a public directory residents can search.

> **Scope, as of 2026-09-16.** The customer is still the centre, and the staff tooling is still the product. On 2026-08-12 the consumer marketplace (city search, sport browse pages, a Mapbox map) was removed. On 2026-09-16 a **deliberately smaller** resident side came back: `/find`, a no-account directory of centres that chose to be listed, with a versioned public API the planned mobile app will read. It has no map, no accounts and no cross-centre session search yet. The decisions and phases are at the top of [`docs/PLAN.md`](docs/PLAN.md); don't widen it without revisiting them.

**Picking up after a break? Start at [`docs/RESUME.md`](docs/RESUME.md)** — current state, blockers, and what to do next.

For the delivery history, current schema map, and open work, see [`docs/PLAN.md`](docs/PLAN.md). This README covers what the app is, how it's built, and how to run it.

**Deploying, or changing environment variables? [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** — the Vercel + Supabase checklist in dependency order. The app refuses to boot with a required variable missing, so a misconfiguration presents as a failed deploy rather than a broken feature.

**Before changing anything that touches auth, RLS policies, the service-role key, or a public endpoint, read [`docs/SECURITY.md`](docs/SECURITY.md)** — in particular its *Standing assumptions* section, which lists the invariants that closed security findings depend on.

---

## What problem does this solve?

A centre's drop-in schedule usually lives in more than one place at once — its website, a PDF, and a sheet kept at the front desk — and each one is edited by hand. They drift, and the version a resident sees is whichever was updated last.

Existing recreation software (Xplor, ActiveNet, NextRec) has poor public-facing schedule displays, which is what pushes staff into rebuilding the same timetable by hand every term. Dropin holds the schedule once and produces the rest from it: an embeddable widget and a public page per building. It works *on top of* whatever registration system a centre already runs — no migration required.

The visitor-facing side is mostly the centre's **own** audience: its widget on its own site, its public pages. The one exception is `/find`, which lists only centres that opted in (`facilities.listed_in_directory`) and sends residents straight to that centre's own page.

---

## The shape of the product

Five surfaces, one database:

| Surface | Route | Who it's for |
|---|---|---|
| **Staff dashboard** | `/dashboard/*` | The rec coordinators who keep the schedule current. Auth required. |
| **Public facility page** | `/facility/[slug]` | Residents, on a page Dropin hosts. |
| **Embeddable widget** | `/widget/[orgId]` | Residents, inside an iframe on the centre's *own* website. |
| **Directory** | `/find` | Residents looking for a centre near them. No account; only opted-in centres. |
| **Public API** | `/api/public/v1/directory` | `/find`, and later the mobile app. Versioned; contract in `src/app/api/public/README.md`. |

The first three are the core: the thing that keeps them from drifting apart is that the public views and the staff editors are **the same components**. `src/components/schedule/` renders the grid, list, map, board and floorplan; `src/components/schedule/editing/` wraps those exact views in a provider that adds drag, drop and dialogs. Staff edit the thing visitors see, not a separate admin representation of it.

### Five ways to read the same week

A schedule is one dataset with five renderings, chosen per embed:

- **Grid** — the whole week as a calendar. The default.
- **List** — day by day, opening on *today* rather than Sunday, because a drop-in schedule is read to answer "when can I next come".
- **Map** — one column per space (lane, court, studio).
- **Board** — a dense at-a-glance board, built for a front-desk or lobby screen.
- **Floorplan** — the illustrated SVG facility map, with spaces lighting up when a session is live.

---

## Flagship features

- **Facility map** (`src/components/facility-maps/`) — a hand-rolled SVG rendering engine shared by the admin builder and the public viewer. Pools render as water with lane ropes, courts get real markings, spaces glow when a session is live. Recipe and design principles: `docs/prompts/facility-map-flagship.md`.
- **Schedule command centre** (`src/components/schedule-command/`) — `/dashboard/schedule` is the one page staff live on: building → department → schedule scope at the top, then Schedule / Spaces / Map / Widget tabs beneath. It absorbed what used to be four separate page trees. Architecture and its boundary traps: `src/components/schedule-command/README.md`.
- **Session templates** (`/dashboard/sessions`) — a recurring session is described once, colour-coded, then dragged onto any week instead of re-filling an 11-field form per session.
- **Widget studio** (`/dashboard/widget`) — a four-step builder (layout → scope → branding → install) with a live popup preview and a copy-paste `<script>` tag. One configuration per organization.
- **Conflict detection** (`/dashboard/conflicts`) — two sessions cannot quietly claim the same space at the same time. Overlaps are surfaced before publish, including on drag-reschedule, and can be dismissed with a reason.
- **Activity log** (`/dashboard/activity`) — every edit to a facility, schedule or session is recorded, with one-click revert.
- **Per-week review** — a schedule group tracks which weeks staff have actually checked, so "is this week right?" has an answer.
- **Analytics** (`/dashboard/analytics`) — widget views, session clicks and time-on-schedule, with IP addresses SHA-256 hashed before storage.

### The resident directory (`/find`)

Added 2026-09-16. A centre ticks **List in the Dropin directory** on its facility page; residents can then find it at `/find` by name, city or sport, or sort by distance with "Use my location". There are no resident accounts. Starred centres live in the browser.

- **Opt-in, and separate from publishing.** Listed means `is_published AND listed_in_directory` (migration `052`), from an active organization.
- **Geocoding** happens on facility save, server-side, through OpenStreetMap's Nominatim (`src/lib/geo/geocode.ts`), and only when the address changed. Existing rows: `scripts/backfill-facility-geocodes.mjs` (a dry run unless you pass `--apply`).
- **The resident's position stays in the browser.** The API has no location parameter; `/find` sorts on the device with the same helpers the API uses (`src/lib/directory/filter.ts`).
- **One cached listing set** (`src/lib/directory/listings.ts`, tag `directory`) backs the API, `/find` and `sitemap.xml`. A facility save or delete expires it and that facility's own page.
- **Public API contract:** `src/app/api/public/README.md`. Adding a field is fine; renaming or removing one means `v2`. A facility's *schedule* is still served by the unversioned internal `/api/sessions/expand`, so the mobile app needs a `v1` schedule endpoint before it is built.
- Harnesses: `verify-ae` (opt-in and geocoding), `verify-af` (API), `verify-ag` (`/find` in a browser), `verify-ah` (sitemap, robots and facility-page freshness), `verify-ai` (CSP in a browser; run it against a production build).

Ingestion into a schedule is **manual entry or CSV import only.** An earlier phase built an automated scraping pipeline (Xplor/ActiveNet/NextRec) end-to-end on the Dropin side, but the external scraper service was never built, and the feature was fully removed (`supabase/migrations/021_remove_scraping.sql`). It is not on the roadmap — don't reintroduce scraping-shaped code or docs without a deliberate decision to revisit it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        DROPIN PLATFORM                          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐   │
│  │  A centre's own  │  │  Org Dashboard   │  │   Widget     │   │
│  │  public pages    │  │  /dashboard/*    │  │ /widget/[id] │   │
│  │  /facility/[slug]│  │  Schedule + map  │  │ (iframe on   │   │
│  │  + /find (opt-in │  │  builders        │  │  their site) │   │
│  │  directory, API) │  │                  │  │              │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘   │
│           │                     │                   │           │
│           └──────────┬──────────┴─────────┬─────────┘           │
│                      ▼                    ▼                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Next.js 16 App Router                  │  │
│  │   Server Components + API routes + Cache Components/PPR   │  │
│  │   src/proxy.ts — optimistic auth on every navigation      │  │
│  └───────────────────┬───────────────────┬───────────────────┘  │
│                      │                   │                      │
│  ┌───────────────────▼──┐  ┌─────────────▼──────┐               │
│  │  Supabase            │  │  Stripe            │               │
│  │  Postgres + RLS      │  │  Billing           │               │
│  │  Auth + Storage      │  │  (webhook-driven)  │               │
│  └──────────────────────┘  └────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow for schedules

1. Staff add sessions via one of two ingestion paths: **manual** (built in the dashboard, usually by dragging a session template onto the week) or **import** (CSV upload of an existing schedule; spreadsheet users export to CSV first).

2. Sessions are stored as **RRULE recurrence rules** (RFC 5545), not individual events. "Lap Swim runs Mon/Wed/Fri 6–8am" is one database row.

3. At query time, `src/lib/rrule/expand.ts` expands those rules into concrete occurrences for the requested range. `/api/sessions/expand` is the single endpoint every schedule surface calls — public page, widget and command centre alike — so there is one expansion code path, not three.

4. Times are stored as **literal wall-clock digits**, not instants. Timezone handling was removed deliberately (migration `034`): a centre's schedule says "6:00 AM" and means 6:00 AM at that building, and re-rendering it in the viewer's zone was a bug, not a feature.

5. Visibility is enforced in **Postgres, not in the query**. An anonymous reader sees a session only if its facility, department and schedule group are all published. That is why a draft schedule returns an empty array from the same endpoint that returns rows for staff — the filtering is RLS, not application code.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router (Turbopack, Cache Components / PPR) |
| Language | TypeScript, strict — no `as any` in `src/` |
| UI | React 19 |
| Database / Auth / Storage | Supabase (Postgres + RLS) |
| Payments | Stripe (Checkout + billing portal, webhook-driven) |
| Deployment | Vercel |
| Styling | Tailwind CSS 4 + shadcn/ui (Radix primitives) |
| Server state | TanStack Query |
| Client state | React state — no store library |
| Validation | Zod, on every API route body |
| Drag and drop | dnd-kit |
| Facility map rendering | Hand-rolled SVG (`src/components/facility-maps/renderer/`) |
| Import parsing | papaparse (CSV only — `xlsx` removed, see SECURITY.md → H4) |
| Recurrence | rrule (RFC 5545) |
| Verification | Playwright scripts in `scripts/verify/` |

---

## Project Structure

```
dropin/
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (public)/            # Marketing site, /facility/[slug], /privacy, /terms
│   │   ├── (auth)/              # Login, signup, org onboarding, OAuth callback
│   │   ├── (dashboard)/         # Staff dashboard (auth required)
│   │   ├── widget/[orgId]/      # Embeddable widget iframe
│   │   └── api/                 # Route handlers (Zod-validated)
│   │
│   ├── proxy.ts                 # Next Proxy: optimistic auth + session refresh
│   ├── instrumentation.ts       # Boot-time env validation (refuses to start if misconfigured)
│   │
│   ├── components/
│   │   ├── ui/                  # shadcn/ui base components
│   │   ├── layout/              # Nav, sidebar, topbar, providers
│   │   ├── schedule/            # The five views — public AND editable
│   │   │   └── editing/         # Providers/dialogs that turn those views into editors
│   │   ├── schedule-command/    # /dashboard/schedule — the staff command centre
│   │   ├── schedule-editor/     # SessionForm + RRuleBuilder
│   │   ├── schedule-list/       # Schedule group list, duplicate/delete dialogs
│   │   ├── session-template/    # Session template CRUD
│   │   ├── facility-maps/       # Illustrated SVG map engine + admin builder
│   │   ├── facility/, facilities/, department/, schedule-group/, space/, org/
│   │   ├── activity/            # Activity log + revert
│   │   ├── conflicts/           # Conflict manager
│   │   ├── dashboard/           # Overview cards + analytics widgets
│   │   ├── import/, data-entry/ # CSV upload, column mapping, preview
│   │   ├── billing/             # Stripe checkout/portal UI
│   │   ├── widget/              # Widget studio (layout, scope, branding, install)
│   │   ├── media/               # Org image upload + rendering
│   │   ├── marketing/           # Landing page sections
│   │   └── legal/               # Privacy/terms document renderer
│   │
│   ├── lib/
│   │   ├── supabase/            # DB clients: browser, server, proxy, public, admin
│   │   ├── auth/                # Claims, membership, roles, session helpers
│   │   ├── rrule/               # Recurrence expansion, formatting, validation
│   │   ├── schedule/            # Status, publish-overlap, week geometry, filters
│   │   ├── sessions/            # Conflict detection
│   │   ├── facility-shapes/     # Map preset taxonomy + geometry (pools, courts, rooms)
│   │   ├── facilities/          # Deletion impact analysis
│   │   ├── import/              # CSV row validation (shared by both import routes)
│   │   ├── analytics/           # Widget analytics queries
│   │   ├── storage/             # Supabase Storage helpers for org media
│   │   ├── stripe/              # Plans, prices, client
│   │   ├── seo/                 # notFound metadata (noindex for bad slugs)
│   │   ├── env.ts               # Required-variable manifest, validated at boot
│   │   ├── rate-limit.ts        # Per-IP/user limits on unauthenticated routes
│   │   ├── perf.ts              # PERF_DEBUG=1 server timing
│   │   └── utils/               # cn, dates, colour, slugify, session status
│   │
│   ├── hooks/                   # TanStack Query wrappers
│   └── types/                   # TypeScript types — see "Database types" below
│
├── supabase/
│   ├── migrations/              # Numbered SQL, run in order, never edited after running
│   └── functions/               # Edge functions
│
├── scripts/
│   ├── verify/                  # Playwright verification harnesses (see its README)
│   └── seed-saanich-pool.mjs    # One-off demo seed
│
└── public/
    └── embed/widget.js          # Public embed script (organizations paste this)
```

Several subdirectories carry their own README with the traps specific to that module — `src/components/schedule-command/`, `src/components/widget/`, `src/components/media/`, `src/lib/rrule/`, `scripts/verify/`. Read those before changing the module.

---

## Getting Started (Local Development)

### Prerequisites

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project (free tier works)

### 1. Clone and install

```bash
git clone <repo>
cd dropin
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local` with your credentials. See `.env.example` for descriptions of each variable and where to find them. The server **validates these at boot** (`src/lib/env.ts`, called from `src/instrumentation.ts`) and refuses to start if a required one is missing — a misconfiguration is a failed deploy, not a silently broken feature.

### 3. Database setup

```bash
# Link to your Supabase project
supabase link --project-ref YOUR_PROJECT_REF

# Run all migrations in order
supabase db push

# Generate TypeScript types from the live schema
supabase gen types typescript --project-id YOUR_PROJECT_ID \
  > src/types/database.types.ts
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Checks before you commit

```bash
npx tsc --noEmit     # types
npx eslint src       # lint
npx next build       # production build
```

> **Do not run a bare `next build` while `next dev` is running** — they share `.next/` and the build leaves the dev server returning 500 on every route. Use `NEXT_DIST_DIR=.next-verify npx next build` instead.

---

## Verification harnesses

`scripts/verify/` holds Playwright scripts that drive the real app against the real database — one per feature track (`verify-q.mjs`, `verify-s.mjs`, …). They exist because this project applies migrations by hand, so a passing type-check proves very little about what the database actually does.

The conventions that make them trustworthy are in `scripts/verify/README.md`. In short: set fixtures up with the service role but **act as a signed-in user**, always include a positive control that would fail if the harness itself were broken, and assert the *mechanism* rather than the outcome — an empty result proves nothing against an empty table.

---

## Database Migrations

Migrations live in `supabase/migrations/` and run in numbered order. **Never modify a migration that has already run in production** — create a new numbered migration instead, even to fix a mistake in an old one (see `021_remove_scraping.sql` for the pattern: it defensively handles columns/tables that may or may not exist depending on which historical version of an earlier migration a given database actually ran).

The migration list itself is not duplicated here — it changes too often to keep two copies in sync. For a narrative map of what the schema actually looks like right now, grouped by concern, see [`docs/PLAN.md`](docs/PLAN.md).

### Database types

`src/types/database.types.ts` is meant to be generated by `supabase gen types` (step 3 above) whenever the schema changes. If you're working against a local/manual schema without a linked Supabase project, it must be hand-updated to match — check it against the migrations before trusting it, it has drifted before.

---

## Security

This application handles organization data and payment information. Key controls:

- **Row Level Security:** RLS is enabled on every table. Public access returns only published data; staff access is scoped to their own organization via `org_memberships`. The database is the authority — `src/proxy.ts` does an optimistic auth check for routing, but is explicitly *not* the authorization boundary.
- **Server-only secrets:** `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` are never exposed to the browser. The service-role client is confined to `lib/supabase/admin.ts` and a small number of server files.
- **Boot-time env validation:** missing configuration stops the server rather than producing a plausible-but-wrong app (customers silently on the free tier, IP hashes silently reversible — both were real findings).
- **Input validation:** every API route handler validates its body with Zod before touching the database.
- **Rate limiting:** unauthenticated endpoints (`/api/sessions/expand`, `/api/analytics/track`) carry their own per-IP limits, since they inherit no safety from an auth check.
- **Stripe webhooks:** signature-verified with `stripe.webhooks.constructEvent()` before processing.
- **Widget analytics:** IP addresses are SHA-256 hashed with a server-side salt before storage. No PII collected.
- **CSP + HSTS:** set in `next.config.ts`. `script-src` keeps `'unsafe-inline'` — nonces are incompatible with PPR, which is a recorded ceiling rather than an oversight.

The full findings register — 19 findings, all closed, each with how it was verified — is [`docs/SECURITY.md`](docs/SECURITY.md). Run `/security-review` before merging any phase, and `npm audit` before any release: dependency advisories reopen on their own schedule, not on ours.

---

## Embeddable Widget

Organizations paste a `<script>` tag into their existing website:

```html
<div id="dropin-widget"></div>
<script
  src="https://dropin.app/embed/widget.js"
  data-org-id="YOUR_ORG_ID"
  data-container="#dropin-widget"
  async
></script>
```

The script creates an iframe pointing to `/widget/[orgId]` and auto-resizes it via `postMessage`. The widget route is served with permissive frame headers so it can be embedded on any domain.

What the widget shows is driven by one `widget_configs` row per organization (migration `045`): the layout, the brand colours and fonts, which schedules are in scope, and which filters the visitor is allowed to change. Staff build it at `/dashboard/widget`.

---

## Project status

This is a real production app headed for a professional audit and app-store deployment, built agile — each phase ships a working vertical slice. The original 5-phase plan shipped, and the product has grown well past it since. See [`docs/PLAN.md`](docs/PLAN.md) for the full delivery history and what's next.

Two things gate launch and neither is code: **custom SMTP** (Supabase's built-in mailer allows roughly two sends an hour, so signup silently fails past that) and a **lawyer's review of `/privacy` and `/terms`**, which are drafts with every owner-supplied fact rendered as a visible `[placeholder]`. Both are tracked in [`docs/RESUME.md`](docs/RESUME.md).
