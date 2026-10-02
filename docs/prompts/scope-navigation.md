# Prompt: One scope, set in one place — facility, department and schedule in the dashboard

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.
**Review first, then build.** Your first deliverable is the review and plan in "Phase 1"; stop
there and wait for approval before changing code.

---

## The problem

An admin chooses *where they are working* in two places that do not agree:

- The sidebar has three stacked dropdowns — Facility, Department, Schedule
  (`src/components/layout/SidebarFilters.tsx`, built on the Radix `Select` in `ui/select.tsx`).
  They are called "Filters", but they act on some pages and are silently ignored on others.
- Pages then ask again. `/dashboard/schedule` ("Manage") shows its own row of facility chips with
  department/schedule counts, while the sidebar already says "Panorama Recreation Centre". The
  selected chip's secondary text ("2 departments · 1 schedule") is pale on `brand-subtle` and
  nearly unreadable. Other pages carry their own pickers too — find them all (start with
  `FacilityCardPicker`, `AnalyticsToolbar`, `status/page.tsx`, `DeckSheetPage`,
  `settings/public`, `ImportWizard`).

Two controls for one choice can disagree, and a filter you cannot tell is working is worse than
none.

## The decision (already made — implement it, don't relitigate it)

1. **Facility is a workspace, not a filter.** One building switcher at the top of the sidebar,
   in place of the org line under "Dropin". It is the only facility picker in the dashboard.
   - Hidden entirely when the viewer can reach only one facility (single-building orgs; most
     coordinators; aux staff scoped to one).
   - Remembers the last building per person (cookie or `localStorage`; your call, justify it),
     used only when the URL does not name one.
   - "All facilities" exists only where it means something: Overview and Analytics, for owners and
     managers. Everywhere else a facility is always selected.
2. **Department is a page-level filter**, shown in the toolbar of pages that are department-aware
   (Schedules/Manage, Sessions, Spaces, Analytics, and any other you find). Pages without
   departments show nothing — no control is ever present and ignored.
   - A coordinator with one department never sees it; with several, only theirs.
   - It resets when the facility changes (departments belong to a facility).
3. **Schedule is not a filter.** A schedule is an object you open. Remove the sidebar "All
   schedules" dropdown. On Schedules/Manage, the list is how you pick one.
4. **Show scope, don't re-ask it.** Every scoped page's breadcrumb reads
   `Facility › Department › Schedule` as far as applies, each crumb a link up. No page renders a
   second facility picker — delete the chips on `/dashboard/schedule` and any equivalents.
5. **The URL is the source of truth.** `?facility=&department=&schedule=` (keep the existing
   names; `scopeQueryString` / `commandCentreHref` in `lib/schedule/commandCentreHref.ts` are the
   one place they are built). The remembered facility only fills in a missing param. Back/forward
   and shared links must work.
6. **Switching on a detail page** goes to the same page *type* in the new facility (the list),
   never a page holding the old facility's ids.
7. **Org-wide pages ignore the switcher by design** — Facilities, Staff, Billing, Settings. Make
   that obvious (the switcher still shows, but those pages must not read it or pretend to).

## The look: the widget's filters, not Radix Select

The new building switcher and the page-level department filter must use the **same UI as the
public widget's filters** — not the dashboard's Radix `Select`. The reference implementation is:

- `src/components/schedule/ScheduleScopeFilters.tsx` — the widget's Facility / Department /
  Schedule switcher (one labelled control per level, "All …" when nothing is ticked).
- `src/components/schedule/ScheduleFilterBar.tsx` — `CheckboxDropdown` and `themeClasses()`: a
  small label above (12px, weight 500, muted), a **field-shaped button** (40px tall, 10px radius,
  `input`-colour 1px border, chevron on the right that rotates when open, the value in semibold
  once something is chosen), opening a **list drawn in place beneath it** (not a portal).
- `src/components/schedule/TickBoxList.tsx` — the list itself and `useDismissable` (click outside
  or Escape closes; Escape returns focus to the button); real checkboxes/radios inside real labels.

Rules for reuse:

- **Extract, don't copy.** Pull the field-button + in-place list into one shared primitive (e.g.
  `components/ui/scope-dropdown.tsx` or a `TickBoxDropdown` in `components/schedule/`) that both
  the widget and the dashboard render. The widget must look and behave **exactly** as it does
  today — verify with its existing harnesses (`verify-n`, `verify-p`, `verify-q`) and screenshots
  before/after.
- **Theming.** The widget hard-codes hex values on purpose (it renders inside an iframe on someone
  else's site where `.dark` and the tokens don't exist, and `.org-theme` uses the centre's brand
  colour). The dashboard must use **tokens** (`border-input`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `ring-ring`, `bg-brand-subtle`/`text-brand-strong` for the ticked row)
  so dark mode works. Give the primitive a theme input (`"widget" | "widget-dark" | "app"` or a
  class map) — do not let Dropin's palette leak into the widget, or the widget's hexes into the
  dashboard. `docs/DESIGN.md` §2 and §3 are binding.
- **Single vs multi.** The building switcher is single-select (radio semantics, ticking the
  selected one does nothing; there is no "All" except on Overview/Analytics for owners and
  managers). The department filter is single-select with "All departments" unless you find a real
  need for multi — say so in the review if you do.
- **Sidebar fit.** In the 248px sidebar the switcher is full-width, label "Facility" above it,
  value = facility name, with a one-line muted detail under the name in the list
  ("2 departments · 1 schedule") — legible, `muted-foreground` on `card`, never on `brand-subtle`.
  In the collapsed (icon-only) sidebar it becomes the building icon opening the same list.
- **Phones.** The mobile tree sheet (`MobileTreeSheetContents.tsx`) gets the same switcher at the
  top. The department filter on a page sits in the page toolbar and stays ≥44px tall.

## Phase 1 — review (deliver this, then stop)

1. **Inventory.** Every place the dashboard reads or asks for facility / department / schedule:
   file, what it reads (sidebar selection, URL param, its own state), what it renders, and whether
   it is consistent with the sidebar today. Include the API routes and hooks that take these ids
   (`useNavTree`, `/api/nav-tree`, `SidebarNav`'s selection logic, `commandCentreHref` callers).
2. **Classification.** For every dashboard page: org-wide, facility-scoped, or
   facility+department-scoped. Flag any page whose correct answer is unclear.
3. **The shared primitive.** Its API, where it lives, the theme mechanism, and the exact list of
   widget files that change. Prove the widget's rendered markup/classes are unchanged (or list the
   intended differences, which should be none).
4. **Migration plan.** The order of changes in small, reviewable steps, each leaving the app
   working. Note anything that changes a URL or breaks a bookmarked link, and how you keep old
   links working.
5. **Risks and open questions** — especially roles (`src/lib/auth/roles.ts`: aux, coordinator,
   manager, owner scoping) and the Overview's inbox count (`useNeedsYouCount`, keyed by facility),
   which must follow the switcher.

## Phase 2 — build (after approval)

- Steps as approved, each one ending green: `tsc --noEmit`, `eslint` on touched files, and the
  relevant `scripts/verify/*` harnesses.
- `docs/DESIGN.md` §10 checks on every screen you touch: tokens only, one ink button per view,
  light and dark, focus visible, screenshots at 1440px and 390px before and after.
- Update `docs/DESIGN.md` (a short "Scope and filters" section) so the rule outlives this task.

## Out of scope

- The widget's own behaviour, options or admin configuration (`FilterEditor`, scopes, migrations
  043/065) — only its *components* are shared, unchanged in look.
- Changing route structure to path-based scope (`/dashboard/[facility]/…`). Mention it in the
  review if you think it's worth a later task; do not do it here.
