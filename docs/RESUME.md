# Resume here

Open this first; it points at everything else.

**Last updated 2026-09-21**, at the end of the session that rebuilt the Overview
around today (first box below) and then **committed, merged and deployed eight
tracks' worth of work that had been sitting uncommitted** — see
[State right now](#state-right-now) for what that means for production, and
[Where the branch is](#where-the-branch-is) for why it is one commit.

Those eight: the Overview rebuild, the spreadsheet canvas on the Map view, the
analytics rebuild, departments, department operating hours, all-day sessions,
statutory holidays, spaces zones and the revived-form fix. Before that day:
multi-account staff roles, and a resident directory (`/find`).

This file is the single entry point. The per-track `RESUME-*.md` files are
historical records of finished work, not live handoffs — see
[Related docs](#related-docs).

---

## Where the branch is

Everything below that was uncommitted landed in **one commit, `de89572`**, on
the branch `feat/pending-2026-09-21`, fast-forwarded into **`main`** and
**pushed** (`main` is now `2637d2f`). Vercel auto-deploys from `main`, so this
is live.

Before the push the whole pending suite was re-run green against one server:
**711 assertions across 12 harnesses**, 0 failed — aq 11, ar 26, as 78, at 59,
au 52, av 49, aw 165, ax 78, ay 72, q 52, aa 28, ac 41.

It is one commit rather than eight because the eight tracks share files —
`dates.ts`, `schedule.types.ts`, `expand.ts`, and the ~25 page components the
copy pass touched — so splitting them after the fact would have meant inventing
boundaries that do not build. The commit message enumerates what is in it.

---

## The Overview, rebuilt around today — 2026-09-21, DEPLOYED

`verify-ay` passes **72/72** (25 logic-only, the rest in a real browser across
an owner and a coordinator context, at 1440px and 390px). Two assertions were
falsified to prove they bite. `tsc`, `eslint src` and `NEXT_DIST_DIR=.next-verify
next build` are clean. **No migration.**

`/dashboard` used to open with four count tiles, a table of schedule names, and
a second list of the same names underneath badged with a *different* status
vocabulary. It never showed a schedule. It now opens with **today**: the date in
words, anything wrong named in a sentence, and a time-axis ribbon of today's
occurrences at the selected facility, each block a link to that session.

The rubric it was built against, the verdict on the old page, the five defects
found by looking at the built page, and what was deliberately *not* done:
[`docs/prompts/overview-ux.md`](prompts/overview-ux.md).

**Decisions worth not relitigating:**

- **The ribbon is a client component reading `useScheduleRange`.** It shares the
  `/api/sessions/expand` cache family with every other schedule surface, so the
  page pays nothing on the server for it and the next navigation to the schedule
  is already warm. Expanding it server-side would be a second expansion of the
  same data in front of the static shell.
- **A problem names itself.** "Conflicts: 1" was an errand; the alert row says
  which two schedules, in which space, at what time. The all-clear renders too —
  silence is indistinguishable from the page not having checked.
- **"Latest changes" is `activity_log`, not a re-sort of the table.** Two lists
  of the same objects on one screen is a bug even when both are correct, and the
  old pair disagreed: one schedule read "Modified" above and "Published" below.
- **The create buttons ask `isReadOnly(role)`, not `can(…, "session:write")`.**
  That permission is department-scoped, so `can()` without a department answers
  **false for a coordinator** — the role whose whole job is filling schedules.
  Same reasoning the command centre and bottom nav already carry.
- **The activity count pages with `.range()`.** PostgREST caps a response at
  1,000 rows with no error, so the old `.limit(5000)` reported a ceiling as a
  total. Falsifying the fix reports 997 where the truth is 1,060.
- **The phone gets cards, not a narrowed table.** A row whose Edit sits past a
  sideways scroll inside a card is a read-only row.
- **The stat row is three tiles, one of which looks forward.** "This week" draws
  seven bars and names the empty days; it shares one `/api/sessions/expand`
  request with the ribbon, and that request is the key the command centre opens
  with, so the link out of the tile renders from cache.
- **Data marks use `--viz-cat-1`, never shadcn's `--primary`.** The latter is
  greyscale and encodes nothing; the former is the validated slot the analytics
  charts already draw with, so the Overview's sparkline and the full ViewsChart
  it links to are the same line.
- **Nothing rotates on a timer.** The `AnalyticsTicker` is deleted: you cannot
  scan, compare or point at a number that changes under you, and WCAG 2.2.2 says
  the user must be able to stop it.

**Five bugs the built page showed that review had not:** past blocks drawn
`bg-muted` on a `bg-muted/40` backdrop (the whole morning invisible); the
midnight tick labelled "12:00 PM"; the ribbon opening on empty time after the
last session of the day; a zero-length occurrence stretched to midnight and
reported "on now" for hours; and the coordinator gating above. Two harness
locators were also passing against the topbar and sidebar rather than the tiles
they named.

---

## Spreadsheet canvas on the Map view — 2026-09-21, DEPLOYED

`verify-aw` passes **165/165** (48 logic-only, 61 over HTTP, 56 in a real
browser across four contexts, including a read-only one and a touch one).
Several assertions were falsified to prove they bite. `tsc`, `eslint src` and
`next build` are clean. **No migration** — every gesture writes columns that
already exist.

The staff Map view is a lane x time canvas with Excel's gestures: click and
shift/Ctrl-click to select, drag to move between lanes and times, drag an edge
to resize, drag the corner handle sideways to extend a session across lanes,
Ctrl-C/X/V (paste keeps the copied range's lane and minute offsets and lands on
the last-clicked cell), Ctrl-D to repeat a block below itself, Delete, arrow
keys to nudge, and Ctrl-Z/Ctrl-Shift-Z. Dropping a block on a day chip changes
its weekday. Alt scopes an edit to one date.

Design, the gesture table and the traps: [`src/components/schedule/editing/README.md`](../src/components/schedule/editing/README.md).
The rubric it was polished against: [`docs/prompts/canvas-gesture-polish.md`](prompts/canvas-gesture-polish.md).

**Decisions worth not relitigating:**

- **Direct manipulation replaces the confirm dialogs, on this surface only.**
  A spreadsheet undoes rather than confirming, so writes land immediately and
  `CanvasUndoBar` carries the account — including the **scope line** ("every
  Tuesday", "this week only", "the whole recurring series"). That line is the
  dialog's job moved after the fact and is not decoration. Grid, List and every
  read-only surface keep the dialogs untouched.
- **An edit replaces, it never collapses** (`src/lib/schedule/gridEdits.ts`).
  Dragging the Wednesday block of a Mon/Wed/Fri series writes `BYDAY=MO,TH,FR`;
  dragging the Lane 2 block of a Lanes 1-4 session writes 1, 6, 3, 4. The old
  dialog path rebuilt the rule as just the drop target, collapsing a three-day
  series to one day — tolerable behind a confirm, not behind a drag.
- **The undo comes from the server**, computed from the rows as they were at
  write time and returned by `POST /api/sessions/batch`. A client-built inverse
  is wrong the first time two people edit the same week, and wrong by writing
  its guess over a colleague's save.
- **Writes are optimistic, and the optimism describes the SERVER's change**,
  not the pointer's. A time drag writes `dtstart`, so every occurrence of the
  series moves; only the dragged occurrence changes day. Undo and redo restore
  a snapshot rather than recomputing, because the snapshot either side of an
  edit *is* what undoing and redoing it produce.
- **Alt = this date, not this week.** Date-scoped `session_exceptions`, unlike
  the week-scoped `POST /api/sessions/[id]/exceptions`. Alt across lanes or days
  is refused with a reason rather than approximated.
- **The batch is a compensating rollback, not a transaction.** PostgREST has no
  cross-statement transaction; a failed op replays the inverses of what landed
  and the response says whether that itself succeeded.

**Two refactors came with it, and both are load-bearing:**

- `POST /api/sessions`' whole body moved to `src/lib/sessions/write.ts`
  (`writeSession`), and the drag-patch to `patchSession` in the same file. Both
  routes are now HTTP shells over them. The batch route needs identical
  behaviour for a pasted block, and a second copy would be a second copy of the
  operating-hours snapshot rule, the template/space scoping and the two "absent
  means leave it alone" contracts.
- `SessionModal` now closes on **Escape**. It never did — backdrop and X only —
  which went unnoticed until Escape also meant "clear the selection".

**Six bugs the harness caught that review had not:**

1. **Every undo was rejected as invalid input.** Postgres returns `dtstart` as
   `…+00:00` and `dtend_time` as `HH:MM:SS`; the route's own schema demands a
   `Z` suffix and `HH:MM`. `toZulu()` normalises both — digits copied, never
   converted.
2. **The canvas keyboard fired underneath open dialogs.** The guard asked
   whether the event *target* sat inside a `role="dialog"`, and the session
   modal opens with focus still on `body`.
3. **dnd-kit's `transform` was never applied**, so a dragged block did not move
   at all — it faded and jumped on refetch.
4. **`transition-all` animated `top`/`height`/`transform`**, so the block eased
   toward the pointer a beat behind it. Only the shadow is eased now.
5. **A move within one lane optimistically stripped the session's only space**
   (`swapSpaceOnOccurrence` was missing the `from === to` guard `moveSpace`
   opens with). The block jumped to the General column, its id changed with the
   column, and the selection was pruned out from under the next keypress.
6. **`useDndMonitor` took down every read-only render.** It throws outside a
   `DndContext` rather than degrading, and `WeeklyScheduleMap` is also the
   public widget and facility page. The drag is published through the canvas
   context by whoever owns the DndContext instead. `verify-aw` §11 now drives
   the same component as an `aux` staffer specifically to catch this class.

### The week panel — the new home for everything you read

`schedule-command/WeekPanel.tsx`, a right-hand sheet opened from two buttons in
the toolbar strip above the grid. The left rail is now **only** session
templates; nothing else competes with it.

- **Overview** — what the week contains and how much of it. Per-kind totals
  (drop-in, program, rental, closure) in two columns that are deliberately
  different numbers, plus open vs unprogrammed hours and a per-day bar.
- **How to edit** — the gesture reference that used to sit under the grid.

**Two kinds of hour, and neither is a sum of durations.** "Hours" is the
*union* of a kind's occurrences, so two rentals in two lanes at the same hour
count once — the answer to "when is the building doing this". "Space-hours" is
Σ duration × spaces held, so a two-hour booking of four lanes is eight — the
answer to "how much of what we have did it consume". A naive sum is the wrong
third answer: it double-counts anything parallel, and a busy Saturday can then
report more hours than the day has. `verify-aw` §0b asserts exactly that case
and it was falsified to prove it bites.

**Three scoping decisions worth not relitigating:**

- **The overview is the whole FACILITY's week**, not the open schedule group's.
  The rental eating into a drop-in block usually lives under a different group,
  and a total scoped to the editor would quietly omit it. Same query-key family
  as every other surface, so an edit refreshes it.
- **Drop-in figures are what is LEFT**, because `/api/sessions/expand`
  subtracts exclusive claims before anyone sees them (046). "Drop-in: 18h"
  means eighteen hours actually available to the public. It must never be fed
  the `subtract: "none"` feed the shadow panel uses.
- **Open hours come from 058 *and* 059.** `useDepartmentWeekHours` applies
  holiday overrides on top of the recurring week, because Christmas Day is a
  Monday and counting it as open would overstate capacity in the one week
  someone is most likely to check. Absence means opposite things in the two
  tables and both are honoured.

When the department has no operating hours the whole open/unprogrammed block is
**hidden**, not zeroed — a denominator nobody set is not a number worth
printing — and the panel says which of the three reasons applies.

The live selection count stayed on the page (`CanvasSelectionChip`): a
reference list is read once, but a count changes with every click.


**Known gaps, all deliberate, none blocking:**

- **Resizing by touch.** Tap-to-select and drag-to-move work and are asserted
  (§12); the edge grips are 6–10px and a 44px target is not achievable on a
  24px block. Touch resizing wants a different interaction (tap, then pick a
  time), which is its own piece of work.
- **A lane collapse is not announced.** Dropping onto a lane the session
  already holds merges the two, and only the refetch shows it. `timesIgnored`
  (058) *is* announced, because that one leaves the block looking unmoved.
- **Auto-scroll during a drag** is dnd-kit's default and is not asserted.
- **Marquee (rubber-band) selection is not built.** Shift-click already takes
  the lane/time rectangle between two blocks; `selectWithin()` is on the API
  for whenever a surface wants to draw one.
- **Only the Map view is a canvas.** The Grid view has no time axis — it is
  stacked cards — so there is nothing there to resize against.
- `handleConfirmReschedule` still collapses a multi-day series on the dialog
  path. Nothing reaches it now (Grid and List cannot drag), but it is wrong and
  should move onto `moveDay` when someone next touches it.

---

## Departments — rebuilt 2026-09-21, DEPLOYED

The page that 058 and 059 both hang their editors off
(`/dashboard/facilities/[id]/departments/[id]/edit`) had become one column of
three tall cards — a name field, seven days of time inputs, a dozen holidays
with three radios each — and three Save buttons scattered down it. Reading
"when is Aquatics open?" meant scrolling past every control that could change
it, and a week of typed hours could be abandoned by walking away from the one
Save button below the fold.

It is now a summary plus three sections
(`components/department/DepartmentEditorShell.tsx`):

- **Three tiles above the fold** — status, the week in one line
  (`summarizeWeek`), the year's confirmed holidays — and each tile opens the
  section that can change it.
- **Sections, not scroll.** The open one is in the URL hash (`#hours`), read
  through `useSyncExternalStore` rather than an effect, so a reload and a deep
  link both land in the right place. Panels are **hidden, not unmounted**, so
  switching never discards half-finished edits.
- **Unsaved work is visible from anywhere.** Each editor reports its dirty
  state through `components/department/section-dirty.tsx`; the tab gets a dot,
  a banner names the section, and `beforeunload` catches a close. Details now
  saves **without navigating away** (`redirectTo={null}`), because a redirect
  would have taken the other sections' unsaved edits with it.
- **Hours:** an open/closed switch per day (it remembers the day's hours while
  it is off), a per-day total like `15h` to catch an AM/PM slip, a live
  one-line summary of the draft, and "copy Monday to every day".
- **Holidays:** one `<select>` per date instead of three radios, grouped by
  month, with "observe all N statutory dates" and a "only the observed" filter.

**The landing page** (`/dashboard/departments`) went the same way. It was a
stack of full-width rows that said only a name, a description and a status —
nothing about what a department *had*, and the only thing a click could do was
edit. It is now the Facilities grid's cards, one step smaller
(`DepartmentsPanel.tsx`): the body opens that department's schedule, the stats
are its own schedule and space counts, and the footer is the call to action —
its week from `summarizeWeek`, or an amber **"Set operating hours"** linking
straight to `…/edit#hours`. Missing hours is the one setup gap nothing else
surfaced, and it is why a session cannot be set to run "the whole time we're
open". The counts cost one query each for the whole org rather than a count per
card; the unassigned callout now filters those same rows.

`node scripts/verify/verify-au.mjs` — **52/52** in a real browser, including
the two assertions that matter: closing a day with the new switch removes that
day's rows **in the database** and leaves the other five alone, and a card's
counts are checked against a second department that has none, so they cannot
pass by being a constant.

---

## Statutory holidays — built 2026-09-21, MIGRATION 059 APPLIED

**Migration `059` is applied**, and `verify-at` passes **59/59** against the
live database (not just the 26 logic-only ones). Still uncommitted.

Two of those assertions were red on the first full run and **neither was a
policy bug**: the harness signs its `anon` client in as the fixture owner to
mint a session cookie, after which every "can an outsider see this?" read
answers as a member. It now uses a second, never-signed-in `publicAnon` client
— worth remembering before reading any future "anonymous caller can see X" red
as a leak.

Holidays override the weekly operating hours for specific dates, per
department. Three answers per date — closed, different hours, or open as
usual — and a session that follows the hours honours all three. Dates come
from a **computed catalogue** (`src/lib/schedule/holiday-catalogue.ts`), never
a seeded table: it derives each province's statutory days from rules, so no
migration ships in December and nothing expires.

**Decisions worth not relitigating:**

- **The catalogue suggests; staff decide.** Nothing is stored until a human
  ticks it, and the UI says the list is a starting point, not a legal one.
  Being wrong about a province costs one unticked checkbox — which is the only
  reason it is safe to have an opinion at all. BC and AB were checked
  carefully (those are the provinces with facilities); the other eleven are
  good-faith and unverified.
- **`normal_hours` is stored even though it resolves to nothing.** It is how
  the checklist remembers "we work that day" versus "nobody has looked". Drop
  it and staff re-examine twelve dates every visit.
- **Per department, not per org.** Measured first: every facility has one or
  two departments, so the duplication is a few rows and one "copy to…" click,
  and it buys each department an independent answer.
- **⚠️ Absence means the OPPOSITE of what it means in 058.** No
  `department_hours` row for a weekday = closed. No `department_holidays` row
  for a date = ordinary. Both tables' headers say so; do not "fix" either.

Not built: nothing further is planned here. US states would slot into the same
`Jurisdiction` union and rule table.

---

## Operating hours + all-day sessions — 2026-09-21, DEPLOYED

**Migration `058` is applied.** `verify-as` passes **78/78** against the live
database, and nine deliberate falsifications each turned it red. `tsc`,
`eslint src` and `next build` are clean. **Nothing is committed yet** — it is
all still in the working tree.

A department now has a weekly pattern of open/close windows
(`department_hours`), and a session can carry `follows_operating_hours` to say
"I run the whole time we are open". The flag is a **pointer, not a prefill** —
occurrence times resolve at read time in `expandOccurrenceTimes()`, so
changing a department's hours moves every session following them with nothing
to re-save.

**Verifying.** The harness needs `--experimental-strip-types`, because
section 0 imports the app's real TypeScript modules:

```bash
node --experimental-strip-types scripts/verify/verify-as.mjs              # 78, needs a server
node --experimental-strip-types scripts/verify/verify-as.mjs --logic-only # 28, needs nothing
```

`--logic-only` runs section 0 alone — the real `expand.ts`, no database, no
server, no migration. It is the fastest signal after touching the expansion
code, and a failure there says the problem is arithmetic rather than schema or
RLS. The `@/` alias and `rrule`'s ESM build are wired up for it in
`scripts/verify/_alias-hooks.mjs`; that hook is reusable by any future
logic-only harness.

**Three things the database half caught that the logic half could not:**

1. The snapshot was being computed **client-side in SessionForm**, so any
   other caller (duplicate, space move, import) stored whatever times it had
   in hand — making the fallback only as good as the caller. Moved into
   `POST /api/sessions`, which now overwrites the payload's times whenever the
   flag is set. This is the one real product bug the run found.
2. Two harness assertions that were **passing for the wrong reason**. A
   `program` vs a `drop_in` is deliberately not a conflict under 046's
   residual rule, so the original section-7 check proved nothing; it now uses
   two exclusive claims. And the conflict checks only ever exercised the
   *other* side's hours lookup — breaking the **candidate's** lookup still ran
   green until lanes 3 and 4 were added.
3. An anonymous read is gated by the **per-week review** (037) and
   `sessionWeekStart` is **Sunday**-based, so an approved row keyed on the
   Monday matches nothing. Both are now asserted explicitly, in both
   directions, so the gate can never become the silent reason a future run
   "passes".

**Four decisions worth not relitigating:**

- **Windows are rows, not two columns.** Pools close midday. A single
  open/close pair per weekday would make an all-day session claim the hours
  the building is locked — wrong exactly where the feature is supposed to
  help. A split day therefore produces **two occurrences**, and
  `ExpandedSession.key` gained a `_w1` suffix to keep them distinct.
- **Closed is the absence of rows.** No `is_closed` flag, no NULL-time row.
- **Stat-holiday / date overrides are deliberately NOT built.** Not a
  regression: a fixed-time session shows up on Christmas today too, and
  `session_exceptions` already cancels a date by hand. When it is built it
  resolves in `resolveOperatingWindows()` and nothing else moves.
- **`dtstart`/`dtend_time` stay NOT NULL** for a following session — an RRULE
  anchor plus a stale-tolerant snapshot. When hours cannot be resolved at all,
  expansion falls back to them rather than emptying the schedule. Stale beats
  vanished.

This does **not** reverse migration 014's warning about fake all-day sessions:
that was about `schedule_type = 'continuous'`, which has no discrete
occurrences at all. These still do, so `session_exceptions` keeps working.

Two loose ends, both deliberate:

- The hours editor has its **own save button**, separate from the department
  form's. Two saves on one page is not lovely; merging them would mean the
  department form owning a child table it otherwise knows nothing about.
- Session **templates** cannot default to all-day yet. The toggle is on the
  session form only.

Details live in the migration header and `src/lib/rrule/README.md`.

---

## Multi-account staff roles — shipped 2026-09-18

Four roles: `owner` / `manager` / `coordinator` (department-scoped) /
`aux` (facility-scoped, read-only). `admin` and `member` are retired — there
were zero rows of either, which is why the restructure was free.

Design and decisions: [`docs/PLAN-staff-roles.md`](PLAN-staff-roles.md).

**Migrations `055` and `056` are applied.** `verify-al` passes 41/41, five of
its assertions were falsified to prove it is sensitive, and the new pages were
rendered in a browser as each role (32 more checks). Nothing is committed yet.

Two things to know:

- **Billing is now owner-only** (was `owner|admin`). A Manager cannot cancel
  the subscription or delete the org — that was the point of keeping Owner
  separate.
- **Invitations are created but not emailed.** `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL` are still absent from `.env.local`, so the invite dialog
  falls back to "copy this link", which works fine. Note this is *not* launch
  blocker 1 below: that one is Supabase's own mailer, which the invitee still
  needs in order to confirm a new account, and it caps staff onboarding at
  roughly two people an hour until custom SMTP is configured.

While applying `055` it also closed a real hole: migration 024 deliberately
left `sessions`, `session_exceptions` and `session_spaces` writable by any org
member, which was correct when `member` meant "read plus schedule editing". An
`aux` account is a member, and the publishable key is in the browser bundle —
so before this, a lifeguard account would have been able to delete every
session in the organization through PostgREST.

---

## State right now

**Everything is pushed and deployed.** `main` is `1f392c2`, pushed
2026-09-21; Vercel auto-deploys from it and production answered 200 on `/` and
`/find` afterwards.

**Read this before assuming what is live.** That push was not one feature. Eight
tracks had been sitting uncommitted across several sessions and all shipped
together in `de89572`: the Overview rebuild, the spreadsheet canvas, the
analytics rebuild, departments, operating hours, statutory holidays, spaces
zones, and the revived-form fix — plus the copy pass across ~25 pages. They
shared too many files to split after the fact. If something looks different in
production and you only remember one of those landing, this is why. Each has its
own section above.

Verified before the push, on 2026-09-21 unless stated:

- Migrations **through `059`** are applied to the hosted database (`058` and
  `059` proven applied by `verify-as`/`verify-at`, which cannot pass without
  them).
- The pending suite re-ran green against one server: **711 assertions across 12
  harnesses**, 0 failed.
- `tsc`, `eslint src` and `next build` pass on `main`.
- `npm audit --omit=dev` reports **0 vulnerabilities**, re-measured 2026-09-21.
- Next **16.3.4**, re-checked 2026-09-21.
- Live at `https://drop-in-ten.vercel.app`; Vercel auto-deploys from `main`.

**25 verification harnesses cannot run at all** and are not part of that 711.
They insert `org_memberships` with `role: "admin"`, which migration 055 removed
and a CHECK constraint rejects; the insert fails silently, so every request then
403s with `"No organization found"` — a fixture bug that reads like a product
one. `verify-q`, `verify-aa` and `verify-ac` were repaired (one line each,
`"admin"` → `"owner"`); the rest were left alone. See `scripts/verify/README.md`.

Data, measured 2026-09-16 and **not re-measured since**: 4 facilities (3
published), 7 sessions, **none of them public** (see below), and no facility
listed in the directory yet.

---

## ⚠️ The thing that will embarrass you first: there is no schedule

This is not a bug and nothing is broken. It is a data gap, and it undercuts a
demo more than any defect on this page would.

**Saanich Commonwealth Pool has zero sessions.** It has 6 spaces, 12 session
templates and a *published* "Lengths Swimming" group — and nothing in it. The
only sessions in the entire database (7 as of 2026-09-16, up from 2) belong to
Panorama, and they are invisible to the public because that group is
`status=draft`, which RLS correctly filters. Verified directly on 2026-09-09:

```
/api/sessions/expand?facilityId=<commonwealth>  →  {"data":[]}
/api/sessions/expand?facilityId=<panorama>      →  {"data":[]}
```

So every public surface (facility page, widget, and now any centre a resident
opens from `/find`) renders "No drop-in sessions this week." The empty states are good. That is the problem: a schedule
product demoing an empty schedule looks finished and pointless at the same time.

Two consequences worth knowing before you go looking for bugs that aren't there:

- **No view can be demoed, not just the grid.** `FacilityScheduleClient.tsx:83`
  short-circuits to the empty state *before* dispatching to `ScheduleView`, so
  all five tabs render the same message. Correct behaviour — the emptiness is a
  property of the week, not of the view — but it means Floorplan cannot be shown
  at all while the schedule is empty.
- **Commonwealth Pool also has no facility map** (`facility_maps` has rows for
  Test Rec Centre and Panorama only), so even with sessions, Floorplan would
  need one drawn at `/dashboard/map?facility=<id>`.

`scripts/seed-saanich-pool.mjs` has the real schedule transcribed from the SCP
Lengths PDF, but it is a create-everything script of plain inserts and will
collide with the facility that already exists. Making this demo-ready needs a
**sessions-only variant** that attaches to the existing facility, department,
group and spaces — and ideally links each session to one of the 12 templates
already sitting there. That has not been written.

---

## ⚠️ Launch blocker 1: configure custom SMTP

**Unchanged across three sessions now, and still the thing that will bite you.**
Commit `55c1aa1` made signup send a confirmation email. Supabase's built-in
mailer allows roughly **two sends per hour**.

So signup works for about two people an hour and then **silently fails** — the
user is told to check their inbox and nothing arrives. That silence is
deliberate: the response is identical whether or not the address already exists,
which is what closes the enumeration hole. The fix is delivery capacity, not
code.

Supabase dashboard → Project Settings → Auth → SMTP.

**The full picture lives in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) → "The domain
decision is now the bottleneck".** Seven things point at the same address and
all change together; there is a table there, and it is the single copy — do not
restate it here, it will drift.

The two-line version:

- Everything is blocked on **owning a domain**. Every mail provider requires a
  verified sending domain before it will send for you.
- There are **two independent email paths** and they fail differently:
  *auth* mail (Supabase → SMTP) and *app* mail (`RESEND_*`, staff invitations).
  Only the first blocks anything — invitations already fall back to
  "copy this link" and work today.

Worth knowing: the built-in mailer is not merely slow. It generally delivers
**only to addresses in your Supabase organization**, so a real lifeguard's
Gmail will most likely never receive a confirmation at all.

Until this is done, treat signup as demo-only.

---

## ⚠️ Launch blocker 2: the legal pages need a lawyer

`/privacy` and `/terms` exist, are linked from the footer and signup, and were
drafted from the actual schema rather than a template — the data inventory
matches the migrations and the processor list matches the CSP allowlist.

They are **drafts**. Every fact only you can supply renders as a visible amber
`[placeholder]`, deliberately, so the pages cannot quietly go live looking
finished. There are **13 distinct facts outstanding**:

| Page | Still needed |
|---|---|
| `/privacy` | legal entity name · postal address · `privacy@` address · region · email provider · retention periods (12 months, 13, 30) |
| `/terms` | legal entity name · postal address · `legal@` address · jurisdiction · province/state and country · liability cap (CAD $100) · periods (12, 30) |

Search `<Placeholder>` in `src/app/(public)/privacy/page.tsx` and
`src/app/(public)/terms/page.tsx`.

One finding was dismissed rather than fixed: the audit asked for cookie consent,
but the app sets only Supabase auth session cookies, and uses local storage only
for the theme choice and (since 2026-09-16) the centres a resident stars on
`/find`. Strictly-necessary cookies and on-device preferences don't require
consent, so there is no banner by design, and the privacy policy discloses both.

---

## Other things only you can do

Full list in [`docs/SECURITY.md` → Owner-only actions](SECURITY.md#owner-only-actions).
The ones that matter most:

- [ ] **Live-mode Stripe price IDs in production.** Local values are *test*
      mode. Since `0030b2c` the server refuses to boot without them — good, but
      it means a deploy fails rather than quietly mis-pricing.
- [ ] **Stripe webhook in production** — still not started
      (`docs/DEPLOYMENT.md` step 4). Independent of everything else.
- [ ] **Login rate limiting** — Supabase dashboard. Cannot be done in app code:
      `LoginForm` calls `signInWithPassword()` straight from the browser, so the
      request never reaches this app.
- [x] **Browser-verify the CSP in production.** Done 2026-09-17:
      `node scripts/verify/verify-ai.mjs --app=https://drop-in-ten.vercel.app`
      passed 22/22 (`/`, `/find`, a facility page, and the widget framed on
      another origin, with a positive control).
- [x] **Clear the rate-limit table.** Done 2026-09-17: the sweep removed 249
      stale rows, and the 2 remaining raw-IP rows (written by the old production
      build) were deleted once the fix was live. A fresh production request was
      confirmed to store a hashed key.
- [x] **Schedule the rate-limit sweep.** Done 2026-09-17 with migration `053`
      (pg_cron job `sweep-rate-limits`, hourly; `cron.schedule` returned job 1).
      Its first run hadn’t been checked yet; the query is at the bottom of `053`.
- [ ] **Custom domain, then raise HSTS.** `max-age` is currently **3600** — a
      deliberate low value for a domain still in flux. Raise it once the real
      domain is in place, not before.
- [ ] Spend caps / budget alerts: Vercel, Supabase, Stripe.
- [ ] Confirm backups (PITR) and run one restore test.

### Data hygiene, before showing anyone

- [ ] **The org logo is a 🦖 dinosaur** (`organizations.logo_url`, an uploaded
      file in Supabase Storage). It renders on every facility page under the org
      and in the widget header. Change at `/dashboard/settings`.
- [ ] **Brand colour is `#7a00cc`**, an unmodified purple, in the single
      `widget_configs` row. Change at `/dashboard/widget` → branding.
- [ ] **"Test Rec Centre" is published and in the live org** — it shows in the
      sidebar, the facility grid and publicly. Delete from the facility danger
      zone (it takes 1 department and 8 spaces with it, 0 sessions) or unpublish.

---

## What changed this session (2026-09-16): the resident directory

You decided to bring back a public, no-account directory, smaller than the old
marketplace, with a downloadable app as the long-term goal. Your decisions are
recorded at the top of `docs/PLAN.md`: opt-in listing, `/find` as its own
route, Nominatim for geocoding, free on every plan, and launch now.

| Commit | What |
|---|---|
| `fb5881f` | The uncommitted tags/links (050), print button (051) and compact pickers, committed together on `feat/internal-view` and fast-forwarded into local `main`. |
| `4d43e47` | Phase 1: migration `052` (`listed_in_directory`, `geocoded_at`, `location` trigger), Nominatim geocoding on save, the "List in the Dropin directory" toggle, and the backfill script (**applied**: Panorama and Commonwealth located). |
| `22e2763` | Phase 2: `GET /api/public/v1/directory`, versioned, cached and rate-limited. |
| `087eda5` | Phase 3: `/find`, with search, sport chips, "Use my location" and saved centres, built for phones first. |
| `ba1784f` | Phase 4: `sitemap.xml`, `robots.txt`, canonical tags and a breadcrumb back to `/find`. Also fixes a pre-existing bug: **facility pages stayed stale for hours after any edit**; they now refresh on save and delete. |
| `e58e02f`, `bb223d4` | Phase 5: CSP checked in a browser (`verify-ai`). **L5**: the rate limiter stored raw IPs, now hashed. `/privacy` corrected (local storage, location, Nominatim). Docs. |

Harnesses `verify-ae` through `verify-ai` all pass, and each was deliberately
broken at least once to prove it catches the bug it targets.

### Before the directory is worth visiting

1. ~~Push and deploy~~ — done 2026-09-17.
2. **List the real centres.** On each facility's edit page, tick "List in the
   Dropin directory". Nothing is listed yet, so `/find` says "No centres are
   listed yet".
3. **Give them a public schedule** (see the section above). A listed centre
   with an empty week is the first thing a resident will see.
4. ~~Run `verify-ai` against production and clear the rate-limit table~~ — done
   2026-09-17, and the sweep is now scheduled (migration `053`).

### Things this session found that are worth carrying forward

- **Don't judge caching on `next dev`.** It applies a tag expiry about 100 ms
  late, and it held a stale `/find` for minutes. A production build was
  correct both times. Build to `.next-perf` and run `next start -p 3002` (see
  `scripts/verify/README.md`). Three harnesses had been passing on timing
  luck and now pause after saves.
- **On Windows, stopping a background `next start` can leave it running.** The
  next start then fails, and requests silently reach the *old* build. Check the
  port before believing a result.
- **The mobile app needs a `v1` schedule endpoint.** The directory API is
  versioned, but the schedule on a centre's page still comes from the internal
  `/api/sessions/expand`.
- **Not planned yet** (see `PLAN.md`): session search ("lane swim near me
  tonight"), a map, an installable web app, the native app, resident accounts.
  Schedule and session edits still don't refresh the facility page's cache;
  facility edits now do.

---

## Previous session (2026-09-09)

A pre-demo scan. The application itself was healthy — build, types, lint and a
browser pass over the public surfaces were all clean, with no runtime or console
errors and no horizontal overflow at 390px. Five commits came out of it.

| Commit | What |
|---|---|
| `5dfab13` | **Critical Next.js RCE patched**, 16.3.0 → 16.3.4, plus `npm audit fix`. Also declared `playwright` — see below. |
| `75d2baf` | Removed the marketplace-era "Claim this facility" CTA and the duplicated `— Dropin \| Dropin` tab title from the public facility page. |
| `e31b6e6` | The mobile view-pill strip now scrolls instead of clipping "Floorplan" mid-word at 390px. |
| `bd1d258` | Removed the permanently-disabled notifications bell from the dashboard topbar. |
| `fda8bd6` | README rewritten (it documented `src/store/`, an `(admin)/` panel and `lib/maps/`, none of which exist); `/admin` guard annotated. |

### Two things worth carrying forward

**`npm audit` had silently regressed to 4 production advisories**, including a
**critical unauthenticated RCE** in Next 16.3.0 (Windows-hosted servers, and the
Image Optimization API on AVIF input) — while this doc claimed 0. The register
was accurate when written. Dependency advisories reopen on their own schedule,
so *"npm audit was 0"* is a statement with an expiry date. Re-run it before any
release rather than trusting the last recorded number.

**The verification harness was resting on a phantom dependency.** Every script
in `scripts/verify/` does `import { chromium } from "playwright"`, and
`playwright` was never in `package.json` — it only ever resolved transitively.
`npm audit fix` removed it, which broke the entire harness in one command; a
fresh `npm ci` would have done the same. It is now a declared devDependency.
Worth a general suspicion: **a tool the harness needs but the manifest doesn't
name is not actually installed, it is merely present.**

---

## Picking the next piece of work

### Pricing is now a framework, and it is not enforced

[`docs/PRICING.md`](PRICING.md) is new and is the entry point. The billed unit is
the **facility**, plus a base fee; departments, schedule groups, spaces,
sessions and staff are unlimited on every tier on purpose — the reasoning, the
competitor research and the market arithmetic are all in there.

Two things to carry forward:

- **No quota is checked anywhere.** `PLANS` is read by two render paths and no
  API route reads `plan_tier`. The facility allowances on both pricing pages are
  terms of sale, not limits. `POST /api/facilities` will happily create a fifth
  facility on a 1-facility plan.
- **The database cannot store the new tier names.** Migration `004`'s
  `CHECK (plan_tier IN ('free','pro','enterprise'))` is unchanged, so `plans.ts`
  carries a documented bridge. A migration and 7 new Stripe prices are owner
  actions listed in `PRICING.md`; the new prices must not go live before the
  migration does.

`scripts/verify/verify-t.mjs` covers the surfaces (57 assertions, green), and
was falsified by moving the trial and overage in the catalogue and confirming
both pages followed.

### Feature work — still needs your input

Across several sessions you've mentioned "basic functionality improvements…
adding features," and each time the work went elsewhere. **That list still isn't
written down anywhere**, and it remains the main thing blocking planning. Docs
that describe a "next phase" are *not* authorization to build it — ask.

- ~~Multiple staff accounts per organization~~ — you asked for this on
  2026-09-18 and it is built; see the box at the top of this file.
- (the rest of your feature list)

### Known and unscheduled

- **Dark mode is most of the way there, not done.** The rework left 28 files
  under `src/app/(dashboard)` hardcoding `gray-*`/`white` against 2 using
  semantic tokens; it is now **9 against 32**. The toggle works; those last 9
  files will still look light when switched to dark. Mechanical, file-by-file.
- **Notifications don't exist** — no table, no triggering events, no delivery.
  The disabled bell that used to advertise them is gone as of `bd1d258`.
  Building this starts with deciding *what* should notify someone, not with UI.
- **No org-wide session list.** `/dashboard/sessions` is now the real session
  *templates* page (`0cbc005`), not a placeholder — but a cross-schedule,
  org-wide list of actual sessions is still a different page and a different
  query shape.
- **Route de-duplication** — the `*/edit` and `*/new` form trees are still
  duplicated across department-nested and facility-direct paths. The command
  centre resolved most of the rest.
- **Automated security tests** — the audit's Phase 5, still never done. Worth
  formalising now that the register claims 0 open, because nothing currently
  stops a regression from silently reopening a closed finding. The harness
  conventions in `scripts/verify/README.md` are the pattern to follow.
- **`docs/PLAN.md` may be stale.** Still not reviewed against reality.

---

## Re-verifying security work

**There is now a loop for this, and it is the place to start:**

```bash
node scripts/security/sweep.mjs --live --app=http://localhost:3000
node scripts/security/sweep.mjs --falsify     # every check must go red on poisoned evidence
```

[`docs/prompts/frontend-database-security.md`](prompts/frontend-database-security.md)
is the audit itself — the seven paths from a browser to a row, sixteen weakness
classes, and what counts as proof for each. It is written to be worked from zero
by someone who has not read the register, which is the point: closed findings are
last year's exam. `scripts/security/sweep.mjs` is the repeatable part (30 static
checks, 16 anonymous PostgREST probes, 3 header probes) and prints a MANUAL line
for everything that needs a fixture, naming the `verify-*` harness that has one.
Re-run it whenever the trust boundary moves — a new table, a new policy, a new
route, a new price id. §6 of the prompt records what tier gating will have to
satisfy **when** it is built; it is deliberately not built yet.

**The security audit is fully closed: 21 findings, 0 open** (L6 was found and
closed on 2026-09-22 by the sweep above — `/api/facility-maps/public` had no
rate limit). Detail for each,
including how it was verified, is in [`docs/SECURITY.md`](SECURITY.md). Don't
reconstruct it from memory; read it. That number means *code* findings only —
the two launch blockers above are not code, and the dependency regression this
session was not a finding either.

`docs/SECURITY.md` has the SQL to dump every live policy, the harness pattern,
and the three traps that produced *false green results* the first time
(`updateUser` needs `setSession`; an empty result proves nothing against an empty
table; the positive control must run last).

**One standing rule worth repeating:** a finding is only CLOSED when it has been
verified against the live database or a running app. Migration files are not
evidence — this project applies migrations by hand, so the files and the database
can drift.

[Standing assumptions](SECURITY.md#standing-assumptions) is the regression
checklist: if a future change violates a line in it, the fix above it is silently
undone.

---

## Related docs

| Doc | What it's for |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Vercel + Supabase go-live checklist, in dependency order** |
| [`SECURITY.md`](SECURITY.md) | Findings register, standing assumptions, owner actions |
| [`PRICING.md`](PRICING.md) | **Pricing framework, the billed unit, and what is not yet enforced** |
| [`PLAN.md`](PLAN.md) | **Directory decisions and phases (top)**, delivery history and schema map |
| `src/app/api/public/README.md` | **Public API contract** (versioning rules) |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Cache Components / PPR work |
| [`../README.md`](../README.md) | What the app is, how it's built, how to run it |
| `scripts/verify/README.md` | Verification harness conventions |
| [`prompts/frontend-database-security.md`](prompts/frontend-database-security.md) | **The front-end/database audit + its loop** (`scripts/security/sweep.mjs`) |
| `src/components/schedule-command/README.md` | Command centre architecture + traps |
| `src/components/widget/README.md` | Widget studio + the two publish traps |

### Finished tracks — historical record, not handoffs

None of these is a live entry point. Each documents a track that shipped (or was
deliberately removed), and they are kept for the reasoning, not the TODOs.

| Doc | Track | State |
|---|---|---|
| [`RESUME-schedule-list-view.md`](RESUME-schedule-list-view.md) | List view + sidebar tree | Shipped |
| [`RESUME-schedule-input-fixes.md`](RESUME-schedule-input-fixes.md) | Dogfooding bug fixes | P0/P1 shipped; P2 open |
| [`RESUME-timezone-removal.md`](RESUME-timezone-removal.md) | Timezone removed as a concept | Shipped (migration `034`) |
| [`RESUME-layout-rework.md`](RESUME-layout-rework.md) | Dashboard chrome rework | Shipped; its open items are folded into this doc above |
| [`RESUME-events.md`](RESUME-events.md) | Seasons / events / brochures | **Removed on purpose** (migration `036`). Nothing to resume. |

Two chapters are closed for good and should not be reopened without a deliberate
decision: **scraping** (migration `021`) and **events/brochures** (migration
`036`). Both were built end-to-end and then torn out.
