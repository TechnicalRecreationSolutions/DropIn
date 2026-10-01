# Widget studio (`/dashboard/widget`)

Where an org turns its schedule into something that lives on its own website. The audience is a
program coordinator or communications officer, not a developer — see
`docs/prompts/widget-page-redesign.md` for the full brief this was built from.

## The one distinction the UI exists to protect

| | Where it lives | How it changes | Also affects |
| --- | --- | --- | --- |
| **Published settings** — schedules shown, views + default view, brand colour, heading, visitor filters, filter section start, multi-select, print button | `widget_configs` / `widget_config_scopes` | The header's one **Publish changes** button | The org's public schedule page (`/facility/[slug]`) and every already-pasted embed, immediately |
| **Snippet options** — embed method, **theme**, height (iFrame only), and the optional one-building narrowing | Only inside the snippet on the customer's site | Copy the code again and re-paste it | Nothing until then |

The old single-card layout interleaved the two, which is what produced the recurring "I changed
it and nothing happened" reports. They are separated *structurally*: the **Schedules**,
**Appearance** and **Visitor tools** sections hold published settings and open with the note
"Changes here reach every page the widget is on as soon as you publish"; the **Install** section
holds every snippet option and opens with "These options live in the code on your site. After
changing one, copy the code again." `SECTION_SETTINGS` in `types.ts` is that line in code. It
also drives the amber dot on each tile and the "N unpublished changes" count (via
`changedSettings`, built on the same normal form as `publishedSignature`, so the two can't disagree).

Theme used to sit beside the brand colour, which made it read as a published setting. It is a
snippet option and now lives in Install. **The preview's Light/Dark toggle is a third thing:** it
only changes the preview. It starts from the snippet theme and follows it when Install changes it,
but never writes back, so flipping the preview to dark never makes the code stale.

## Layout (2026-10-01)

A dashboard, not a form. From the top:

1. **Header**: title, a status line that only says what the app knows ("Published Sep 29,
   4:12 PM" or "Not published yet", plus a link to the first published facility page; never where
   the code is embedded, which Dropin can't know), and the actions: an "N unpublished changes" pill
   and Discard while dirty (a destructive pill with the message on a publish error), outline
   **Copy embed code**, ink **Publish changes** (disabled "Published" when clean).
2. **Section tiles** (`SectionTiles.tsx`): four tiles that *are* the navigation. One
   `role="tablist"`, each tile a `role="tab"` with arrow-key movement. Each shows a summary
   (`3 schedules` / "Pool, Arena and Gym, with a switcher"; `Week grid first` + a swatch;
   `4 filters` / "Print button on"; `Script embed` / "Copy the code again" when stale) and an amber
   dot when it holds an unpublished change. **Before the first publish** the same tablist is a
   checklist: Pick what to show / Choose a look / Copy the code, plus an unnumbered "Visitor tools"
   tile so that section stays reachable. "Never published" means `/api/widget-config` returned no
   row `id`. Below 1180px the tiles go 2 × 2; below 640px they are a scrolling row of chips.
3. **Settings card** (520px) beside the **preview** (the rest). Below 1180px they stack, settings
   first, and the preview starts as a 56px bar with a Show button. Below 640px Publish/Discard move
   to a sticky bottom bar on `--tabbar-clearance`, shown only while there are changes, an error, or
   nothing has ever been published (otherwise a first-time org on a phone could not publish the
   defaults).

All four section panels stay mounted (`hidden` when closed), so an open schedule row or a picked
CMS guide survives a trip to another tile, and "Pick one under Install" can focus Install's select.

`widget_configs.updated_at` is what the status line reads. Nothing in the schema bumps it (see the
note in migration 060), so the PATCH writes it. Rows last published before 2026-10-01 show their
first save's time until their next publish.

## Files

| File | Role |
| --- | --- |
| `WidgetStudio.tsx` | Orchestrator: config state, dirty tracking, publish, preview URL, header, tiles, the four section panels |
| `SectionTiles.tsx` | The tile row, which is the tablist. Summary tiles, the first-run checklist and the phone chips are one element |
| `PreviewPanel.tsx` | The always-mounted preview beside the settings: Desktop/Tablet/Phone, preview-only Light/Dark, full-screen button |
| `PreviewWindow.tsx` | The full-screen preview dialog, opened from the panel: its own device framing, reload, open in a new tab, quick tweaks |
| `FilterEditor.tsx` | **Schedules**, whole: the schedule list. Empty = everything, one = that schedule, 2+ = a visitor switcher. Draggable rows (the grip's arrow keys reorder too), breadcrumbs, publish warnings, and an empty state when the org has no schedules at all |
| `LayoutPicker.tsx` + `LayoutThumbnail.tsx` | **Appearance**: which views are enabled (a switch per row), and which loads first ("Loads first" pill, "Load first" on the others). A locked Floorplan row explains why and links to the Map page |
| `BrandColorField.tsx` | **Appearance**: presets, hex entry with a colour chip, white-text contrast warning |
| `VisitorFilterToggles.tsx` | **Visitor tools**: which general filters (search/activity/day/time/where/age/week) visitors get |
| `FiltersStartToggle.tsx` | **Visitor tools**: whether the filter section starts open or collapsed (migration 066) |
| `MultiSelectToggles.tsx` | **Visitor tools**: "Let visitors pick several" in the Facility/Department/Schedule switcher menus (migration 065). Not the Activity/Where filters, which always allow several |
| `PrintToggle.tsx` | **Visitor tools**: the visitor Print button (`allow_print`, migration 051). Disabled with a note until 051 is applied: the studio only sends `allowPrint` when the loaded row has the column, because naming a missing column fails the whole publish |
| `InstallPanel.tsx` | **Install**: embed method, theme, one-building narrowing, height (iFrame), stale warning, code block, CMS instructions |
| `types.ts` | Shared shapes, `publishedSignature()` / `changedSettings()` (the dirty-check), `SECTION_SETTINGS` |
| `ui/switch.tsx`, `ui/segmented.tsx` | The switch and pill segmented control the sections use. Both carry the `touch-target` utility (a 44px tap area, defined in `globals.css`) |

`ui/step-card.tsx` is no longer used here; the session-template form still uses it.

## Things worth knowing before editing

- **`allowed_templates` is ordered.** `WidgetScheduleClient` boots into `[0]`, so "Loads first"
  in `LayoutPicker` is a reorder, not a separate column. Same trick in `FilterEditor`: scope
  `sort_order` is the array index the PATCH handler assigns, so the up/down arrows are free.
- **The preview is always mounted, and why.** It has been a 420px side column (too small, and it
  squeezed the forms), then a popup whose iframe existed only while open (cheap, but every tweak
  meant opening a window, which broke "change it and watch it change"). Now the settings card is a
  fixed 520px and the preview takes the rest of the row, so it is the larger column again without
  starving the forms. The iframe mounts once and **stays mounted while the page is open**: tile
  switches, the collapsed bar below 1180px (CSS `hidden`, not unmounting) and the device frame
  (only its width changes) never remount it, because a remount reloads the whole widget and drops
  whatever the admin had clicked to inside it. It reloads only when `src` changes or after a
  publish. The cost is one widget render per visit, which is the price of a live preview.
  `PreviewWindow` still exists for full screen, as a second iframe only while it is open.
- **The preview shows unsaved state** via preview-only query params on `/widget/[orgId]`
  (`preview=1` plus `templates`, `primary`, `title`, `filters`, `print`). A real embed never sends `preview`, so it
  always renders saved values; `primary` is re-validated server-side because it reaches a style
  attribute. The iframe `src` is debounced (400ms) so typing a hex doesn't reload it per keystroke.
- **`previewVersion`** forces a remount after a publish, when the `src` itself hasn't changed.
  It is the panel iframe's `key`; nothing else is.
- **There is one `widget_configs` row per org** (migration 045). It used to be keyed by
  org + facility + department, which produced a settings row per page of the customer's site —
  set by accident from the sidebar's current facility, invisible in the UI, and the reason
  `/facility/[slug]` rendered stock blue for every facility but the one that happened to own the
  row. Narrowing a single embed to one facility is now a **snippet** option in Install: the
  facility rides in `data-facility-id`, and `/widget/[orgId]` narrows the switcher to that
  facility's entries rather than ignoring it.
- **`savedState`** — not just a signature — is the baseline, so Discard can restore it after a
  publish without re-reading a stale react-query cache.
- **"Immediately" on `/facility/[slug]` needs a cache expiry.** That page's data is
  `"use cache"` with `cacheLife("hours")`, and until 2026-09-16 nothing expired it,
  so a publish (colour, views, filters, print button) reached the embed at once and the
  facility page hours later. The entry is now tagged `widgetConfigCacheTag(orgId)`
  (`src/lib/cache/tags.ts`), and the PATCH expires it with `{ expire: 0 }` right after
  the row is written. Anything else that caches this row needs the same tag.
  Facility, schedule and session edits still don't expire it; that's a separate gap.
- **`widget_configs.secondary_color` is unread by anything** and no longer has a control. Don't
  reintroduce one without a place it actually renders.

## Install offers three ways in, all the same page

| Method | Snippet | Height | Why it exists |
| --- | --- | --- | --- |
| **Script** (default) | `public/embed/widget.js` + a `<div>` | Auto — the loader listens for `dropin:resize` and regrows the iframe (so the height field is shown for iFrame only) | The good one. No scrollbar inside the host page |
| **iFrame** | a hand-written `<iframe src="/widget/[orgId]?…">` | Fixed, from the height field | Municipal and school CMSes routinely strip `<script>` from content blocks but allow an embed block |
| **Link** | the URL itself | n/a | Sites that block iframes too; also menu items, newsletters, QR codes |

Notes for anyone touching this:

- **The method lives in `WidgetStudio`, not `InstallPanel`.** The header's Copy button copies the
  same string and `snippetStale` diffs against it, so one `embedCode` has to serve both.
- **The link method copies `shareUrl`, not `widgetUrl`** — where the facility has a published
  public page, that is a better destination for a human than the bare embed frame.
- **A plain iframe gets no `widget_view` analytics.** Only `widget.js` posts to
  `/api/analytics/track`; the widget page itself passes `viewEvent: null`. Embed counts under-report
  by however many orgs choose the iframe.
- **`/widget/*` ships `frame-ancestors *` and no `X-Frame-Options`** (`next.config.ts`), which is
  what makes any of this frameable. Tightening it breaks the iframe method too, not just the loader.

## Two kinds of filtering

| | What it does | Where it lives |
| --- | --- | --- |
| **Schedule switcher** | A list *you* write — this facility, that department — that visitors pick between | `widget_config_scopes` (043), edited in `FilterEditor`, **Schedules** |
| **General filters** | Narrow whatever is on screen by activity, day, time of day, space, age, or free text | `widget_configs.enabled_filters` (044), toggled in `VisitorFilterToggles`, **Visitor tools** |

The general filters run **client-side over the week already loaded** — `filterSessions()` in
`src/lib/schedule/sessionFilters.ts`, applied by the caller just before `<ScheduleView>`, so every
layout inherits them for free (`ScheduleView` only renders; the range and filters behind
`sessions` have always been the caller's job). Both public surfaces — the embed and
`/facility/[slug]` — read the same setting, so an org configures this once.

Things that will bite:

- **Read occurrence times through `zonedDayOfWeek` / `minutesOfDayIn`**, never `getDay()` or
  `getHours()`. Occurrences are UTC-labelled wall-clock Dates; the local getters bucket a 9am
  session into the previous day on any machine west of UTC and nothing looks wrong.
- **A filter renders only when the loaded week offers two or more values for it.** That is what
  lets an org enable everything without ending up with controls that cannot change anything.
- **The activity filter groups by `templateName ?? scheduleGroupName`** — the exact string the
  views print on a session. Group by anything else and the options name things no visitor can see.
- **No portals, no tokens in `ScheduleFilterBar`.** It renders inside the embed iframe, where the
  dashboard's `.dark` class does not exist, so every colour is written out and the panel is plain
  chips rather than a floating menu.

## The switcher (Schedules), and its four traps

The switcher is `src/components/schedule/ScheduleScopeFilters.tsx` — **one component, rendered
both by the widget's `ScheduleHeaderBar` and by the landing hero** (`LiveWidgetDemo`), so the
marketing picture is the real control. The editor no longer draws one: it opened with a rendered copy in the brand colour, a second and always-partial preview one click from the real one.
It is three menus — Facility, Department, Schedule — that always show, even with one option each,
because together they say which building's pool is on screen. What a pick *means* is one module,
`src/lib/schedule/scopeSelection.ts`, shared by the embed, the studio preview (an iframe of the
embed) and the landing hero (`heroWidgetSample.ts` builds the same tree), so the three cannot
disagree:

- Each menu opens the same tick-box list as the filter bar (`TickBoxList.tsx`). **Nothing ticked is
  "All …"** — "All departments" and "All schedules" are the empty menu's label, never rows.
- Levels combine like the filter bar's filters: any tick within a level, all levels at once. Each
  menu only offers what passes the ones above it; changing one re-fits those below.
- **Pick one or several** is the org's choice per level, under the studio's Visitor tools
  (`widget_configs.multi_select_levels`, migration 065, default none). One-at-a-time ticks replace,
  and clicking the ticked one goes back to "All". The landing hero has all three on.
- The selection resolves to **schedule ids**, and the embed asks `/api/sessions/expand` for exactly
  those (`scheduleGroupId=a,b,c`, at most 250). Never by facility or department: a widget set to one
  schedule of building A and all of building B must not show the rest of A when a visitor leaves
  everything on "All". verify-bh's "never building C" check is the one that fails if this regresses.
- It opens on the org's first entry (that facility, department or schedule), not on "All".
- The floorplan draws one building; with several ticked, it says to pick one rather than silently
  showing the grid.

### The filter section folds (migration 066)

The visitor filters (`ScheduleFilterBar`) always sit behind a **"Filters" toggle** — embed, public
facility page and landing hero alike. Visitor tools' **"Filter section starts: Open / Collapsed"**
(`FiltersStartToggle.tsx`, `widget_configs.filters_collapsed`, default open) only picks the first
look; visitors can open or fold it either way. A folded section still shows the active-filter count
on the toggle, and the result count + "Clear filters" sit outside the fold, so folding never hides
that something is filtering. The preview override is `collapsed=1|0` (ignored without `preview=1`).
The choice is disabled when every filter is off — there is no section to fold. The landing hero is
controlled instead: open from `sm` up, folded on a phone. verify-bi covers all of it.

A saved filter is a *region*, and the menus narrow inside it (`buildScopeTree` in
`/widget/[orgId]/page.tsx`): a facility-wide filter contributes every live schedule in the building
(those with no department first, then each published department's), a department-wide one that
department's, a schedule-level one itself — under the label the org typed for it. A building or
department with no live schedule is not offered at all: it could only ever show an empty week. The
route filters publish state itself — signed out RLS would hide drafts anyway, but the preview iframe
carries the admin's session (verify-p section 7 is the check that fails without it).

1. **Publish state decides visibility, not the save.** Migration 043's public policy hides any
   scope whose facility, department or schedule is unpublished. An entry on a draft schedule saves
   with a 200 and never appears for anyone. Every row that would vanish says so and names the
   level to publish; the same applies to the snippet's own narrowing in Install, where naming an
   unpublished facility makes the real embed fall back to *every* facility.
2. **The preview is signed in.** The iframe is same-origin and carries the admin's session, so RLS
   shows staff more than a visitor gets. The scope list is corrected for this — the route filters
   publish state itself rather than trusting anonymous RLS — but unapproved weeks (migration 037)
   and draft schedules' *sessions* are still visible in a preview and not on the real site.
   Anything else added to this page that depends on publish state needs the same treatment.
3. **The list is the only thing that says what an embed shows.** `WidgetScheduleClient` renders
   what the list's entries reach and ignores everything else, which is what made
   the old facility tiles a lie: they addressed a settings row, looked like a content control, and
   lost to any entry in this list. Migration 045 removed them. Empty list = everything the org
   runs; one entry = that schedule with no switcher; two or more = the switcher.
4. **`widget_config_scopes.facility_id` is NOT NULL.** There is no "everything we run" *entry*,
   only the empty list. A visitor still gets "All" across two configured facilities — it is the
   empty Facility menu, bounded by the entries — but an *entry* meaning "every facility, including
   ones added later" would need a migration first, not a UI change.
