# Scope navigation — review and plan (2026-10-01)

The Phase 1 deliverable for `docs/prompts/scope-navigation.md`. The decision in that prompt is
taken as given; this records what the code does today, what changes, and the few places where the
code disagreed with the prompt's assumptions.

## 1. Inventory — where the dashboard reads or asks for scope

| Where | Reads | Renders | Agrees with sidebar today? |
|---|---|---|---|
| `layout/SidebarNav.tsx` | URL `?facility` (or legacy `/facilities/[id]` path), then local state, then first facility | owns the selection; navigates only on 5 paths (`scopedHrefForPath`) | — (it *is* the sidebar) |
| `layout/SidebarFilters.tsx` | selection | Facility / Department / Schedule Radix `Select`s | — |
| `layout/SidebarMenu.tsx` | selection | links: Overview, Schedules, Status, Sessions, Spaces, Departments, Map, Widget carry `?facility` (+dept/schedule for Schedules/Sessions) | yes, but only for links |
| `hooks/useNeedsYouCount.ts` → `/api/overview/needs` | selection's facility, else API falls back to first facility **unscoped** | Overview inbox badge | yes; API fallback ignores role scope |
| `hooks/useNavTree.ts` → `/api/nav-tree` | — | facilities/departments/schedules for the sidebar; aux **and coordinator** facilities are scoped (`isScoped`) | — |
| `dashboard/page.tsx` (Overview) | `?facility` / `?department` / `?schedule`, else first facility **of the whole org** | single-facility overview; no org-wide mode | yes if sidebar navigated; a coordinator defaults to a building they may not hold |
| `dashboard/schedule/page.tsx` | `?facility` (server), `?department`/`?schedule` (client, `ScheduleCommandCentre`) | **FacilityCardPicker** chips + list/editor | chips duplicate the sidebar |
| `dashboard/sessions/page.tsx` | `?facility`, `?department` (default "Facility-wide") | **FacilityCardPicker** + **DepartmentPicker** tabs | duplicates; sidebar dept "All" ≠ page default "Facility-wide" — they disagree |
| `dashboard/spaces/page.tsx` | `?facility` | **FacilityCardPicker**; groups by department | duplicates |
| `dashboard/map/page.tsx` | `?facility` | **FacilityCardPicker** | duplicates |
| `dashboard/departments/page.tsx` | `?facility` | **FacilityCardPicker** | duplicates |
| `dashboard/status/page.tsx` | role scope | list of facilities (redirects if one) | sidebar link bypasses it when a facility is selected |
| `facilities/[facilityId]/status` and other `/facilities/[id]/…` detail pages | path id | Breadcrumb | sidebar seeds from path |
| `analytics/*` (4 pages) + `AnalyticsToolbar` | `?facility`, missing = **All facilities** | toolbar's own facility `DropdownMenu` | ignored by the sidebar entirely (sidebar shows a facility while the page shows "All") |
| `api/analytics/export` | `?facility` | CSV | follows the toolbar |
| `schedule/deck` (print group, `DeckSheetPage`) | `?facility&date` | its own `NativeSelect` | outside the dashboard chrome — no sidebar, so it keeps its picker |
| `import` / `ImportWizard` | initial facility | `NativeSelect` = *destination of the rows* (a form field, not scope) | n/a — kept, defaults to current facility |
| `settings/public`, `settings/*`, `facilities`, `widget`, `conflicts`, `activity` | nothing | org-wide | sidebar filters silently ignored |
| `DashboardBottomNav.tsx` (phones) | nothing — bare `/dashboard`, `/dashboard/schedule`, `/dashboard/status` | | phones always landed on the first facility |
| `commandCentreHref` callers | ~30 files build links with it | | unchanged |

## 2. Classification

- **Org-wide** (ignore the switcher): Facilities (list + new), Settings/*, Widget, Conflicts,
  Activity, Import. The switcher still shows; on these pages its list carries a line saying the
  page covers every facility, and switching only changes the remembered building.
- **Facility-scoped**: Overview, Map, Departments, Facility status, Schedules (list), Analytics
  (with "All facilities" for owners/managers).
- **Facility + department**: Schedules/Manage (`All` + departments + "No department" when such
  schedules exist), Sessions (`Facility-wide` + departments, **no "All"** — see below), Spaces
  (`All` + departments; filters the department groups).
- **Unclear, decided here**:
  - *Sessions* — templates *belong* to a department or to the whole building; the page shows one
    bucket at a time, and "New template" creates into it. An "All" view would have nowhere to
    create into. So it is single-select without "All", with "Facility-wide" as the first option.
    This is the one real need the prompt asked to be told about.
  - *Analytics* — **not department-aware today**: no page passes a department, Engagement is
    org-wide visitor numbers, and the CSV export takes no department. Adding one is a data
    change, not navigation. Per rule 2 ("no control is ever present and ignored") Analytics gets
    **no** department filter in this task. Worth a later task for Utilization (the lib already
    accepts `departmentId`).
  - *Overview "All facilities"* — the Overview is built around one building (today ribbon,
    notices, head counts). An org-wide mode is a new feature with nothing to show yet, so "All"
    is offered on **Analytics only** for now. Flagged for the user.

## 3. The shared primitive

`components/schedule/TickBoxDropdown.tsx` — the widget's `CheckboxDropdown` moved out of
`ScheduleFilterBar.tsx`, unchanged in markup, plus:

- `theme: "widget" | "widget-dark" | "app"` (the widget passes `dark ? "widget-dark" : "widget"`).
  `"app"` maps every hex to a token (`border-input`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `ring-ring`, ticked row `bg-brand-subtle`).
- `mode: "multi" | "single" | "radio"` — radio = real `<input type="radio">`, re-ticking the
  selected row does nothing, the panel closes on a pick, no "Clear" link.
- `TickBoxList` gains the same `theme` + `mode`; `dark` stays as the widget's prop.

Widget files that change: `ScheduleFilterBar.tsx` (imports the dropdown instead of defining it),
`TickBoxList.tsx` (theme map). `ScheduleScopeFilters.tsx` is untouched — its pill is a different
shape and stays. Proof of "no visual change": the harness renders the widget's filter dropdown and
open list with `renderToStaticMarkup` before and after and compares the HTML byte-for-byte, and
`verify-n`/`verify-q` re-run.

## 4. Migration plan (each step leaves the app working)

1. Primitive extracted; widget switched to it; markup diff = 0.
2. `lib/dashboard/scope.ts`: `FACILITY_COOKIE`, `resolveFacilityId()` (URL → cookie → first
   *readable* facility), `facilitySwitchHref()` (rule 6 mapping). Cookie, not `localStorage`:
   server components resolve it, so a bare `/dashboard/schedule` (bottom nav, bookmarks, a
   redirect) renders the remembered building on the first byte with no client redirect or flash.
   It is not httpOnly (the switcher writes it), holds only an id, and is validated against the
   viewer's readable facilities on every read, so a stale or foreign id falls through.
3. Sidebar: `FacilitySwitcher` replaces the org line and `SidebarFilters`; collapsed = building
   icon opening the same list; mobile sheet gets it at the top. Hidden with one reachable facility.
4. Pages drop `FacilityCardPicker` (component deleted) and resolve through `resolveFacilityId`;
   `DepartmentFilter` added to Schedules, Sessions (replaces `DepartmentPicker`), Spaces.
5. Breadcrumbs `Facility › Department › Schedule` on Schedules, Sessions, Spaces, Map, Departments.
6. Analytics: the toolbar's facility dropdown removed; the sidebar switcher offers "All
   facilities" there (owners/managers), and missing `?facility` still means All so old links keep
   their meaning. The sidebar's Analytics link carries the current facility.
7. Inbox count + `/api/overview/needs` + Overview resolve the facility the same way.
8. `docs/DESIGN.md` "Scope and filters".

No URL changes. `?facility=&department=&schedule=` keep their names; every old link resolves the
same way except that a link *without* `?facility` now opens the remembered building instead of the
first by name (Analytics excepted, above).

## 5. Risks and open questions

- **Coordinators** had the org's first facility as the default on the Overview, Sessions, Spaces,
  Map and Departments — possibly one they cannot read. The resolver filters by `canReadFacility`
  first, which fixes that as a side effect.
- **Inbox badge** keys on the switcher's facility; the API now resolves the same cookie, so the
  badge and the Overview cannot disagree when the URL names nothing.
- **Old sidebar department/schedule state**: the sidebar Schedules link used to carry the
  selected department + schedule. It now carries the facility only; a schedule is opened from the
  list.
- Route-based scope (`/dashboard/[facility]/…`) would make every link self-describing; worth a
  later task, not done here.
