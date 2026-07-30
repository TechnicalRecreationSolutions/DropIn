# Dropin — Plan and Current State

Last reconciled against the codebase: 2026-07-29. This document is a snapshot, not a contract — re-verify anything load-bearing against the actual migrations/code before relying on it, especially the schema map below.

---

## 1. How the idea has grown

The original plan was five phases, all shipped on `main`:

| Phase | Scope | Commit |
|---|---|---|
| 1 | Foundation: auth, org creation, core schema, layout | `c08a773` |
| 2 | Core data model: facilities, programs, sessions, weekly grid | `33843c9` |
| 3 | Public discovery: search, map, browse pages | `58f1a80` |
| 4 | Org dashboard: editor, CSV import, Stripe billing, embeddable widget | `667f1db` |
| 5 | Automated scraping from Xplor/ActiveNet/NextRec | `dfcca7d` |

That was the whole plan. Everything below is growth beyond it:

- **Scraping was fully removed.** Phase 5 only ever built the Dropin-side half (config UI, HMAC webhook receiver, diffing, conflict resolution) — the external scraper service was never built, and a mock stood in for it locally. It was later torn out entirely (`supabase/migrations/021_remove_scraping.sql`; scraping tables originally created in a now-deleted `006_scraping_tables.sql`, which is why migration numbering jumps from `005` to `007`). **This is a closed chapter, not a paused one** — manual entry and file import are the only ingestion paths, and that's a deliberate decision, not a gap.
- **Facility map became the flagship feature**, not a nice-to-have. Four phases (`2e1a837`, `8a833aa`, `0791591`, `17abd74`) built a shared SVG rendering engine, an illustrated public viewer, a builder with snapping/undo/keyboard support, and an expanded preset library. Full design brief: `docs/prompts/facility-map-flagship.md`.
- **The schedule-editing UX is being redesigned** around reusable, color-coded session templates dragged onto a visual builder (RecStaff-style), replacing an 11-field form per session. Phase A (schema + template CRUD) shipped; the primary remaining deliverable (drag-and-drop placement onto real physical spaces) has not.
- **The data model itself was restructured mid-flight**: `programs` was collapsed into `schedule_groups` (migration `011`), `departments` and `spaces` were introduced as real entities, and sessions moved from a single `space_id` to a many-to-many `session_spaces` join (migration `020`) to support multi-lane/multi-space sessions.
- **A dashboard complexity audit** found five concrete problems (route duplication, inconsistent "Schedule" vs "Program" terminology, unwieldy flat forms, no onboarding, scattered settings). Terminology and progressive-disclosure fixes shipped; route de-duplication and onboarding/settings-inheritance did not.

None of this was in the original plan. That's normal for a real product — but it's also exactly why the docs drifted (the README's phase table still said "Pending" for phases that had been done, superseded, *and* built on top of again) and why this file exists: a single place to keep the shape of the thing current without re-deriving it from 21 migrations every time.

---

## 2. Current schema (as of migration `021`)

Grouped by concern, not by migration number — migration order tells you history, not structure. Source: `supabase/migrations/001` through `021`, cross-checked against `src/types/database.types.ts`.

**Identity & access**
- `organizations`, `org_memberships`, `staff_invitations`

**Facility structure** (nesting: facility → department (optional) → schedule_group → session)
- `facilities`, `departments`, `spaces` — physical bookable spaces (pools, courts, rooms)

**Scheduling**
- `schedule_groups` — the public-facing "class"/"program" entity (formerly two entities, `programs` + `schedule_groups`, collapsed in migration `011`)
- `sessions` — recurring sessions stored as RRULEs, not individual events
- `session_exceptions` — one-off cancellations/modifications to a recurring session
- `session_templates` — reusable, color-coded presentation+defaults for the drag-and-drop builder (schedule-specific fields like cost/age/skill stay on `schedule_groups` to avoid drift between template and instance)
- `session_spaces`, `session_template_spaces` — many-to-many joins for sessions/templates that occupy multiple physical spaces at once (e.g., a multi-lane swim session)

**Facility map**
- `facility_maps` — one published illustrated map per facility
- `space_hotspots` — normalized (0..1) shapes on a map, each tied to a `space`, with a `preset_key` (pool, court, etc.) driving which illustration renders
- `map_context_elements` — non-interactive context (walls, entrance, labeled zones)

**Billing**
- `subscriptions`, `stripe_events`

**Widget & analytics**
- `widget_configs`, `analytics_events`

**Removed, don't reintroduce without a deliberate decision:** `programs` (collapsed into `schedule_groups`), `scraping_configs`, `scraping_jobs`, `scraping_conflicts` (scraping removed entirely).

---

## 3. Known drift / debt (found while writing this doc)

These are concrete, not vibes — worth fixing before they compound further. The refinement prompt in `docs/prompts/tech-debt-refinement.md` is built to work through this list plus a fresh audit.

1. **`src/types/database.types.ts` is hand-maintained and already wrong.** It's missing the `stripe_events` table entirely despite it existing since migration `004`. This is the file meant to answer "what's actually set up between the app and Supabase," and it's already silently out of date.
2. **`supabase as any` appears 113 times across 45 files** — almost every route/page that touches the database bypasses the type system rather than trusting it. That's a direct symptom of #1: if the types were trustworthy, this cast wouldn't be the path of least resistance.
3. **Duplicated route trees.** Because a schedule group can live directly under a facility or nested under an optional department, most schedule-group/session-template/builder pages exist twice (e.g. `dashboard/facilities/[facilityId]/schedule-groups/...` and `dashboard/facilities/[facilityId]/departments/[departmentId]/schedule-groups/...`). Flagged previously as codebase-health, not user-facing, so deprioritized — but it's also what's driving a chunk of that 113-file count.
4. **Stray empty route directories** left over from restructuring, with no `page.tsx`: `src/app/(public)/program/[programSlug]/` (leftover from the `programs` → `schedule_groups` collapse) and `src/app/(dashboard)/dashboard/org/onboarding/` (the real onboarding page now lives under `(auth)/dashboard/org/onboarding/` instead).

---

## 4. Open threads, in priority order (per prior discussion, not re-litigated here)

1. Route de-duplication (department-nested vs. facility-direct schedule-group trees) — codebase health.
2. Real onboarding flow + settings inheritance (cost/age/skill defaults from department, timezone from facility).
3. Schedule builder Phase B: drag-and-drop placement of session templates onto real `spaces` (the primary deliverable of the schedule-builder redesign — everything after A is blocked on this being genuinely useful).
4. Schedule builder Phases C–E: session edit/delete UI (doesn't exist yet at all — create + soft-delete only), `schedule_type` time-block/continuous variant, grid/list builder parity — lower priority, do B first.

---

## 5. Ground rules that don't change

- Never edit a migration that has already run in production — append a new one, even for a one-line fix.
- Mobile-first is a hard requirement (weekly grid, facility map, schedule builder all need to work on a phone first — future app-store deployment is planned).
- This is treated as a real production app headed for a professional audit: architecture docs and per-directory READMEs are expected to exist and stay current, not just code.
