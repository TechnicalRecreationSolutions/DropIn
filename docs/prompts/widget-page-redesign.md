# Prompt: Embed Widget page — "Publishing Studio" redesign

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

`/dashboard/widget` is where a recreation centre turns everything it has built in Dropin into
something the public actually sees: a schedule living on the centre's own website. It is the
last mile of the entire product, and today it looks like a settings form somebody wired up in
an afternoon. Redesign it into a **publishing studio**: a screen where a non-technical staff
member can see what they are about to publish, change it, and walk away with working code — in
one sitting, without asking anyone what "allowed templates" means.

## Who uses this page, and how (internalize this before designing)

**The person.** Not a developer. A rec-centre program coordinator, aquatics supervisor, or
communications officer at a municipality. They can use Canva and a CMS. They have never written
HTML. They own the schedule content but usually *not* the website — someone else, often a
contractor or a city IT department, controls where the code goes.

**The frequency.** This is a page you visit three or four times ever, not daily. Nothing about
it can rely on learned muscle memory. Every visit is effectively a first visit:

1. **Setup (once, ~10 minutes).** "We just finished loading the fall schedule. Get it onto the
   website." They arrive with a goal they can state in one sentence, and no vocabulary for any of
   the settings. Success = a block of code in their clipboard and confidence that what appears on
   the website will look right and on-brand.
2. **The hand-off (immediately after).** They rarely paste the code themselves. They email it,
   or drop it in a ticket, to the person who runs the website. The page has to produce something
   *portable* and self-explanatory — and it must offer the escape hatch for organizations whose
   CMS forbids script tags: a plain link they can hyperlink from a menu.
3. **Seasonal edits (a few times a year).** "Add the new arena", "the pool has its own schedule
   now", "our brand colour changed", "make the list view the one that loads first". They come
   back to change exactly one thing and leave. They must find that one thing in seconds and be
   certain it took effect.
4. **Troubleshooting (worst case).** "It's on the site but it's showing the wrong building" or
   "I changed it last week and nothing happened." This is the page's failure mode, and almost
   always it is a *saved-vs-not-saved* or *scope* misunderstanding the UI created.

**The mental model they arrive with.** "I am making a little schedule box for our website." They
think in terms of the *result* — a box on a page — not in terms of a config row keyed by
`(org, facility, department)`. The current page asks them to think in our data model. It should
ask them to think about their box.

**The two questions they are silently asking the whole time.**
- *"What is this going to look like on our site?"* — answered only by a live preview, visible
  while they change things.
- *"Is this live yet?"* — answered only by an unambiguous, always-visible saved/unsaved state.

Everything else on the page is secondary to those two.

## Current state (read these before touching anything)

- **Page shell**: `src/app/(dashboard)/dashboard/widget/page.tsx` — `max-w-3xl`, static header,
  Suspense-gated body that loads the org's facilities and forwards the sidebar's current
  facility/department as pre-selection.
- **Everything else**: `src/components/widget/WidgetConfigurator.tsx` (~720 lines, one file) —
  three stacked cards ("Configuration", "Appearance", "Filters") plus a Code/Preview tab strip.
- **Persistence**: `src/app/api/widget-config/route.ts`. GET is public (mirrors the
  `widget_configs_public_read` RLS policy). PATCH upserts one `widget_configs` row per
  `(org_id, facility_id, department_id)` and replaces the whole `widget_config_scopes` list
  (`sort_order` = array index, so client-side reordering is free).
- **What the code actually produces**: `public/embed/widget.js` builds an iframe pointed at
  `/widget/[orgId]`, auto-resizes via `postMessage`. The rendered widget is
  `src/app/widget/[orgId]/page.tsx` → `WidgetScheduleClient` → `ScheduleHeaderBar` +
  `ScheduleView`. `?preview=1&templates=…` already lets the dashboard preview an *unsaved*
  layout choice; a real embed never sends it.

### What's wrong, concretely

1. **No feedback loop.** The preview is a *tab*, sitting behind the code snippet, below three
   cards of controls. You can never see a control and its effect at the same time. Every setting
   on this page is a visual decision made blind.
2. **Saved and unsaved settings are interleaved with no visual distinction.** Facility, theme and
   height only change the snippet text. Layouts, colour and title write to the database *and*
   change the org's public schedule page. Filters write to a second table. There is one button
   labelled "Save appearance" that also saves filters, plus a second amber "Save filters" button
   that appears conditionally. This is the single largest source of "I changed it and nothing
   happened."
3. **Flat, undifferentiated hierarchy.** Three identical white cards with 14px bold headings, in
   an order that matches our schema rather than the user's task. There is no beginning, no end,
   and no visible answer to "am I done?"
4. **Two controls are decorative.** `secondary_color` is written to the database and read by
   nothing. `custom_title` likewise — the widget header hardcodes the string `"Schedule"`. A
   control that does nothing is worse than a missing one; it teaches people the page lies.
5. **The filter editor is a spreadsheet.** Four raw `<select>`s and a Label field crammed into a
   five-column grid, with no empty state explaining why anyone would want this — which is a
   shame, because "one embed, many schedules" is the most valuable thing on the page.
6. **The payoff is styled as a developer artifact.** Green-on-black monospace, a small "Copy"
   button, and the caption "Paste this into your website's HTML" — addressed to a person who is
   not on this page. No instructions for the CMSes these organizations actually run, and no
   link-only option for the ones that ban script tags.
7. **Scope switching is silent and lossy.** Changing the facility swaps the entire config row
   underneath any unsaved edits, with no warning.

## Design principles (the spec for every decision)

1. **Show, don't describe.** A live preview is on screen whenever a visual choice is being made.
   Layouts are picked from pictures of themselves, not from a five-across row of 16px icons.
2. **One save, always visible.** Everything persisted publishes together, from one place, with
   the current state ("Published" / "Unsaved changes") legible at a glance from anywhere on the
   page. Settings that only alter the snippet live in the snippet's own section, so the
   distinction is *structural* rather than a warning label.
3. **The page is a sequence, not a pile.** Numbered steps in the order the user thinks:
   what to show → how it looks → optional filters → put it on the site. The last step is the
   payoff and looks like it.
4. **CTA boxes carry the moments that matter.** The headline action (get the code) at the top,
   an inviting empty state for filters, and a publish bar when there is something to publish.
   These are the three places a user gets stuck; each gets a designed, coloured, unmissable box
   rather than a text link.
5. **Mobile-first.** This is a hard product requirement. Everything above works on a phone: the
   preview becomes a bottom sheet, the steps stack, the publish bar is a fixed footer, and no
   control depends on hover.
6. **No decorative controls.** Every field either changes something visible or is removed.
7. **Plain language over data-model language.** "Which building?" not "Facility (optional)".
   "Which views can visitors switch between?" not "Allowed templates".

## Scope of work

### A. Restructure the page into a studio

- Widen the route shell and give the steps the full width.
- The preview opens as a **near-fullscreen window**, reachable from the header CTA, a floating
  pill, and the publish bar. (First built as a sticky 420px side column; that put the page's
  most important artifact in its smallest box and left the forms at ~660px, so it became a
  window. Since a popup breaks the see-it-as-you-change-it loop, the window carries brand
  colour and light/dark on a strip of its own.)
- Split `WidgetConfigurator.tsx` into focused components under `src/components/widget/` with a
  folder README, keeping the orchestrator thin.

### B. The header CTA box

A single tinted box directly under the page title carrying: a one-line plain-English summary of
what this embed shows, the publish state, the primary **Copy embed code** button, and a
**Preview** affordance. It is the first thing on the page and answers "what am I making, and can
I have it now?" before any control is touched.

### C. Step 1 — What to show

- Replace the facility/department `<select>`s with visual choices (an "Everything" card plus one
  card or pill per building, then departments once a building is chosen).
- Say out loud, in the section, that each building/department combination is its own embed with
  its own code and its own look.
- Switching scope while there are unsaved edits must prompt (save / discard / cancel), not
  silently discard.

### D. Step 2 — How it looks

- **Layout picker as thumbnails**: hand-drawn SVG wireframes of grid / list / map / board /
  floorplan, click to enable, with a visible **"Loads first"** marker that the user can move —
  `allowed_templates` is an ordered array and the widget already boots into `[0]`, so making the
  default explicit needs no migration.
- **Brand colour**: curated preset swatches + custom picker + hex entry, applied live in the
  preview, with a legibility warning when the chosen colour cannot carry white header text.
- **Header title**: keep the control, and *wire it up* — `ScheduleHeaderBar` should show
  `custom_title` where it currently hardcodes `"Schedule"`.
- **Delete the secondary-colour control** (leave the column; it is unread).
- Theme (light/dark) belongs here visually, but it travels in the snippet — treat it as such and
  make the code section announce when the snippet has changed since it was last copied.

### E. Step 3 — Filters (the underused superpower)

- A designed empty state: a miniature of what visitors get (a header bar with "Pool / Gym /
  Arena" pills), the one-sentence pitch, and one button.
- Each filter becomes a card — index, prominent label field, and a facility › department ›
  schedule breadcrumb of compact pickers — with reorder controls (free: `sort_order` is the array
  index) and the live "shows up as a pill named X" echo.
- Keep the existing correctness guards: a row without a facility is dropped, an unlabelled row
  falls back to its facility name, and the list is only a *visitor* filter at 2+ entries while a
  single row still scopes the data.

### F. Step 4 — Put it on your site

- The snippet in a designed panel (not a terminal), with a large copy button, the height control,
  and a "what this does" line addressed to the person who will paste it.
- **Installation help** for WordPress / Squarespace / Wix / generic HTML — three steps each,
  collapsed by default.
- **The link alternative**: a copyable public URL for organizations that cannot embed scripts,
  plus "open in a new tab".

### G. Wiring and docs

- `/widget/[orgId]` gains preview-only `primary` and `title` params (guarded by the existing
  `preview=1`, validated) so the live preview reflects unsaved colour/title, and reads
  `custom_title` from the config for real embeds.
- Folder README documenting the component split and the saved-vs-snippet distinction.

## Constraints

- Mobile-first is a hard requirement; verify at 390px.
- No new dependencies. Reuse the existing UI primitives (`Dialog`, `Sheet`, `Select`, `Skeleton`)
  and match the dashboard's established visual idiom (`bg-card` + `border-border` cards, dashed
  empty states, `blue-600` primary buttons) rather than inventing a parallel style.
- Additive API changes only — the current PATCH contract and the `widget_configs` /
  `widget_config_scopes` schema stay as they are. No migration should be necessary.
- Preview parameters must remain preview-only and validated; a real embed always renders saved
  values.
- This Next.js version has breaking changes — read the relevant guides in
  `node_modules/next/dist/docs/` before writing code (per AGENTS.md).
- Verify in the running app, not just a passing build: change a colour and watch the preview,
  publish, re-open the page, and load the real `/widget/[orgId]` embed.

## Definition of done

- A staff member who has never seen the page can, without help: pick what to show, choose views
  and a brand colour while watching them change, publish, and copy code — and can tell at every
  moment whether what they are looking at is live.
- The preview is always one click away, opens at a size worth looking at, and can be tweaked
  without closing it.
- There is exactly one publish action, and its state is visible from anywhere on the page.
- No control on the page writes to a column nothing reads.
- Layout choice, default view, brand colour, title and filters all provably reach the real
  `/widget/[orgId]` embed.
- Filters have an empty state that makes someone *want* to use them.
- The code section tells the reader where to paste it, and offers a link for the sites that
  cannot.
