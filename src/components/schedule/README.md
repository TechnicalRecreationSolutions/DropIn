# `components/schedule` — the schedule views

Five renderings of the same data, behind one component. `ScheduleView` picks
between them; nothing above it knows which one is on screen.

```
ScheduleView (template switch)
├── grid       WeeklyScheduleGrid     Mon–Sun × time axis
├── list       WeeklyScheduleList     day-by-day rows
├── map        WeeklyScheduleMap      spaces as columns; the only droppable view
├── floorplan  FloorplanView          the facility's drawn map; needs one facility
└── events     EventCalendarView      month of flagged events; the printable sheet
```

The same components render the public widget and the dashboard editor. The
only difference is whether a `ScheduleEditingProvider` sits above them — see
[`editing/README.md`](editing/README.md).

## Ranges: the part that is easy to get wrong

Four of the five views show **a week**. `events` shows **a month**, filtered to
sessions flagged `is_event`.

`ScheduleView` only renders — it does not fetch. Callers get the range right by
fetching through `useTemplateSchedule` with the *same* `template` they pass to
`ScheduleView`:

```tsx
const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
const { data } = useTemplateSchedule({ template: view, facilityId, weekStart, month });

<ScheduleView
  template={view}
  sessions={data ?? []}
  weekStart={weekStart} onWeekChange={setWeekStart}
  month={month} onMonthChange={setMonth}
/>
```

Two traps this shape exists to prevent:

1. **A week's data in a month's view.** The calendar renders, the first row has
   events, the other four are blank. It looks like the org has no events after
   the 7th rather than like a wrong fetch.
2. **A week and a month held as separate state.** They drift, and the naive fix
   — store the week, derive the month — is wrong:
   `getWeekStart(getMonthStart(october))` lands on Mon Sep 28, so the month
   derived back out reads as September. `useScheduleAnchor` holds one ordinary
   date and derives both, which only loses information in the direction that
   doesn't matter.

Every view fetches under one query key (`SCHEDULE_RANGE_KEY`), so a mutation
from any surface refreshes all of them. A view that fetches under its own key
silently stops refreshing.

## Empty states

The week views may be short-circuited by their caller — no sessions, render a
message instead of the view. **The events calendar must not be.** Its empty
state lives inside the component, below the month navigator, so a visitor who
lands on a quiet month still has a control to page out of it. `FacilityScheduleClient`
and `WidgetScheduleClient` both special-case this.

## Navigators

`WeekNavigator` and `MonthNavigator` are siblings, not one component with a
mode. They share a silhouette on purpose and nothing else: one steps seven days
and labels a date span, the other steps a calendar month and labels a name.

## Printing

`EventCalendarView` is the only view designed to leave the screen. The month
sheet taped to a wall behind a front desk is the reason this whole track exists,
so the print rules in `globals.css` (`@media print`) reveal the `.event-calendar`
subtree and hide everything else — including its own navigator and the `⋯`
menus, which mean nothing on paper. The month name is re-rendered as a
`print:block` heading, since the navigator that normally carries it is stripped.

Deliberately not a dedicated print route: the calendar is mounted inside four
different shells, and a print-only copy of the view would be a fifth rendering
that drifts from the other four.

`printBranding` adds the org's name and logo above the month, with the brand
colour as a rule across the top. Only surfaces that know which org they belong
to pass it — the public org calendar does; the dashboard doesn't, because it
already sits under the org's own chrome on screen.

## Featuring: three entry points, one writer

| Where | What it does |
|---|---|
| `⋯ → Add to / Remove from event calendar` | One click, no dialog. Sends **only** `is_event`. |
| `⋯ → Feature…` | The full payload: both toggles, title, summary, description, image, link, category, accent. |
| `SessionForm` → "Feature this session" | Both toggles + the summary, behind progressive disclosure. |

All three POST to `/api/sessions/features`, which is the single writer of
`session_features`. `SessionForm` reaches it as a *second* request after saving
the session itself — the flags live on `sessions` but the copy doesn't, and
teaching `/api/sessions` about feature content would duplicate its validation and
give the payload two writers that can disagree.

**That endpoint is a PATCH, and it has to be.** An omitted field is left alone;
an explicit `null` clears it. If omitted fields defaulted to null, the one-click
toggle — which sends nothing but a flag — would erase every piece of copy an org
had written, which is precisely the loss migration 028 decision 3 exists to
prevent, delivered by the action meant to be the safe shortcut.

The same asymmetry is why the session edit page loads `is_event`, `in_brochure`
and the stored summary before rendering the form. The form posts what is on
screen, so a form that rendered its toggles off by default would silently
un-feature an event the moment someone edited its start time.

## Colour

One fallback chain, in this order:

| View | Helper | Order |
|---|---|---|
| week views | `sessionCardColor.ts` | past-session muted → template colour → org brand |
| events | `eventAccentColor` in `EventCalendarView.tsx` | feature accent → template colour → org brand |

The events chain starts one step earlier because `session_features.accent_color`
is set per event; everything below it is the chain the week views already use.
