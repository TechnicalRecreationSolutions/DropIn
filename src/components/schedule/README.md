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
