# Dropin

**The centralized marketplace for discovering drop-in sport and recreation.**

Dropin is a public discovery platform that lets consumers find drop-in recreation across organizations and municipalities, while giving organizations a modern way to publish and manage their schedules.

**Picking up after a break? Start at [`docs/RESUME.md`](docs/RESUME.md)** — current state, blockers, and what to do next.

For the delivery history, current schema map, and open work, see [`docs/PLAN.md`](docs/PLAN.md). This README covers what the app is and how to run it.

**Before changing anything that touches auth, RLS policies, the service-role key, or a public endpoint, read [`docs/SECURITY.md`](docs/SECURITY.md)** — in particular its *Standing assumptions* section, which lists the invariants that closed security findings depend on.

---

## What problem does this solve?

**For consumers:** Recreation information is siloed across dozens of municipal and private websites, each with a different UX. Finding "where can I lap swim this week?" requires visiting multiple sites. Dropin's **facility map** turns that into a visual, recognition-first experience — see a picture of the building, tap the pool, know what's happening there right now.

**For organizations:** Existing recreation software (Xplor, ActiveNet, NextRec) has poor public-facing schedule displays, forcing staff to build redundant paper or PDF schedules every week. Dropin provides a visual weekly schedule layer and an illustrated facility map that work *on top of* existing systems — no migration required. A drag-and-drop **schedule builder** lets staff place reusable session templates instead of filling out a form for every session.

---

## Flagship features

These are the product's actual differentiators, not incidental features — see `docs/PLAN.md` for status/roadmap of each:

- **Facility map** (`src/components/facility-maps/`) — an illustrated SVG rendering engine shared by the admin builder and the public viewer. Pools render as water with lane ropes, courts get real markings, spaces glow when a session is live. Recipe and design principles: `docs/prompts/facility-map-flagship.md`.
- **Schedule command centre** (`src/components/schedule-command/`, `src/components/schedule/editing/`, `src/components/session-template/`) — `/dashboard/schedule` is the one page staff live on: building → department → schedule scope at the top, then Schedule/Spaces/Map/Widget tabs beneath. Color-coded, reusable session templates drag onto the schedule instead of re-filling an 11-field form per session. The editing views *are* the public widget views wrapped in a provider, so what staff build cannot drift from what visitors see.

Ingestion into a schedule is **manual entry or Excel/CSV import only.** An earlier phase built an automated scraping pipeline (Xplor/ActiveNet/NextRec) end-to-end on the Dropin side, but the external scraper service was never built, and the feature was fully removed (`supabase/migrations/021_remove_scraping.sql`). It is not on the roadmap — don't reintroduce scraping-shaped code or docs without a deliberate decision to revisit it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        DROPIN PLATFORM                          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Public Discovery │  │  Org Dashboard   │  │   Widget     │  │
│  │  /search, /browse│  │  /dashboard/*    │  │ /widget/[id] │  │
│  │  /facility        │  │  Schedule + map  │  │ (iframe)     │  │
│  │                    │  │  builders        │  │              │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Next.js 16 App Router                 │   │
│  │              API Routes + Server Components              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌───────────────────┐  ┌────────────┐                          │
│  │  Supabase         │  │  Stripe    │                          │
│  │  Postgres + RLS   │  │  Billing   │                          │
│  │  Auth + Realtime  │  │            │                          │
│  └───────────────────┘  └────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow for schedules

1. Organization staff add sessions via one of two ingestion paths: **manual** (built directly in the dashboard, optionally via the drag-and-drop session-template builder) or **import** (Excel/CSV upload of existing paper schedules).

2. Sessions are stored as **RRULE recurrence rules** (not individual events). "Lap Swim runs Mon/Wed/Fri 6–8am" is one database row.

3. At query time, `lib/rrule/expand.ts` expands rules into concrete occurrences for the requested week range.

4. The weekly grid and the illustrated facility map both render expanded sessions. Consumers view them at `/facility/[facilitySlug]`, organizations edit the underlying data in the dashboard, and the embeddable widget shows either view in an iframe on the org's own site.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router |
| Database / Auth | Supabase (Postgres + RLS + Realtime) |
| Payments | Stripe |
| Deployment | Vercel |
| Styling | Tailwind CSS 4 |
| Client state | Zustand |
| Server state | TanStack Query |
| Forms | React Hook Form + Zod |
| Drag and drop | dnd-kit |
| Maps (discovery) | Mapbox GL JS |
| Facility map rendering | Hand-rolled SVG (`src/components/facility-maps/renderer/`) |
| Email | Resend |
| Import parsing | xlsx, papaparse |
| Recurrence | rrule (RFC 5545) |

---

## Project Structure

```
dropin/
├── src/
│   ├── app/                    # Next.js App Router pages and API routes
│   │   ├── (public)/           # Public discovery: search, browse, facility pages
│   │   ├── (auth)/             # Login, signup, org onboarding
│   │   ├── (dashboard)/        # Org staff dashboard (auth required)
│   │   ├── (admin)/            # Superadmin panel
│   │   ├── widget/[orgId]/     # Embeddable widget iframe
│   │   └── api/                # API route handlers
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui base components
│   │   ├── layout/              # Nav, sidebar, providers
│   │   ├── discovery/           # Search, map, facility cards
│   │   ├── schedule/             # Weekly grid + floorplan views (public AND editable)
│   │   │   └── editing/           # Providers/dialogs that turn those views into editors
│   │   ├── schedule-command/      # /dashboard/schedule — the staff command centre
│   │   ├── schedule-editor/       # SessionForm + RRuleBuilder (the /sessions/* forms)
│   │   ├── session-template/      # Session template CRUD
│   │   ├── facility-maps/          # Illustrated SVG map engine + admin builder
│   │   ├── department/, facility/, schedule-group/, space/  # Entity forms/lists
│   │   ├── import/                # File upload, column mapping, preview
│   │   ├── billing/                 # Stripe checkout/portal UI
│   │   ├── analytics/               # Dashboard analytics widgets
│   │   └── widget/                   # Widget configurator and preview
│   │
│   ├── lib/
│   │   ├── supabase/            # DB clients: browser, server, middleware, admin
│   │   ├── rrule/                # Recurrence rule expansion
│   │   ├── schedule/              # Live-status logic (`sessionStatus.ts`), shared across views
│   │   ├── facility-shapes/        # Facility map preset taxonomy (pools, courts, rooms)
│   │   ├── maps/                    # Facility map geometry helpers
│   │   ├── import/                   # Excel/CSV parsing and validation
│   │   ├── stripe/                    # Plans, client
│   │   ├── auth/                       # Session helpers, role checking
│   │   └── utils/                       # cn, dates, slugify, sport-categories
│   │
│   ├── hooks/                  # Custom React hooks (TanStack Query wrappers)
│   ├── store/                  # Zustand stores (editor state, search filters)
│   └── types/                  # TypeScript types — see "Database types" below
│
├── supabase/
│   ├── migrations/             # Numbered SQL migrations (run in order, never edited after running)
│   └── functions/              # Edge functions (email)
│
└── public/
    └── embed/widget.js         # Public embed script (organizations paste this)
```

See each subdirectory for deeper documentation on that module.

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

Fill in `.env.local` with your credentials. See `.env.example` for descriptions of each variable and where to find them.

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

---

## Database Migrations

Migrations live in `supabase/migrations/` and run in numbered order. **Never modify a migration that has already run in production** — create a new numbered migration instead, even to fix a mistake in an old one (see `021_remove_scraping.sql` for the pattern: it defensively handles columns/tables that may or may not exist depending on which historical version of an earlier migration a given database actually ran).

The migration list itself is not duplicated here — it changes too often to keep two copies in sync. For a narrative map of what the schema actually looks like right now, grouped by concern, see [`docs/PLAN.md`](docs/PLAN.md).

### Database types

`src/types/database.types.ts` is meant to be generated by `supabase gen types` (step 3 above) whenever the schema changes. If you're working against a local/manual schema without a linked Supabase project, it must be hand-updated to match — check it against the migrations before trusting it, it has drifted before.

---

## Security

This application handles organization data and payment information. Key security controls:

- **Row Level Security:** Every table has RLS enabled. Public access returns only published data. Org staff access is scoped to their own organization via `org_memberships`.
- **Server-only secrets:** `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` are never exposed to the browser. The service role client is only imported in `lib/supabase/admin.ts`.
- **Input validation:** All API route handlers validate request bodies with Zod before touching the database.
- **Stripe webhooks:** Signature verified with `stripe.webhooks.constructEvent()` before processing.
- **Widget analytics:** IP addresses are SHA-256 hashed before storage. No PII collected.

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

The script creates an iframe pointing to `/widget/[orgId]` and auto-resizes it via `postMessage`. The widget route is served with permissive `X-Frame-Options` headers so it can be embedded on any domain.

---

## Project status

This is a real production app headed for a professional audit and app-store deployment, built agile — each phase ships a working vertical slice. The original 5-phase plan (foundation → core data model → public discovery → org dashboard → widget/scraping) shipped, and the product has grown well past it since. See [`docs/PLAN.md`](docs/PLAN.md) for the full delivery history, what's actively being cleaned up, and what's next.

Run `/security-review` before merging any phase.
