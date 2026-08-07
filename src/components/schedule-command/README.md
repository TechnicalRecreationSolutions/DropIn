# Command centre (`/dashboard/schedule`)

The one page a staff member lives on. Everything about a building — its departments,
schedules, sessions, spaces, floorplan, and embed config — is **state on this single route**,
not separate pages.

## What it replaced

Four layers collapsed into one:

| Was | Now |
|---|---|
| Sidebar tree: Facility › Department › Schedule | Sidebar lists **facilities only** |
| Facility page (Overview / Spaces / Map / Widget tabs) | `redirect()` → here |
| Department page (Overview / Spaces / Widget tabs) | `redirect()` → here |
| Schedule-group page → **Open builder** → builder route | `redirect()` → here; builder deleted |

Each of those re-derived the same context and made you click through two or three screens
before reaching any actual work. Here the context is picked once, at the top, and every tool
operates on it.

Every link into this page is built by `lib/schedule/commandCentreHref.ts` — including the
`tab` param. Use it rather than assembling the query string; it's the single definition of
what "open this thing" means.

## Layout

```
Manage
[ Panorama ] [ Test Rec Centre ] [ + Add facility ]      ← buildings (sidebar picks these too)
DEPARTMENTS   [ All ] [ Aquatics 1 ] [ No department 1 ] [ + New department ]
SCHEDULES     [ All ] [ Lap Swim ] [ + New schedule ]                        [⚙ Settings]
─────────────────────────────────────────────────────────────
 Schedule │ Spaces │ Map │ Widget                          ← workspace tabs
```

**Settings** always edits the narrowest *real* thing in scope — the schedule if one is
picked, else the department, else the facility. One control replaces three pages' worth of
"Edit …" buttons.

Tabs follow the scope, with two deliberate exceptions worth knowing:

- **Map is per building.** A floorplan belongs to a facility, so the tab ignores the
  department filter and says so on screen.
- **Widget follows facility *and* department**, because `widget_configs` is keyed on both —
  that's how a department gets its own embed and colors.

The Schedule tab is **hidden rather than unmounted** when another tab is active. Flipping to
Spaces to add Lane 7 and back must not lose the week you were on, the layout you were in, or
refetch the schedule. The other tabs hold no state worth preserving and unmount freely.

## Scope: building → department → schedule

```
[ Panorama ] [ Test Rec Centre ] [ + Add facility ]          ← buildings
DEPARTMENTS   [ All ] [ Aquatics 3 ] [ Fitness 2 ] [ No department 1 ]
SCHEDULES     [ All ] [ Lap Swim ] [ Fun Swim ] [ + New ]
```

Each tier is a real scope, not just a filter for the one below it — a department shows
everything running across it that week, which is the view a department head wants. Placing
sessions needs exactly one `schedule_group_id`, so editing switches on at the last tier;
broader scopes stay view + duplicate + delete.

The department tier renders **only when the building has departments**, so orgs that keep
their schedules flat never see an empty layer. Where departments do exist, schedules that
belong to none get a `No department` chip — and only when there are some.

Selecting a schedule pulls the department tier to wherever that schedule actually lives, so
the chips always read as a true path to it (this is what makes a deep link from the tree nav
land with the right department highlighted). Selecting a department drops the schedule if it
no longer belongs, rather than silently editing something the chips no longer show.

`NO_DEPARTMENT` is a sentinel, not an id: there's nothing to filter on server-side, so that
one scope fetches the facility and drops departmented sessions client-side.

## The Schedule tab

```
┌─────────────┬────────────────────────────────────────────┐
│ Session     │ ▓ Lap Swim        [Grid][List][Map][Floor] │ ← the real widget header bar
│ templates   ├────────────────────────────────────────────┤
│ (rail)      │  the real widget view, in edit mode         │
└─────────────┴────────────────────────────────────────────┘
```

On a phone the schedule panel comes **first** (`order-1`) and the template rail drops below
it — the schedule is what staff came for; the rail is a tool. The building boxes are styled
to match the overview's Quick build tiles so the two read as the same control.

## Why the views are the widget's own

The panel mounts `ScheduleView` — the exact component the embed and public facility page
render — wrapped in a `ScheduleEditingProvider`. See
[`../schedule/editing/README.md`](../schedule/editing/README.md). There is no preview mode
and no separate editor markup, so a layout can't look right while building and wrong when
embedded.

All four widget layouts are offered here even when an org has switched some off for
visitors; a switched-off one shows an amber notice linking to widget settings. Staff should
be able to *check* a layout before enabling it.

## Data flow

Everything structural (facilities, schedules, spaces, templates, published maps, widget
colors) is fetched **once, server-side** in `page.tsx` and passed down, because those lists
are small and bounded per org. Switching building or schedule is therefore instant local
state, not a round trip.

Only the week's sessions are client-fetched, via the shared `useWeeklySchedule` /
`/api/sessions/expand` pipeline the widget uses. Every mutation posts to the same
`/api/sessions` endpoints and then invalidates the `weekly-schedule` query key, so all four
layouts reflect a change immediately without refetching per layout.

Editor state is mirrored into `?facility=&schedule=` with `history.replaceState` — linkable
and refresh-safe, without a navigation that would remount the page.

## Files

| File | Role |
|---|---|
| `ScheduleCommandCentre.tsx` | Owns all state, all mutations, and the editing API handed to the views. |
| `FacilityBoxes.tsx` | The large building boxes. |
| `ScopePicker.tsx` | The department and schedule chip tiers. |
| `WorkspaceTabs.tsx` | The Schedule/Spaces/Map/Widget strip. |
| `SpacesPanel.tsx` | Scope-filtered space list (was the facility and department pages' Spaces tab). |
| `types.ts` | The shape `page.tsx` assembles server-side. |

Map and Widget mount the existing `MapEditorClient` and `WidgetConfigurator` unchanged —
they were already self-contained client components, so absorbing those pages was a matter of
handing them the right scope.

## Which routes survived

| Route | Now |
|---|---|
| `…/facilities/[id]` | `redirect()` into here |
| `…/facilities/[id]/departments/[id]` | `redirect()` into here |
| `…/schedule-groups/[id]` | `redirect()` into here, scoped |
| `…/schedule-groups/[id]/builder` | deleted |
| `…/facilities` | kept — the facility index |
| `…/*/edit`, `…/*/new`, `…/session-templates/*` | kept — they're forms, reached from here and returning here |

## Gotchas

- A schedule group with a `department_id` lives at a department-scoped route; one without
  lives directly under the facility. `page.tsx` builds both hrefs — don't assume one.
- `schedule_type === "continuous"` means always-open hours, not placed sessions. Editing is
  disabled for those with an explanation, rather than offering a "+" that can't work.
- Floorplan only appears when the selected facility has a **published** `facility_maps` row.
- The sidebar marks a facility active by the `facility` **query param**, not by pathname —
  every building now shares one route, so pathname alone can't tell them apart.
- **Arriving here from a link while already here does not remount the component.** The
  sidebar, breadcrumbs, and "Open schedule" all point at this same route, so
  `ScheduleCommandCentre` adopts incoming search params in an effect rather than only from
  its `initial*` props. Without that the link appears to do nothing and the URL-mirroring
  effect rewrites it straight back. `appliedScopeRef` keeps the adopt and mirror effects
  from fighting.
- **Don't export plain values from a `"use client"` module into `page.tsx`.** `WorkspaceTab`
  and its list live in `lib/schedule/commandCentreHref.ts` for exactly this reason: an array
  exported from the tab component arrives in the server component as a client-reference
  stub, and `.includes` throws at request time. Types are fine (erased); runtime values are
  not.
