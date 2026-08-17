# `components/schedule` — the schedule views

Four renderings of the same data, behind one component. `ScheduleView` picks
between them; nothing above it knows which one is on screen.

```
ScheduleView (template switch)
├── grid       WeeklyScheduleGrid     Mon–Sun × time axis
├── list       WeeklyScheduleList     day-by-day rows
├── map        WeeklyScheduleMap      spaces as columns; the only droppable view
└── floorplan  FloorplanView          the facility's drawn map; needs one facility
```

> A fifth view, `events` (`EventCalendarView` — a month-at-a-glance calendar of
> flagged sessions, with its own print stylesheet), existed here until the
> seasons/events/brochure track was removed
> (`supabase/migrations/036_remove_events_brochure_seasons.sql`). `month`/
> `onMonthChange` remain on `ScheduleView`'s props and `useScheduleAnchor`
> unused, kept for a future month-shaped view rather than stripped — see
> `docs/PLAN.md` §3a.

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
