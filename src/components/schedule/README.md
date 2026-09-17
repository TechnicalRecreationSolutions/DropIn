# `components/schedule` — the schedule views

Five renderings of the same data, behind one component. `ScheduleView` picks
between them; nothing above it knows which one is on screen.

```
ScheduleView (template switch)
├── grid       WeeklyScheduleGrid     Mon–Sun × time axis
├── list       WeeklyScheduleList     day-by-day rows
├── map        WeeklyScheduleMap      spaces as columns; the only droppable view
├── board      WeeklyScheduleBoard    printed-PDF-style table: shared time-band rows × day columns
└── floorplan  FloorplanView          the facility's drawn map; needs one facility
```

Board exists for orgs attached to the look of the paper/PDF schedule they
already hand out — day columns, a shared row per time band, one box per
session — that they'd otherwise re-upload as a flyer every time a time
changes. Rows are derived from the sessions themselves (every distinct start/
end minute across the week is a row boundary — see `buildBoardRows` in
`WeeklyScheduleBoard.tsx`), not a fixed hour grid, so two sessions running at
the same time in different spaces (e.g. a 25M and a 50M lap-swim block) land
in the same row as separate boxes, each labelled with its own space — no
need to give them different names just to tell them apart.

> A fifth view, `events` (`EventCalendarView` — a month-at-a-glance calendar of
> flagged sessions, with its own print stylesheet), existed here until the
> seasons/events/brochure track was removed
> (`supabase/migrations/036_remove_events_brochure_seasons.sql`). `month`/
> `onMonthChange` remain on `ScheduleView`'s props and `useScheduleAnchor`
> unused, kept for a future month-shaped view rather than stripped — see
> `docs/PLAN.md` §3a.

List is the one view that does not start its week at Sunday. A drop-in
schedule is read to answer "when can I next come", so on the **current** week
it renders today first and collapses the days already gone behind a
"Show N earlier days" toggle; every other week renders all seven, because a
week the viewer navigated to is one they asked to see in full. Collapsed, not
dropped: staff edit this same list mid-week and still need to reach Monday.
The mobile day chips are a picker over what's rendered, so a selected day that
gets collapsed (or that a week change leaves behind) falls back to the first
visible one — `verify-s.mjs` covers both halves.

The same components render the public widget and the dashboard editor. The
only difference is whether a `ScheduleEditingProvider` sits above them — see
[`editing/README.md`](editing/README.md).

## Ranges

Every view shows **a week**. `ScheduleView` only renders — it does not fetch.
Callers get the range right by fetching through `useTemplateSchedule` with the
*same* `template` they pass to `ScheduleView`:

```tsx
const { weekStart, setWeekStart } = useScheduleAnchor();
const { data } = useTemplateSchedule({ template: view, facilityId, weekStart });

<ScheduleView
  template={view}
  sessions={data ?? []}
  weekStart={weekStart} onWeekChange={setWeekStart}
/>
```

Every view fetches under one query key (`SCHEDULE_RANGE_KEY`), so a mutation
from any surface refreshes all of them. A view that fetches under its own key
silently stops refreshing.

## Empty states

Every view may be short-circuited by its caller — no sessions, render a
message instead of the view. `FacilityScheduleClient` and `WidgetScheduleClient`
both do this.

## Navigators

`WeekNavigator` steps seven days and labels a date span.

## Colour

`sessionCardColor.ts` is the one fallback chain: past-session muted → template
colour → org brand.

## Names, and why no view builds one itself

Every view labels a session through **`sessionDisplayLabel()`**
(`src/lib/sessions/occupancy.ts`): holder name → template name → schedule group
name. Views used to inline `templateName ?? scheduleGroupName`, which has no
place to put the first of those.

That chain is what makes one set of components safe on both a staff page and a
public widget, because the audience is decided by the *data*, not by the
component: `holderName` comes from `session_internal`, a table with no
public-read policy at all, and `/api/sessions/expand` only queries it for
members of the owning org. So a public caller's occurrence carries
`holderName: null` and falls through to a label the route has already redacted
(migration 046 — see `docs/PLAN-internal-view.md`).

> **The middle link of that chain did not work until migration 050.**
> `session_templates` had no public-read policy, and PostgREST nulls an embedded
> resource that RLS filters — so for every anonymous visitor `templateName` was
> `null` and *every* public card fell through to the schedule group's name. It
> failed silently and looked deliberate. Nobody caught it because no published
> schedule had any sessions in it (see `docs/RESUME.md`). 050 adds the policy,
> gated on the session's `disclosure` being `public` so a withheld booking still
> withholds; `scripts/verify/verify-ab.mjs` asserts a real anonymous read.

The consequence worth knowing: **reaching for `session.holderName` directly in a
view re-introduces the leak this indirection removes**, because nothing about a
component tells you which audience is rendering it. Go through the helper.

## Tags, description and links

All three come from the **template**, never the session (migration 050), and all
three arrive on `ExpandedSession` already redacted for the caller — same
arrangement as the label chain above, so no view has to know its audience.

- **`templateTags`** render on the card in every view, through
  `SessionTags.tsx`. It shows `TAGS_ON_CARD` (2) and a `+N`; the modal passes
  `variant="full"`. The array order is staff-chosen
  (`session_template_tags.display_order`), so *which* two appear is a decision,
  not an accident. Chips carry `print-color-adjust: exact` because the board
  view gets printed and handed out — these replace the asterisks and colour key
  on the paper schedule, and a chip that prints white-on-white replaces them
  with nothing.
- **`templateDescription`** appears only in `SessionModal`. Plain text; no
  markdown renderer on a public surface.
- **`templateLinks`** are at most 3, and render as **labels only** — never the
  bare URL. They open in a new tab with `rel="noopener noreferrer"` and fire a
  `link_click` analytics event alongside the `program_click` the modal already
  fires on open.

`templateTags` and `templateLinks` are always arrays, never null, so a view can
map over them with no guard. An untagged session renders nothing at all —
`SessionTags` returns `null` on an empty array, wrapper included — which is what
keeps every schedule that predates 050 rendering identically.

A `reserved` occurrence seen by an outsider arrives with all three emptied, by
`applyDisclosure()` *and* by RLS. A description, a tag, or a link to a club's
registration page each name the holder as plainly as the template name would.

## The deck sheet is not one of these views

`DeckSheet.tsx` + `DeckSheetPage.tsx` render `/dashboard/schedule/deck` — spaces
across, time down, one day, printable (stage 4 of
`docs/PLAN-internal-view.md`). It sits in this directory because it renders
`ExpandedSession`s like everything else here, but it is deliberately **not** a
`ScheduleTemplate` value and never passes through `ScheduleView`:

- `ScheduleTemplate` values are what a widget can be configured to show
  (`widget_configs.allowed_templates`). This sheet carries holder names and setup
  notes from `session_internal`, so there must be nothing for a public surface to
  select — by query param or otherwise.
- It is a **table**, not the shared pixel geometry in `weekGeometry.ts`.
  Absolutely-positioned blocks cannot paginate; a printed page break slices
  through them. Rows, `rowSpan`, and a repeating `thead` are what make a printout
  work, and the printout is the deliverable.
- It draws only **exclusive** claims. Drop-in blocks are residual — they hold
  whatever is left — so a lane cell naming one would be false. They are listed
  under the grid instead, and an empty cell means open water.

Its print styles live in `src/app/globals.css`, scoped to `.deck-sheet` /
`.no-print` so nothing else on any page changes when someone hits Ctrl-P.

## The visitor printout is not one of these views either

`PrintableSchedule.tsx` is what the public Print button prints
(`widget_configs.allow_print`, migration 051) on the embed and on
`/facility/[slug]`. It is rendered next to the live schedule, `hidden
print:block`, while the caller marks its interactive UI `print:hidden`. It
is a separate day-by-day table rather than a print stylesheet over the views
because the views drop sessions on paper: the grid and list show one day on a
phone, the list folds away days already past, and the map shows one day at a
time.

- It takes the caller's **filtered** sessions, so the printout matches what
  the visitor chose. The notice at the top always says the schedule is subject
  to change and when it was printed. When a filter or a switcher entry is
  narrowing the week, it also says so, names the filters
  (`describeActiveFilters()`) and gives an N-of-M count.
- Names go through `sessionDisplayLabel()` like every other public surface.
- It prints on a named portrait `@page` (`visitor-schedule`); the global
  `@page` stays landscape for the deck sheet.
- Known gap: the button calls `window.print()` from inside the embed's iframe.
  Desktop Chrome prints just the frame (verified by `verify-ad` via Playwright
  PDF). iOS Safari is reported to print the host page instead, and nobody has
  checked that yet.

## Computed availability is staff-only, and stays that way

`src/lib/schedule/availability.ts` subtracts the exclusive claims from what a
drop-in block claims and returns the bands that are left (stage 5). Two surfaces
in this directory read it — the deck sheet's residual list, and the command
centre's shadow panel — and **both are behind org membership**.

Nothing computed is published. The public payload for a drop-in block is exactly
what it was before stage 5: the lanes it claims, unreduced. That is the whole
meaning of shadow mode, and `verify-aa` §4 asserts it against an anonymous read.
When that changes it will be stage 6's deliberate decision, not a side effect of
a view rendering a number it happened to have.

Two things to know before reading a number off it: the unit is a `spaces` row, so
lane counts require lanes to be modelled as spaces; and a caller must hand it the
**whole facility's** sessions, because the rental eating into a drop-in block
almost always lives under a different schedule group.
