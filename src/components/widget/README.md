# Widget studio (`/dashboard/widget`)

Where an org turns its schedule into something that lives on its own website. The audience is a
program coordinator or communications officer, not a developer — see
`docs/prompts/widget-page-redesign.md` for the full brief this was built from.

## The one distinction the UI exists to protect

| | Where it lives | How it changes | Also affects |
| --- | --- | --- | --- |
| **Published settings** — views + default view, brand colour, heading, visitor filters | `widget_configs` / `widget_config_scopes` | The single **Publish changes** bar | The org's public schedule page (`/facility/[slug]`) and every already-pasted embed, immediately |
| **Snippet options** — theme, height, embed method | Only inside the snippet on the customer's site | Re-copy the code and re-paste it | Nothing until then |

The old single-card layout interleaved the two, which is what produced the recurring "I changed
it and nothing happened" reports. They are now separated *structurally* — published settings sit
in steps 2 and 3 under a "Published with the widget" badge, snippet options in step 4 (theme
excepted, as a visual choice, which is why the code panel flags itself as stale after a change).

## Files

| File | Role |
| --- | --- |
| `WidgetStudio.tsx` | Orchestrator: scope + config state, dirty tracking, publish, preview URL, the four steps |
| `StepCard.tsx` | Numbered step chrome |
| `ScopePicker.tsx` | Step 1 — which building/department this embed shows |
| `LayoutPicker.tsx` + `LayoutThumbnail.tsx` | Step 2 — which views are enabled, and which loads first |
| `BrandColorField.tsx` | Step 2 — presets, hex entry, white-text contrast warning |
| `VisitorFilterToggles.tsx` | Step 3 — which general filters (search/activity/day/time/where/age/week) visitors get |
| `FilterEditor.tsx` | Step 3 — the visitor-facing schedule switcher: rows, breadcrumbs, publish warnings, and a preview built from the real `ScheduleScopeSwitcher` |
| `InstallPanel.tsx` | Step 4 — embed method, snippet, height, CMS instructions |
| `PreviewWindow.tsx` | Near-fullscreen preview dialog: the real `/widget/[orgId]` in an iframe, desktop/tablet/phone framing, quick-tweak strip |
| `types.ts` | Shared shapes + `publishedSignature()`, the dirty-check |

## Things worth knowing before editing

- **`allowed_templates` is ordered.** `WidgetScheduleClient` boots into `[0]`, so "Loads first"
  in `LayoutPicker` is a reorder, not a separate column. Same trick in `FilterEditor`: scope
  `sort_order` is the array index the PATCH handler assigns, so the up/down arrows are free.
- **The preview is a window, not a column.** It first shipped as a 420px sticky panel beside
  the steps, which gave the page's most important artifact its smallest box and squeezed the
  forms into ~660px. It now opens near-fullscreen from three places (header CTA, the floating
  pill, and the publish bar — the pill hides while the bar is up so they never collide), and
  **its iframe only exists while it is open**, so an ordinary visit no longer renders a widget
  nobody is looking at. Because a popup breaks "change it and watch it change", the window
  repeats the two most visual controls (brand colour, light/dark) on a strip along its bottom;
  they write to the same state the steps do.
- **The preview shows unsaved state** via preview-only query params on `/widget/[orgId]`
  (`preview=1` plus `templates`, `primary`, `title`). A real embed never sends `preview`, so it
  always renders saved values; `primary` is re-validated server-side because it reaches a style
  attribute. The iframe `src` is debounced (400ms) so typing a hex doesn't reload it per keystroke.
- **`previewVersion`** forces a remount after a publish, when the `src` itself hasn't changed.
- **Switching scope swaps the whole saved row** (`widget_configs` is keyed by
  org + facility + department), so `WidgetStudio` intercepts it while there are unsaved edits and
  offers publish / discard / cancel rather than silently dropping them.
- **`savedState`** — not just a signature — is the baseline, so Discard can restore it after a
  publish without re-reading a stale react-query cache.
- **`widget_configs.secondary_color` is unread by anything** and no longer has a control. Don't
  reintroduce one without a place it actually renders.

## Step 4 offers three ways in, all the same page

| Method | Snippet | Height | Why it exists |
| --- | --- | --- | --- |
| **Script** (default) | `public/embed/widget.js` + a `<div>` | Auto — the loader listens for `dropin:resize` and regrows the iframe | The good one. No scrollbar inside the host page |
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

## Two kinds of filtering, both configured in step 3

| | What it does | Where it lives |
| --- | --- | --- |
| **Schedule switcher** | A list *you* write — this building, that department — that visitors pick between | `widget_config_scopes` (043), edited in `FilterEditor` |
| **General filters** | Narrow whatever is on screen by activity, day, time of day, space, age, or free text | `widget_configs.enabled_filters` (044), toggled in `VisitorFilterToggles` |

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

## The switcher (step 3), and its two traps

The switcher is `src/components/schedule/ScheduleScopeSwitcher.tsx` — **one component, rendered
both by the widget's `ScheduleHeaderBar` and by this editor's preview**, so the two cannot drift.
It is a pill row up to four scopes and a Select beyond that, and it shows the active scope's
`facility › department › schedule` context underneath, because a label alone can't distinguish two
buildings that both have a pool. `/widget/[orgId]` builds that context by embedding the three
names in its scope query.

1. **Publish state decides visibility, not the save.** Migration 043's public policy hides any
   scope whose facility, department or schedule is unpublished. A filter on a draft schedule saves
   with a 200 and never appears for anyone. Every row that would vanish says so and names the
   level to publish; the same applies one step up, in step 1, where scoping the whole embed to an
   unpublished building makes the real embed fall back to *every* building.
2. **The preview is signed in.** The iframe is same-origin and carries the admin's session, so RLS
   shows staff more than a visitor gets. The scope list is corrected for this — the route filters
   publish state itself rather than trusting anonymous RLS — but unapproved weeks (migration 037)
   and draft schedules' *sessions* are still visible in a preview and not on the real site.
   Anything else added to this page that depends on publish state needs the same treatment.
