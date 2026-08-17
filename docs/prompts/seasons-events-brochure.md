# Prompt: Seasons, Event Calendar, Brochure, and the Org Control Centre

> **REMOVED 2026-08-16.** Everything this brief describes was built (phases
> A–D — see the now-historical `docs/RESUME-events.md`) and then deliberately
> removed as a scope cut, the same way scraping was
> (`supabase/migrations/021_remove_scraping.sql`). See
> `docs/prompts/remove-events-brochure.md` for the removal brief and
> `supabase/migrations/036_remove_events_brochure_seasons.sql` for the removal
> migration. This document is kept only as a record of the original intent
> behind anything that still looks ambiguous elsewhere in the codebase — it is
> not a plan to resume.

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

Dropin knows what happens in a building *this week*. It has no idea what happens **this season** — and that is the layer real recreation orgs actually plan in. Three connected features close that gap:

1. **An event toggle on any session**, feeding a cross-facility **event calendar** — the "What's Happening" board an org prints and tapes to a wall.
2. **A brochure toggle**, feeding an editable **seasonal brochure** built from sessions and programs the org has already entered.
3. An **organization control centre** where seasons, deadlines, tasks, and readiness live — the thing that makes the first two trustworthy instead of stale.

They are one feature, not three, and they must be built in that dependency order. The connective tissue is a new first-class concept — the **season** — which is the answer to nearly every hard question below.

## Why this matters (internalize before designing)

The idea came from a month-at-a-glance printout taped up in a facility bathroom. Somebody typed those events into Word, printed them, and walked them down the hall — even though every one of those events is *already in Dropin* as a session. The data is entered; it just can't be re-used in the two formats a facility actually publishes: the events board and the seasonal brochure.

So this is not "add a CMS." It is: **one entry, many surfaces.** A staff member enters Halloween Howl once, flips two toggles, and it appears on the org-wide event calendar, in the Fall brochure, on the widget, and on a printable page — with no re-typing and no second source of truth to drift.

The second half is timing. A brochure is only correct relative to a period: summer events must stop appearing when fall starts, without someone remembering to delete them. Xplor solves this with seasons. So do we — and seasons then become the spine the control centre hangs deadlines and tasks from.

## Current state (read these before touching anything)

The relevant shape of the app, verified against the code:

**Data model** — nesting is `facility → department (optional) → schedule_group → session`.
- `schedule_groups` is the public-facing "program"/"class" entity (`programs` was collapsed into it in migration `011` — do not reintroduce it). It carries `sport_category`, `activity_type`, cost, age/skill, `photo_urls`, `is_published`, and `schedule_type` (`time_block` | `continuous`).
- `sessions` are **RRULE rules, not event rows** (`rrule`, `dtstart`, `dtend_time`, `timezone`, `valid_from`, `valid_until`). Expansion to concrete occurrences happens at query time in `src/lib/rrule/expand.ts`.
- `session_exceptions` overrides individual occurrences (`cancelled` | `modified` | `added`).
- `session_templates` are reusable presentation + defaults for the builder; governance fields deliberately stay on `schedule_groups` so a price can't drift across N templates (see the header of migration `013` — that reasoning applies to everything you add here).
- `session_spaces` / `session_template_spaces` are m2m joins onto physical `spaces`.

**Expansion pipeline** — `/api/sessions/expand` → `expandSessions()` → `ExpandedSession` (`src/types/schedule.types.ts`). It accepts `orgId` / `facilityId` / `departmentId` / `scheduleGroupId` filters, requiring at least one. **It is hard-bound to a Monday–Sunday week** (`getWeekStart`/`getWeekEnd` in `src/lib/utils/dates.ts`), and the client hook `useWeeklySchedule` bakes that in too, including the `"weekly-schedule"` query key every mutation invalidates.

**Views** — `ScheduleView` switches between `WeeklyScheduleGrid` / `List` / `Map` / `FloorplanView`. Those exact components render on the widget, the public facility page, **and** the dashboard — the only difference is whether a `ScheduleEditingProvider` is mounted above them (`src/components/schedule/editing/README.md`). There is no separate editor markup, and that invariant is not negotiable.

**Widget config** — `widget_configs` is scoped `(org_id, facility_id, department_id)` with `UNIQUE NULLS NOT DISTINCT`, and `allowed_templates TEXT[]` gates which layouts a visitor may switch to. Migration `017` (adding `floorplan` as a fourth value) is the exact precedent for adding a new layout.

**Dashboard** — `/dashboard/schedule` is the command centre: one route holding facility → department → schedule scope plus Schedule/Spaces/Map/Widget workspace tabs. Read `src/components/schedule-command/README.md` in full before adding anything to it; every link into it is built by `src/lib/schedule/commandCentreHref.ts`, including tab params.

**Not present yet, and you will need it:** there is **no Supabase Storage usage anywhere in the codebase** (`photo_urls` columns exist but nothing uploads to them), and there is **no org-level public route** — `(public)/` has `browse`, `facility/[facilitySlug]`, `search`, `privacy`, `terms`, and nothing that represents an organization as a whole.

**Conventions that are load-bearing:**
- Next migration number is `027`. Never edit a migration that has run; append.
- Every new table: RLS enabled, `org_id` denormalized onto the row (even when derivable through a FK), member/superadmin policies, and **role-scoped writes** — structural things are owner/admin only, schedule editing is any member (read migration `024`'s header for exactly where that line falls).
- Public read policies must gate through publish state, never `USING (TRUE)` — see migration `026` and the projection-view technique it introduces for tables with sensitive columns.
- `src/types/database.types.ts` must be updated with any schema change. No `as any` — the codebase went to real effort to remove all 113 of them.
- Mobile-first is a hard requirement, not a follow-up.
- Per-directory `README.md` files are expected and current. This app is headed for a professional audit.
- **SMTP is not configured** and is a known launch blocker. Anything notification-shaped ships as in-app only; do not add an email dependency.

---

## Layer 0 — Seasons (build this first; everything else depends on it)

A season is an org-defined named date range: "Fall 2026", Sep 8 – Dec 20.

```
seasons (
  id, org_id,
  name, slug,                     -- UNIQUE (org_id, slug)
  starts_on DATE, ends_on DATE,   -- CHECK ends_on >= starts_on
  status TEXT CHECK (status IN ('planning','active','archived')),
  display_order INTEGER,
  ...timestamps
)
```

Decisions to make deliberately and record in the migration header:

- **Seasons may overlap.** Summer camps genuinely straddle a spring session. Do not add an exclusion constraint. Because they overlap, "the current season" is not derivable from `now()` alone — resolve it as *explicitly selected → else the active season containing today with the latest `starts_on` → else none*, and put that rule in one shared helper (`src/lib/seasons/current.ts`), never inline at call sites.
- **Seasons are org-level, not facility-level.** An org publishes one seasonal brochure across its buildings; that's the whole point of "centralize across facilities." If a facility needs its own calendar, that's a *filter* on a season, not a second season.
- **Sessions get `season_id UUID REFERENCES seasons(id) ON DELETE SET NULL`, nullable.** Sessions already carry `valid_from`/`valid_until`, so you could infer season membership from date overlap — don't rely on inference alone. Staff need to be able to say "this belongs to Fall" for something whose dates spill by a week. Inference is the *default* offered in the UI; the column is the truth. Sessions with `season_id IS NULL` keep working exactly as today — that flexibility-preserving default is the pattern every prior migration here has followed.

Ship with: season CRUD (owner/admin), a season picker in the command centre header that filters the schedule to a season's range, and "duplicate season" (copy the shape, not the sessions — session rollover is out of scope, and say so).

---

## Layer 1 — The event toggle and the event calendar

### The toggle

`sessions.is_event BOOLEAN NOT NULL DEFAULT FALSE` — the flag itself, on the session, cheap to index and filter.

The presentation payload lives in a **1:1 sidecar**, not on `sessions`:

```
session_features (
  id, org_id, session_id UUID UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT,            -- overrides the schedule group's name on feature surfaces
  summary TEXT,          -- one line, for a calendar cell
  description TEXT,      -- long copy, for the brochure
  image_url TEXT,
  link_url TEXT, link_label TEXT,
  event_category TEXT,   -- drives color/icon; org-defined or a small fixed taxonomy — your call, justify it
  accent_color TEXT,
  ...timestamps
)
```

Why a sidecar rather than six more columns on `sessions`: **both** this feature and the brochure need exactly the same content (title, description, image, link), the payload is sparse (a tiny minority of sessions are ever featured), and `sessions` is the hottest table in the expansion path. One content record, two channels. Turning a toggle off must **not** delete the payload — staff who un-feature an event and re-feature it next month should get their copy back.

Brochure candidacy is the second toggle on the same row: `sessions.in_brochure BOOLEAN NOT NULL DEFAULT FALSE`. Same pattern, different channel.

Both toggles belong in `SessionForm.tsx` behind progressive disclosure ("Feature this session"), **and** as a one-click action in `SessionActionsMenu.tsx` (the ⋯ overlay), because the realistic flow is "I already built the schedule; now make three of these events."

### One-off events are a real gap

`src/lib/rrule/validate.ts` only ever emits `FREQ=DAILY` or `FREQ=WEEKLY`, and `RRuleBuilder` only parses those back. A genuine one-off ("Halloween Howl, Oct 31, 6–9pm") has no first-class expression today — the closest is a session with `valid_from = valid_until`. Fix this properly: add a **one-time** mode to the RRULE builder and validator that produces a single-occurrence rule, and make it the *default* when the event toggle is on. Verify `expandSessions` and `session_exceptions` behave correctly for it before building anything on top.

### The calendar itself

Month-at-a-glance, org-wide by default, filterable to facility/department/season. This means **the expansion pipeline must stop being week-shaped**:

- Generalize `/api/sessions/expand` to `rangeStart`/`rangeEnd` (keep `weekStart` working as an alias so nothing breaks), plus `isEvent=true` and `seasonId` filters. Keep the "at least one scope filter" guard, and add a **maximum range** guard — a month is fine, an unbounded year of an org's whole schedule is not.
- Generalize `useWeeklySchedule` into a range hook. **Watch the query key**: every mutation in the command centre invalidates `"weekly-schedule"`. Either keep both hooks on that same key family so an edit refreshes the calendar too, or invalidate both explicitly — a stale month view after placing a session is exactly the bug this will produce if you skip it.
- `ExpandedSession` gains the feature payload (`isEvent`, `featureTitle`, `featureSummary`, `imageUrl`, `eventCategory`, `accentColor`) so no view needs a second fetch.

Then the view, as a **fifth schedule template**: `"events"`.

- Add it to `ScheduleTemplate`, `ScheduleView`, `ScheduleHeaderBar`'s options, `TEMPLATE_OPTIONS` in `WidgetConfigurator`, and the `widget_configs.allowed_templates` CHECK constraint (migration `017` is your template for that last one, comments included). Gate the checkbox on the org actually having featured events, the way floorplan is gated on a published map.
- **Desktop:** a real month grid. **Mobile:** an agenda/day list, not a squeezed grid — same principle already applied to the weekly grid.
- **It must print.** The origin story is a printout on a wall. A dedicated print stylesheet producing a clean, legible one-page month — no nav, no chrome, org logo and accent color, readable at arm's length — is a first-class deliverable here, not a nicety.
- Under a `ScheduleEditingProvider`, the calendar gains the same affordances as the other views (add event on a day, ⋯ menu per event). Do not fork the component to make an editor.
- Month navigation is its own control — `WeekNavigator` is week-shaped; generalize or add a sibling, don't overload it awkwardly.

**Surfaces:** the widget (`/widget/[orgId]` with the `events` template), the public facility page, an **Events** workspace tab in the command centre, and a new public org-level route. That last one does not exist yet — you are creating the org-level public surface. Propose `(public)/org/[orgSlug]/events` alongside the brochure route below, check it against the existing `(public)` structure and `PublicNav`, and note the decision in the docs.

---

## Layer 2 — The brochure

This is the hard one, and the hard part is exactly what the idea's author identified: **knowing when to pull events, and when to stop.** Solve it with a three-state model, and make the states explicit in the schema. Do not try to make a live query be the brochure.

### Candidacy → membership → publication

1. **Candidacy is computed and live.** A session is a candidate for a season's brochure if `in_brochure = true` and its date range overlaps the season's. Nothing is stored. This is what the editor shows in a "Suggested" rail.
2. **Membership is explicit and stored.** The brochure editor has a *Pull candidates* action that materializes chosen candidates into `brochure_entries` rows. Staff then reorder, re-word, re-section, and remove. **This is the answer to summer-into-fall:** the season boundary changes what is *suggested*; it never silently changes what is *in* a brochure a human already assembled.
3. **Publication freezes.** Entries carry their own copy — populated from the source at pull time — so an entry is self-contained by construction. Editing the underlying session afterwards can never silently rewrite a brochure that has been printed. Show a "source has changed since pulled" indicator with a one-click re-pull; never auto-apply.

Add a fourth state so re-pulls stay useful: a dismissed entry is a **tombstone**, not a deletion. Staff who decide "Aqua Fit doesn't belong in the Fall brochure" must not have to un-toggle it globally and lose it from every other season.

```
brochures (
  id, org_id, season_id, facility_id NULL,        -- NULL = org-wide
  title, subtitle, slug,                          -- UNIQUE (org_id, slug)
  cover_image_url, intro_copy,
  accent_color, ...theme fields,
  status TEXT CHECK (status IN ('draft','published','archived')),
  published_at, ...timestamps
)

brochure_sections (
  id, brochure_id, org_id, title, blurb, display_order, layout
)

brochure_entries (
  id, section_id, org_id,
  source_type TEXT CHECK (source_type IN ('session','schedule_group','custom')),
  session_id NULL, schedule_group_id NULL,        -- CHECK: exactly one set, or neither for 'custom'
  title, description, image_url, link_url, link_label,   -- snapshot at pull time, then freely edited
  status TEXT CHECK (status IN ('included','dismissed')),
  display_order,
  source_pulled_at,
  ...timestamps
)
```

`schedule_groups` gets `in_brochure BOOLEAN NOT NULL DEFAULT FALSE` too — a brochure lists *programs* ("Lane Swim, Mon/Wed/Fri, $6") at least as often as it lists one-off events, and schedule groups already carry a description and `photo_urls`. Both candidate types flow through the same pull.

### Editor and output

- The brochure editor is a workspace, not a form: sections you can add/reorder, drag entries between them, the suggestion rail beside it, live preview. Reuse `dnd-kit` — it is already a dependency and already wired for the schedule map builder.
- **Output is print-first.** A brochure that can't produce a clean printable document has missed the point. Deliver a print stylesheet good enough that browser "Save as PDF" is a genuinely usable artifact; do not add a server-side PDF library unless you can argue it earns its weight, and say so either way.
- Public route: `(public)/org/[orgSlug]/brochure/[seasonSlug]`, readable only when `status = 'published'` — enforced in RLS, not just in the route.
- The org's existing accent color (`--org-accent` / `widget_configs` colors) themes it. "Adapted to meet the org's brochure needs" means cover, intro copy, section structure, per-entry copy, and theming — not a freeform page builder. Hold that line.

### Image upload is new infrastructure

Events and brochure entries both need images, and **nothing in this codebase uploads a file today**. You are standing up Supabase Storage: bucket, storage RLS policies (org-scoped write, public read for published assets), an upload component, size/type limits, and image optimization on render. Treat it as a proper sub-deliverable with its own README and a security note in `docs/SECURITY.md`, not an incidental. `photo_urls` on `facilities`/`schedule_groups` should end up using it too.

---

## Layer 3 — The organization control centre

The planning layer above the command centre. `/dashboard/schedule` answers "what's on Tuesday"; this answers "are we going to be ready for Fall."

Build it around season **milestones** and **tasks**:

```
season_milestones (
  id, org_id, season_id, name, due_on, display_order, completed_at, completed_by
)

season_tasks (
  id, org_id, season_id, milestone_id NULL,
  title, description,
  status TEXT CHECK (status IN ('todo','in_progress','blocked','done')),
  assignee_user_id NULL REFERENCES auth.users(id),
  due_on DATE,
  category TEXT,                        -- schedule | brochure | events | staffing | other
  related_facility_id NULL, related_schedule_group_id NULL, related_brochure_id NULL,
  display_order, completed_at, completed_by, ...timestamps
)
```

Two things make this more than a to-do list, and both are required:

1. **Derived readiness, not just checkboxes.** Compute real signals from tables that already exist and surface them as progress: *"12 of 15 schedule groups have sessions inside Fall 2026"*, *"4 featured events have no image"*, *"the Fall brochure has 0 entries and prints in 11 days"*, *"3 facilities have no published schedule for this season."* These are the reason a director opens the page. Put every one of these in one queryable module (`src/lib/seasons/readiness.ts`) so the dashboard, the control centre, and any future digest all read the same definitions.
2. **Deep links into the work.** Every task and every readiness signal links straight to the thing — `commandCentreHref()` for schedules, the brochure editor for brochure gaps. Never a dead-end status page.

Also: a **checklist template** so creating "Winter 2027" seeds the same twenty tasks with dates offset from the season start, rather than retyping them. That is the actual recurring value.

Permissions: owner/admin create seasons, milestones, and assign tasks; members can see their own assignments and complete them. Enforce in RLS *and* the route layer, per migration `024`'s reasoning. Assignment notifications are **in-app only** — no SMTP.

Routing and navigation: this is a new top-level dashboard destination. Decide its name and route deliberately against the existing vocabulary (the schedule page is already "the command centre" internally and "Manage" in the nav — do not ship two things both called a command centre). Mobile bottom nav already carries Home / Manage / Browse / Data; adding a fifth item is a real constraint, not a free action. Justify whatever you choose in the README.

---

## Sequencing

Ship these as separate reviewable commits, in this order. Do not start one before the previous is verified end-to-end in the running app.

| Phase | Deliverable | Blocked on |
|---|---|---|
| A | `seasons` + `sessions.season_id`, CRUD, season picker in the command centre | — |
| B | Range-based expansion (replaces week-bound API/hook), `is_event` + `session_features`, one-time RRULE mode, `events` template across widget/public/command centre, print stylesheet | A |
| C | Supabase Storage + image upload | B (event images need it) |
| D | Brochure schema, editor, candidacy/pull/tombstone flow, public + print output | A, C |
| E | Control centre: milestones, tasks, readiness signals, checklist templates | A, D |

Phase B contains the one genuinely risky refactor (every schedule surface depends on that hook). Do it in isolation, verify all four existing layouts still render and still refresh after a mutation, then move on.

## Constraints

- Additive migrations only, starting at `027`, with header comments at the documentation standard of `011`, `013`, and `020` — including the reasoning for choices you *rejected*. A rollback file in `supabase/rollbacks/` per migration, matching the existing convention.
- RLS parity on every new table: `org_id` denormalized, member CRUD, superadmin, role-scoped writes, and publish-gated public read. No `USING (TRUE)`.
- The shared-component invariant holds: the event calendar is one component that gains editing under a provider. If you find yourself writing `EventCalendarEditor`, stop.
- Mobile-first for every new surface, including the brochure editor.
- `tsc --noEmit` and lint clean. `src/types/database.types.ts` regenerated. Zero new `as any`.
- READMEs: new ones for the events, brochure, and control-centre component directories; updates to `src/components/schedule-command/README.md`, `src/components/schedule/editing/README.md`, `docs/PLAN.md` (schema map, open threads), and `docs/SECURITY.md` (storage policies).
- No new heavyweight dependencies without an argument. `dnd-kit`, `rrule`, `date-fns`, and TanStack Query are already here — use them.

## Definition of done

A staff member can: create "Fall 2026"; flip an event toggle on a session they already built; see it on an org-wide month calendar that spans three facilities; print that calendar and tape it to a wall; pull that same event plus eight programs into the Fall brochure, re-word two of them, and publish it at a public URL; and watch a control centre tell them the Winter brochure is due in three weeks with four schedules still empty — and click straight through to fix one.

Verify it in the running app, not just in tests. Check the widget embed at small sizes and the print output in an actual print preview.
