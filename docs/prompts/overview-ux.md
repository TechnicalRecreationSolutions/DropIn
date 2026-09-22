# Prompt — make the Overview a page you can act on in five seconds

Run this against `src/app/(dashboard)/dashboard/page.tsx` and everything it
renders: `components/dashboard/`, `components/schedule-list/ScheduleListSection.tsx`.
Repeat until the stop condition at the bottom is met. One pass fixes one
coherent group and ends green.

## Who you are

A staff UX designer who has shipped operations tooling — the kind of screen
someone opens at 7:40am with a coffee in one hand, on a phone, before
unlocking a building. You are not decorating. You are removing the distance
between "what is going on" and "the thing I do about it".

You judge a screen by two questions, in this order:

1. **How many seconds until the user knows whether anything needs them?**
2. **How many taps from knowing to doing?**

Everything else — spacing, palette, delight — is downstream of those.

## Who the page is for

A recreation coordinator or facility manager who runs one to three buildings.
They already own a working tool: a hand-built lane-by-time Excel sheet
(`docs/prompts/crystal-pool-learning.md`). They open Dropin several times a
day, usually for under a minute, usually to answer one of these:

- *What is running today, and is the building covered?*
- *Did anything break — a double-booking, an unpublished schedule?*
- *Let me add or fix one session and get out.*

They do **not** open it to read counts. A count they cannot act on is a cost.

## The standard

### 1. The home screen shows the product, not an inventory of it

This is a scheduling app. If the home screen can be screenshotted and nobody
can tell it schedules anything, it has failed. The first fold owes the user a
**picture of time** — today, at the selected building, as shape rather than as
a number. A block you can see is worth more than a row you have to read, and
far more than a tally of rows.

### 2. Every number on the page is either actionable or gone

For each metric, answer out loud: *"If this number doubles, what do I do
differently?"* No answer means it is not a stat, it is decoration. Move it to
the page that can explain it, or delete it.

A number that names its subject beats a number that doesn't:
"Lap Swim x Public Swim, Lane 1" is a task. "Conflicts: 1" is an errand.

### 3. Nothing moves on its own

Auto-rotating stats are an anti-pattern here and everywhere. You cannot scan
them, you cannot compare them, you cannot point at one on a shared screen, and
WCAG 2.2.2 says the user must be able to stop them. If four numbers matter,
show four numbers. If one matters, show one — with its shape over time, which
is the part a single number cannot carry.

### 4. One idea, one surface

Two lists of the same objects on one screen is a bug even when both lists are
correct. If the same row can appear twice under two different status
vocabularies, at least one of them is lying to somebody.

### 5. Density earns the fold

A tile that is 120px tall to hold one integer is spending the most valuable
real estate in the app on whitespace. The first fold should carry: what day it
is, what is running, what is wrong, and the two buttons they came for.

### 6. Mobile is the real device, not the narrow case

A control that exists only after a horizontal scroll inside a table does not
exist. If a row's actions are reachable on a laptop and not on a phone, the
phone user has a read-only app.

### 7. A stat must be true

A capped query that silently returns 1000 rows and reports the count of those
is not a small bug — it is the page telling a confident lie. PostgREST caps a
`.limit(5000)` at 1000 without an error. Any number on this page that can be
wrong at scale gets paged or head-counted before it gets styled.

## The rubric

Audit each pass. For each item: state whether it currently holds, and if not,
whether fixing it belongs to this pass's coherent group.

### A. The first five seconds

- A1. Within the first fold the page names **today** — the date, in words.
- A2. Within the first fold there is a **visual** of today's schedule at the
      selected scope: occurrences drawn against a time axis, not listed.
- A3. That visual marks **now**, so "what is on right now" needs no arithmetic.
- A4. "Nothing on today" is drawn as a deliberate state, not as an empty box
      that reads like a failed load.
- A5. Anything wrong (a conflict, an unpublished draft that should be live) is
      visible without scrolling, and **names the thing**, not the count.

### B. Acting

- B1. The two most frequent creates — a session, a schedule — are buttons with
      labels, in the header, present on every viewport.
- B2. Every object drawn on the page is a link to the thing that edits it. A
      block in the today strip opens that session.
- B3. Row actions (edit, preview, duplicate, delete) are reachable at 390px
      without horizontal scrolling.
- B4. Permission-gated actions are absent, not disabled-and-confusing, for the
      roles that cannot use them (`src/lib/auth/roles.ts`).

### C. Honesty

- C1. One object, one status word. A schedule that reads "Modified" in one
      panel does not read "Published" in another on the same screen.
- C2. "Recent activity" means the activity log — verbs, actors, times — not a
      re-sort of the table above it.
- C3. Every count survives an org with more than 1000 rows of history.
- C4. A zero is phrased as a state ("No conflicts"), not as a failure ("0").

### D. Visual craft

- D1. Colour carries meaning consistently: the occupancy kinds
      (`src/lib/sessions/occupancy.ts`) keep the same colours they have on the
      schedule surfaces. A user does not learn two palettes for one concept.
- D2. Every colour-coded element is also distinguishable without colour
      (label, shape or position) and legible in dark mode.
- D3. The stat row is at most half the height it was, and each tile carries a
      small visual — a sparkline, a meter, a severity dot — not just a number.
- D4. Numbers are tabular-figure aligned; nothing reflows when a value ticks.

### E. Mobile

- E1. No horizontal page scroll at 390px.
- E2. The today visual is usable on a phone: it scrolls to now on open, and its
      blocks are big enough to tap.
- E3. The first fold at 390px still contains the date, the visual and the
      alert — not four tiles.
- E4. Nothing important sits under the fixed bottom nav.

### F. It still streams

- F1. `export const instant = true` still holds: no new blocking data access
      outside a Suspense boundary, and the static shell still paints first (see
      the header comment on the page).
- F2. The skeleton resembles the page it stands in for.
- F3. No new server round-trip in the critical path: the today strip reads
      through the **existing** `/api/sessions/expand` cache family
      (`SCHEDULE_RANGE_KEY`), so navigating to the schedule afterwards is free.

## The verdict on the page as it stands (2026-09-21)

Recorded so the next pass does not have to re-derive it:

1. **No schedule anywhere on the schedule app's home screen.** Four count
   tiles, a table of schedule *names*, and a list of the same names again.
2. **Two of the four tiles are unactionable**: "Published 4/6" restates the
   Status column below it; "Views (30d)" is a dead-end number that also
   **rotates** through four different metrics on a 3.5s timer.
3. **"Conflicts: 1" names nothing.** The fix is one click away and the page
   will not say which two sessions, in which space.
4. **"Recent activity" duplicates the table above it** — the same rows,
   re-sorted by `updated_at` — and labels them with a *different* status
   vocabulary ("Published/Draft" vs "Modified/Unfinished"), so Lap Swim reads
   as two different states on one screen.
5. **`activity_log` is read with `.limit(5000)`**, which PostgREST silently
   truncates to 1000. The "Activity (30d)" number is a ceiling, not a count.
6. **At 390px the row actions are behind a horizontal scroll** inside the
   table, and the four tiles consume the entire first screen.
7. **The header is a bare facility name.** No date, no actions.

## Pass 1 — 2026-09-21

All seven findings above were addressed. What shipped:

- **A today ribbon** (`components/dashboard/today/`): today's occurrences at the
  selected facility drawn against a continuous time axis, with a "now" marker,
  each block a link to that session's editor. It reads through the existing
  `useScheduleRange` cache family, so it costs the page nothing on the server
  and warms the schedule for the next navigation. The arithmetic is in
  `todayGeometry.ts`, apart from the component and checkable without a browser.
- **An alert row** (`OverviewAlerts.tsx`) that names the first conflict —
  "Lap Swim × Public Swim in Lane 1 · 9:00 a.m." — and states the all-clear when
  there is nothing to say.
- **The stat row halved**, and cut to what leads somewhere: schedule views with
  a sparkline, **this week** as seven bars, and the change count. The rotating
  ticker is deleted; "Published 4/6" is gone and what it was really reporting is
  now a sentence in the alert row.
- **The week tile is the only one that looks forward**, and the only one whose
  link lands on exactly what it describes — the command centre opens on the
  current week. Its hint names the empty days rather than restating the total,
  because a gap is the one thing on that tile anybody acts on. It shares its
  fetch with the ribbon above (same week, same scope, one request), and that
  request is the same query key the command centre opens with, so clicking
  through renders from cache.
- **"Latest changes"** reads `activity_log` — verbs, actors, times — instead of
  re-listing the schedules from the table above under a second status
  vocabulary.
- **A phone layout for the schedule list**: cards with real Edit / Preview /
  Duplicate / Delete targets, replacing a table whose actions sat past the right
  edge of the screen.
- **The activity count pages** past PostgREST's silent 1,000-row cap
  (`lib/activity/queries.ts`).

Five defects were found by looking at the built page rather than by reading it:

1. **Finished sessions were invisible.** `bg-muted` blocks on the ribbon's own
   `bg-muted/40` backdrop — the whole morning disappeared off a strip that still
   claimed to cover the day.
2. **The midnight tick read "12:00 PM".** `minutesToTime` is defined over a
   clock, and 1440 is not a clock reading.
3. **The ribbon opened on empty time at night.** Centring on "now" is right
   while the day still has something in it, and exactly wrong once it does not.
4. **A zero-length occurrence was drawn as running until midnight**, and
   reported as "on now" for hours.
5. **The create buttons were hidden from coordinators.** `session:write` is
   department-scoped, so `can()` without a department answers false — the page
   now asks `isReadOnly()`, as the command centre and bottom nav already do.

Two harness locators were also wrong in a way that passed: the topbar's
icon-only activity link and the sidebar's Analytics item both matched bare href
selectors, so the tile assertions were measuring chrome.

### Deliberately not done

- **D1, partly.** Every data mark added here — the sparkline, the week bars, an
  untinted ribbon block — uses `--viz-cat-1` from `globals.css`, the validated
  categorical slot 1 the analytics charts already draw with, so the sparkline
  and the full `ViewsChart` it links to are literally the same line. The first
  attempt used shadcn's `--primary`, which is greyscale, encodes nothing, and
  put the Overview's sparkline in a different colour from the chart one click
  away. A session's own `templateColor` still wins, so a schedule that is green
  on the public page is green here.

  What is *not* done is occupancy kinds: drop-in, program, rental and closure
  have no colour anywhere in the app, so the ribbon cannot be consistent with a
  palette that does not exist yet. The blocks distinguish themselves by name and
  time instead.

  The ribbon deliberately does not reuse `getSessionCardStyle` (the public
  schedule views' tint): that one mixes toward literal `white` and is only
  defined inside `.org-theme`, so it renders light-on-light in dark mode.
- **A hover layer on the sparkline.** The tile is a link to the analytics page,
  where the same series has a crosshair, a range picker and a CSV export. A
  tooltip on a 28px sketch would be a worse version of the thing one tap away.
- **E4 is inherited, not asserted.** The dashboard layout already sets `pb-24`
  below `lg`, which is what keeps content clear of the fixed bottom nav.
- **Sorting on the phone card layout.** The rows arrive sorted by the same
  comparator the table uses; four sort controls would compete with the four
  actions that do something.

## Stop condition

A pass ends when all of the following hold:

- Every rubric item is either satisfied or has a one-line reason recorded here
  for why it is deliberately not.
- `npx tsc --noEmit`, `npx eslint src` and a `next build` (with `NEXT_DIST_DIR`
  set, so it cannot clobber a running dev server) are clean.
- The verification harness for this page passes, includes at least one
  assertion per rubric section A-E, and at least two of its assertions have
  been **falsified** on purpose to prove they bite.
- Screenshots at 1440px and 390px are taken, and the first fold of each is
  described in one sentence a coordinator would agree with.
