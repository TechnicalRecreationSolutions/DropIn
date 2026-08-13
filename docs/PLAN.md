# Dropin — Plan and Current State

Last reconciled against the codebase: 2026-08-01. This document is a snapshot, not a contract — re-verify anything load-bearing against the actual migrations/code before relying on it, especially the schema map below.

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

**Planning**
- `seasons` — org-level named date ranges ("Fall 2026", Sep 8 – Dec 20), migration `027`. Overlapping is legal and deliberate, so "the current season" is not derivable from `now()` alone — the rule lives only in `src/lib/seasons/current.ts`. Three states (`planning`/`active`/`archived`) rather than `is_published`, so archived seasons keep resolving for links printed in old brochures. `sessions.season_id` is nullable, explicit (never inferred from `valid_from`/`valid_until`), and `ON DELETE SET NULL`.

**Scheduling**
- `schedule_groups` — the public-facing "class"/"program" entity (formerly two entities, `programs` + `schedule_groups`, collapsed in migration `011`)
- `sessions` — recurring sessions stored as RRULEs, not individual events
- `session_exceptions` — one-off cancellations/modifications to a recurring session
- `session_templates` — reusable, color-coded presentation+defaults for the drag-and-drop builder (schedule-specific fields like cost/age/skill stay on `schedule_groups` to avoid drift between template and instance)
- `session_spaces`, `session_template_spaces` — many-to-many joins for sessions/templates that occupy multiple physical spaces at once (e.g., a multi-lane swim session)
- `session_features` — migration `028`. The presentation payload behind two flags, `sessions.is_event` and `sessions.in_brochure`: title, summary, description, image, link, category, accent. One record per session (`session_id` is UNIQUE), because both channels need identical copy and duplicating it per channel is how a brochure ends up disagreeing with a calendar. **Turning a flag off does not delete the copy** — that is the point of the sidecar.

**Publishing**
- `brochures` — migration `031`. A seasonal publication: title, slug (UNIQUE per org), cover, intro, accent, `status` (`draft`/`published`/`archived`), optional `season_id` and `facility_id` (NULL = org-wide). Owner/admin writable; publish-gated public read.
- `brochure_sections` — ordered groupings inside a brochure, with a fixed `layout` set (`list`/`grid`/`feature`) because each value is a real template in the renderer.
- `brochure_entries` — **materialized** membership. Copy is snapshotted at pull time and then owned by the entry, so editing a session never rewrites a printed brochure. `status = 'dismissed'` is a **tombstone**, not a deletion — it stops a re-pull resurrecting what a human removed. `brochure_id` is denormalized (both invariants are brochure-wide), `section_id` is `SET NULL` (a deleted section must not take tombstones with it), and the source FKs are `SET NULL` too, which migration `032` had to relax the CHECK constraint to permit.
- `schedule_groups.in_brochure` — migration `031`. Candidacy for a brochure, since a brochure lists *programs* as often as one-off events.

**Storage** (migration `030`, not a table)
- One public bucket, `org-media`, every object under `{orgId}/{kind}/…`. The first path segment scopes ownership; the second (`events`/`brochure`/`facilities`/`schedules`/`org`) decides whether a write is member- or manager-scoped. Size and MIME limits are on the bucket, not the client. See `src/components/media/README.md`.

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

1. ~~`src/types/database.types.ts` is hand-maintained and already wrong.~~ **Resolved.** Types were regenerated to match all 21 migrations, including the previously-missing `stripe_events` table. Two more drift bugs turned up and were fixed while removing the casts below: `subscriptions.updated_at` and `widget_configs.updated_at` were marked required in the `Insert` type despite both columns having `DEFAULT NOW()` at the DB level and being set explicitly by app code (Stripe webhook handler, widget config PATCH).
2. ~~`supabase as any` appears 113 times across 45 files.~~ **Resolved.** All casts removed now that types are trustworthy; a handful of relational-select spots (`facility-maps/public`, `sessions/expand`) keep a narrow `as unknown as { data: ExplicitRowType[] | null }` cast with a comment, since PostgREST embedded joins (`table(...)` syntax) still return `SelectQueryError` — the generated types have empty `Relationships: []` for every table (no FK introspection). `tsc --noEmit` and lint are clean.
3. **Duplicated route trees.** Because a schedule group can live directly under a facility or nested under an optional department, most schedule-group/session-template/builder pages exist twice (e.g. `dashboard/facilities/[facilityId]/schedule-groups/...` and `dashboard/facilities/[facilityId]/departments/[departmentId]/schedule-groups/...`). Flagged previously as codebase-health, not user-facing, so deprioritized.
4. ~~Stray empty route directories~~ **Resolved** (already gone as of this reconciliation — `src/app/(public)/program/[programSlug]/` and `src/app/(dashboard)/dashboard/org/onboarding/` no longer exist).

---

## 3a. In flight: seasons → event calendar → brochure → control centre

A five-phase track, specified in full in `docs/prompts/seasons-events-brochure.md`. The
motivating observation: a month-at-a-glance events sheet was being typed into Word and
printed for a facility wall, even though every event on it was already in Dropin as a
session. One entry, many surfaces.

| Phase | Scope | State |
|---|---|---|
| A | `seasons` + `sessions.season_id`, CRUD at `/dashboard/seasons`, season picker in the command centre | **Done** — `027` applied and verified |
| B | Range-based expansion (replacing the week-bound API/hook), `is_event` + `session_features`, one-time RRULE mode, an `events` schedule template, print stylesheet, the public org surface | **Done** — `028`+`029` applied, 64 assertions green |
| C | Supabase Storage + image upload | **Done** — migration `030` applied, 19 assertions green |
| D | Brochure: schema, editor, candidacy→pull→tombstone flow, public + print output | **Done** — migrations `031`+`032` applied, 40 assertions green |
| E | Control centre: season milestones, tasks, derived readiness signals | Not started |

Phase B contained the one genuinely risky refactor — `/api/sessions/expand`,
`useWeeklySchedule`, and `getWeekStart/getWeekEnd` were hard-bound to a Monday–Sunday week,
and every schedule surface depended on that hook. It landed as an arbitrary
`rangeStart`/`rangeEnd` on the endpoint, with `useWeeklySchedule` kept as a thin wrapper so
the four existing call sites changed only their imports.

Two things worth knowing before touching Phase B code:

- **`useScheduleAnchor` holds one date, not a week and a month.** Deriving the week from an
  anchor is safe; deriving a month back out of a stored week is not —
  `getWeekStart(getMonthStart(october))` is in September, so a month derived from the week
  renders the wrong month whenever the 1st isn't a Monday.
- **`useTemplateSchedule` picks the range from the template.** Handing a week's sessions to
  the events calendar produces a calendar that looks fine and is empty after the first row,
  which reads as missing data rather than as a wrong fetch.
- **A layout under Cache Components must not `await params`.** It sits above the Suspense
  boundary `loading.tsx` creates, so awaiting request data there blocks the segment from
  prerendering and fails the build outright. See
  `src/app/(public)/org/[orgSlug]/README.md`.

Phase B also added the app's first org-level public route, `(public)/org/[orgSlug]`, which
Phase D extended with `/brochure/[brochureSlug]`.

Two more worth knowing, from C and D:

- **`org-media` is a public bucket.** Objects are readable by anyone holding the URL,
  including before the owning facility is published. Unguessable, not authorized — nothing
  sensitive belongs there. Full reasoning in `030`'s header and `docs/SECURITY.md`.
- **The public brochure page is the one public route without `"use cache"`.** Its result
  depends on `status`, and caching it meant unpublishing did not take effect. A publish gate
  is the last thing a cache should sit in front of.

**Verification for this whole track lives at [`scripts/verify/`](../scripts/verify/README.md)** —
123 assertions against a running app and the live database. Not a test suite; run them by
hand after touching what they cover. Read that README before adding to them.

## 4. Open threads, in priority order (per prior discussion, not re-litigated here)

1. Route de-duplication (department-nested vs. facility-direct schedule-group trees) — codebase health.
2. Real onboarding flow + settings inheritance (cost/age/skill defaults from department, timezone from facility).
3. Schedule builder Phase B: drag-and-drop placement of session templates onto real `spaces` (the primary deliverable of the schedule-builder redesign — everything after A is blocked on this being genuinely useful).
4. Schedule builder Phases C–E: `schedule_type` time-block/continuous variant, grid/list builder parity — lower priority, do B first. ~~session edit/delete UI (doesn't exist yet at all)~~ **That claim was wrong when written and is corrected here:** `dashboard/sessions/[sessionId]/edit` renders `SessionForm` against a real row, `PATCH /api/sessions/[sessionId]` saves it, and `DELETE /api/sessions` soft-deletes via `is_active`. Verified 2026-08-12.

---

## 5. Ground rules that don't change

- Never edit a migration that has already run in production — append a new one, even for a one-line fix.
- Mobile-first is a hard requirement (weekly grid, facility map, schedule builder all need to work on a phone first — future app-store deployment is planned).
- This is treated as a real production app headed for a professional audit: architecture docs and per-directory READMEs are expected to exist and stay current, not just code.
