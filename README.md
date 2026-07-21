# Dropin

**The centralized marketplace for discovering drop-in sport and recreation.**

Dropin is a public discovery platform that lets consumers find drop-in recreation across organizations and municipalities, while giving organizations a modern way to publish and manage their schedules.

---

## What problem does this solve?

**For consumers:** Recreation information is siloed across dozens of municipal and private websites, each with a different UX. Finding "where can I lap swim this week?" requires visiting multiple sites.

**For organizations:** Existing recreation software (Xplor, ActiveNet, NextRec) has poor public-facing schedule displays, forcing staff to build redundant paper or PDF schedules every week. Dropin provides a visual weekly schedule layer that works *on top of* existing systems — no migration required.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        DROPIN PLATFORM                          │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Public Discovery │  │  Org Dashboard   │  │   Widget     │  │
│  │  /search, /browse│  │  /dashboard/*    │  │ /widget/[id] │  │
│  │  /facility, /prog│  │  Schedule editor │  │ (iframe)     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Next.js 16 App Router                 │   │
│  │              API Routes + Server Components              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌───────────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │  Supabase         │  │  Stripe    │  │  External Scraper │  │
│  │  Postgres + RLS   │  │  Billing   │  │  Playwright svc   │  │
│  │  Auth + Realtime  │  │            │  │  (Railway/Fly.io) │  │
│  └───────────────────┘  └────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow for schedules

1. Organization staff add their schedule via one of three ingestion paths:
   - **Manual** — build schedule directly in the Dropin dashboard
   - **Upload** — import from Excel/CSV (existing paper schedules)
   - **Scraping** — auto-sync from their existing Xplor/ActiveNet/NextRec page

2. Sessions are stored as **RRULE recurrence rules** (not individual events). "Lap Swim runs Mon/Wed/Fri 6–8am" is one database row.

3. At query time, `lib/rrule/expand.ts` expands rules into concrete occurrences for the requested week range.

4. The weekly visual schedule grid renders expanded sessions. Consumers view it at `/facility/[slug]`, organizations edit it in the dashboard, and the embeddable widget shows it in an iframe on the org's own site.

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
| Maps | Mapbox GL JS |
| Email | Resend |
| Recurrence | rrule (RFC 5545) |
| Scraping | External Node + Playwright service |

---

## Project Structure

```
dropin/
├── src/
│   ├── app/                    # Next.js App Router pages and API routes
│   │   ├── (public)/           # Public discovery pages (no auth)
│   │   ├── (auth)/             # Login, signup, password reset
│   │   ├── (dashboard)/        # Org staff dashboard (auth required)
│   │   ├── (admin)/            # Superadmin panel
│   │   ├── widget/[orgId]/     # Embeddable widget iframe
│   │   └── api/                # API route handlers
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui base components
│   │   ├── layout/             # Nav, sidebar, providers
│   │   ├── discovery/          # Search, map, facility cards
│   │   ├── schedule/           # Weekly grid (read-only public view)
│   │   ├── schedule-editor/    # Weekly grid (editable dashboard view)
│   │   ├── import/             # File upload, column mapping, preview
│   │   ├── scraping/           # Scrape config, conflict resolution
│   │   └── widget/             # Widget configurator and preview
│   │
│   ├── lib/
│   │   ├── supabase/           # DB clients: browser, server, middleware, admin
│   │   ├── rrule/              # Recurrence rule expansion
│   │   ├── import/             # Excel/CSV parsing and validation
│   │   ├── scraping/           # Conflict detection and platform adapters
│   │   ├── auth/               # Session helpers, role checking
│   │   └── utils/              # cn, dates, slugify, sport-categories
│   │
│   ├── hooks/                  # Custom React hooks (TanStack Query wrappers)
│   ├── store/                  # Zustand stores (editor state, search filters)
│   └── types/                  # TypeScript types (database, schedule, app)
│
├── supabase/
│   ├── migrations/             # Numbered SQL migrations (run in order)
│   └── functions/              # Edge functions (scraping scheduler, email)
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

Migrations live in `supabase/migrations/` and run in numbered order:

| File | Purpose |
|---|---|
| `001_initial_schema.sql` | Core tables: orgs, facilities, programs, sessions, exceptions |
| `002_rls_policies.sql` | Row Level Security policies for all tables |
| `003_indexes.sql` | Performance indexes |
| `004_stripe_tables.sql` | Subscription and Stripe event tables |
| `005_analytics_tables.sql` | Widget config and analytics event tables |
| `006_scraping_tables.sql` | Scraping config, job, and conflict tables |

**Never modify a migration that has been run in production.** Create a new numbered migration instead.

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

## Delivery Phases

This project follows agile delivery — each phase ships a working vertical slice:

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: auth, org creation, layout | 🔨 In progress |
| 2 | Core data model: facilities, programs, sessions, weekly grid | Pending |
| 3 | Public discovery: search, map, SEO pages | Pending |
| 4 | Org dashboard: editor, import, widget, billing | Pending |
| 5 | Scraping: automated sync from Xplor/ActiveNet/NextRec | Pending |
| 6 | Widget embed script, analytics, admin panel | Pending |

Run `/security-review` before merging any phase.
