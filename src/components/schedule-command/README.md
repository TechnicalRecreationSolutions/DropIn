# Command centre (`/dashboard/schedule`)

The page a staff member lives on to place and edit sessions. A building's departments and
schedules are **state on this single route**, not separate pages — but Spaces, the floorplan
editor, and the widget configurator each live on their own dedicated route now
(`/dashboard/spaces`, `/dashboard/map`, `/dashboard/widget`), not as tabs here.

## What it replaced

| Was | Now |
|---|---|
| Sidebar tree: Facility › Department › Schedule | Sidebar lists **facilities only** |
| Facility page (Overview / Spaces / Map / Widget tabs) | `redirect()` → here |
| Department page (Overview / Spaces / Widget tabs) | `redirect()` → here |
| Schedule-group page → **Open builder** → builder route | `redirect()` → here; builder deleted |
| Schedule/Spaces/Map/Widget tab strip on this page | Spaces and Map became their own top-level pages; Widget already had one |

Every link into this page is built by `lib/schedule/commandCentreHref.ts`. Use it rather than
assembling the query string; it's the single definition of what "open this schedule" means.
The same file also exports `spacesHref()`/`mapHref()` for the two pages that split off — a
facility-scoped link into either just needs `?facility=`.

## Layout

```
  ▓ Lap Swim  [Published]                          [⚙ Settings]
  [ Upcoming ] [ Past ]
  Sun, Aug 16 – Sat, Aug 22   This week          6 sessions  ›
  Sun, Aug 23 – Sat, Aug 29                       No sessions ›
  ...
```

Building/department/schedule scope is **not** state on this page at all — it lives entirely in
the sidebar (`SidebarFilters.tsx`), read here straight off `?facility=`, `?department=`,
`?schedule=`. This page used to also render a facility-box grid and department/schedule chip
rows above a workspace tab strip (`FacilityBoxes`/`ScopePicker`/`WorkspaceTabs`, since
removed); picking scope in two places, and switching jobs via tabs instead of navigation, were
both things this and the later split-out rework got rid of.

**Settings** edits the selected schedule directly — it lives in the week list's own header
(`WeekListPanel`) rather than following a "narrowest thing in scope" fallback, since this page
requires a real schedule to be picked before it shows anything.

## Scope: building → department → schedule

Picked entirely in the sidebar (`SidebarFilters.tsx` — three dropdowns), not on this page.
`NO_DEPARTMENT` is a sentinel, not an id: there's nothing to filter on server-side, so that one
scope fetches the facility and drops departmented sessions client-side. This page only ever
*reads* the resulting `?facility=&department=&schedule=`, validating it against what the org
actually owns (a stale or hand-edited URL falls back rather than showing an empty editor) — see
"Data flow" below for exactly how. `department` narrows which schedules the sidebar offers;
this page itself only ever needs `facility` and `schedule` once a schedule is picked.

Without a schedule picked, this page shows a prompt to pick one from the sidebar rather than a
merged, browse-only view across schedules — that broader browsing still exists on the Overview
page's schedule list and on each schedule's own public page, just not here.

## A week list, then the editor

```
  ▓ Lap Swim  [Active]                                    [⚙ Settings]
  [ Upcoming ] [ Past ]
  Sun, Aug 16 – Sat, Aug 22   This week          6 sessions  ›
  ...
```

Once a schedule is picked, this page lands on `WeekListPanel` — every Sunday–Saturday week is
a row, not a single continuous navigator. "Upcoming" (default) starts at the current week
regardless of the schedule's own `starts_on`; "Past" goes backward from the week before it.
Each direction stops at the schedule's own `starts_on`/`ends_on` where set, else pages 12 weeks
at a time via "Load more" — each page is its own bounded fetch (`/api/sessions/expand` caps a
single request at 120 days), not one growing range.

Clicking a week opens the editor:

```
┌─────────────┬────────────────────────────────────────────┐
│ Session     │ ▓ Lap Swim        [Grid][List][Map][Floor] │ ← the real widget header bar
│ templates   ├────────────────────────────────────────────┤
│ (rail)      │  the real widget view, in edit mode         │
└─────────────┴────────────────────────────────────────────┘
```

pinned to that week, with a "← All weeks" link back to the list. The `WeekNavigator`
prev/next arrows inside this view still work as before — the list is how you *arrive* at a
week, prev/next is still how you nudge from it. Which week is open lives in `?week=`
(mirrored via `history.replaceState` — see "Data flow"), so a specific week is linkable and
refresh-safe.

**Weeks run Sunday–Saturday app-wide**, not just in this list — `getWeekStart`/`getWeekEnd`
(`src/lib/utils/dates.ts`) and the `DAYS` array (`src/lib/schedule/weekGeometry.ts`) are the
two sources every time-axis view, the drag-and-drop day mapping, and the public widget derive
their day order from.

On a phone the schedule panel comes **first** (`order-1`) and the template rail drops below
it — the schedule is what staff came for; the rail is a tool.

## Why the views are the widget's own

The panel mounts `ScheduleView` — the exact component the embed and public facility page
render — wrapped in a `ScheduleEditingProvider`. See
[`../schedule/editing/README.md`](../schedule/editing/README.md). There is no preview mode
and no separate editor markup, so a layout can't look right while building and wrong when
embedded.

All four widget layouts (Grid/List/Map/Floorplan) are offered here even when an org has
switched some off for visitors; a switched-off one shows an amber notice linking to
`/dashboard/widget`. Staff should be able to *check* a layout before enabling it. Floorplan
only appears once the selected facility has a **published** map (`facility.hasPublishedMap`,
drawn on the separate `/dashboard/map` page) — this is the widget's read-only floorplan
*view*, not the shape-drawing editor.

> A fifth workspace tab, **Events** — an org-wide month calendar of sessions
> flagged `is_event`, with its own print output — existed here until the
> seasons/events/brochure track was removed
> (`supabase/migrations/036_remove_events_brochure_seasons.sql`). It was the
> one tab that ignored the scope pickers above it (org-wide rather than
> facility-scoped) and the one surface where duplicating a session was
> withdrawn (`canDuplicate: false`) because its `spaces` list is one
> facility's, wrong for most of what an org-wide calendar shows. `canDuplicate`
> is always `true` now that it's the only value ever set — see
> `docs/PLAN.md` §3a.

## Data flow

Everything structural (facilities, schedules, spaces, templates, published maps, widget
colors) is fetched **once, server-side** in `page.tsx` and passed down, because those lists
are small and bounded per org. Switching building or schedule is therefore instant local
state, not a round trip. Spaces and published-map data are still fetched here even though
their editors moved out — `editing.spaces` feeds the create/duplicate/reschedule dialogs, and
`hasPublishedMap` gates the Floorplan *view* (see above).

Only the sessions in view are client-fetched, via the shared `useTemplateSchedule` /
`/api/sessions/expand` pipeline the widget uses. Every mutation posts to the same
`/api/sessions` endpoints and then invalidates the `schedule-range` query key, so all four
layouts reflect a change immediately without refetching per layout.

"The sessions in view" is template-dependent, which is why `activeView` is resolved
*above* the fetch rather than at render time: resolving it late would fetch for the view the
user clicked rather than the one they actually get when a view falls back (floorplan without
a published map).

`facility`/`department`/`schedule` are read straight off `useSearchParams()` on every
render (`useMemo`, validated against the `facilities` prop) — there's no local state for them
to keep in sync, since nothing on this page can change them anymore. `week` is the one piece
of scope this page still owns locally, and it *is* mirrored into `?week=` with
`history.replaceState` — linkable and refresh-safe, without a navigation that would remount
the page.

## Files

| File | Role |
|---|---|
| `ScheduleCommandCentre.tsx` | Owns `week` state, all mutations, and the editing API handed to the views. |
| `WeekListPanel.tsx` | The week list a selected schedule lands on — filter, pagination, per-window session counts. |
| `types.ts` | The shape `page.tsx` assembles server-side (also used by `/dashboard/spaces` and `/dashboard/map`, which build a lighter subset of the same shapes). |

`SpacesPanel.tsx` moved to `../space/SpacesPanel.tsx` — it now backs `/dashboard/spaces`
exclusively. Map and Widget mount `MapEditorClient` and `WidgetConfigurator` directly on
`/dashboard/map` and `/dashboard/widget` — both were already self-contained client
components, so splitting them out was a matter of handing them the right scope on their own
route instead of this one.

## Which routes survived

| Route | Now |
|---|---|
| `…/facilities/[id]` | `redirect()` into here |
| `…/facilities/[id]/departments/[id]` | `redirect()` into here |
| `…/schedule-groups/[id]` | `redirect()` into here, scoped |
| `…/schedule-groups/[id]/builder` | deleted |
| `…/facilities` | kept — the facility index |
| `…/*/edit`, `…/*/new`, `…/session-templates/*` | kept — they're forms, reached from here (or from `/dashboard/spaces`) and returning there |

## Gotchas

- A schedule group with a `department_id` lives at a department-scoped route; one without
  lives directly under the facility. `page.tsx` builds both hrefs — don't assume one.
- `schedule_type === "continuous"` means always-open hours, not placed sessions. Editing is
  disabled for those with an explanation, rather than offering a "+" that can't work.
- The Floorplan *view* only appears when the selected facility has a **published**
  `facility_maps` row — that's drawn on `/dashboard/map`, a separate page from this one.
- The sidebar marks a facility active by the `facility` **query param**, not by pathname —
  every building shares this one schedule route, so pathname alone can't tell them apart.
  `/dashboard/spaces` and `/dashboard/map` follow the same convention.
- **Arriving here from a link while already here does not remount the component.** The
  sidebar, breadcrumbs, and "Open schedule" all point at this same route.
  `facility`/`department`/`schedule` handle this for free (they're read straight off
  `useSearchParams()`, which updates on a real navigation regardless of remounting), but
  `week` is local state and needs the adopt effect to notice the URL changed and pull it in —
  without that the link appears to do nothing and the mirror effect rewrites it straight back.
  `appliedStateRef` keeps the adopt and mirror effects from fighting; `schedule` stays in its
  tracked key even though nothing local reads it, purely so switching schedules resets `week`
  back to its default.
