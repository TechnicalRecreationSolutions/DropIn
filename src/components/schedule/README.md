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

The consequence worth knowing: **reaching for `session.holderName` directly in a
view re-introduces the leak this indirection removes**, because nothing about a
component tells you which audience is rendering it. Go through the helper.

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

Its print styles are the only `@media print` block in the codebase and live in
`src/app/globals.css`, scoped to `.deck-sheet` / `.no-print` so nothing else on
any page changes when someone hits Ctrl-P.

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
