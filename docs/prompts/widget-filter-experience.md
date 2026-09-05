# Prompt: The widget's schedule filter — make it work, make it obvious

Copy everything below the line into a fresh Claude Code session run from `C:\ForRec\dropin`.

---

## The mission

One embed, several schedules, and a way for a visitor to switch between them. That is the most
valuable thing the widget can do for a multi-building recreation centre, and right now it is the
least finished part of the page: what the admin is shown while building it does not match what
gets rendered, neither side says what a filter actually *covers*, and a filter can be saved that
visitors will never see with nothing anywhere telling anyone why.

Make the filter honest, obvious and complete — on both sides of the glass. The admin's step 3
should show the real thing, name the facility / department / schedule behind every entry, and
refuse to lie about whether it will appear. The visitor's filter should be discoverable in one
glance, switchable in one tap, and clear about what it is showing them.

## How it is actually used

**The visitor** is on a rec centre's own website, on a phone, in a hurry. They do not know the
organization's structure and they will not go looking for a control. If switching between "Pool"
and "Arena" is not visible in the first second, it does not exist. When they do switch, they need
to be sure what they are now looking at — "Pool" alone is ambiguous the moment an org has two
buildings with pools.

**The admin** sets this up once, from step 3 of `/dashboard/widget`, usually right after loading a
season's schedules. They think in the structure they built in Dropin — Aquatic Centre → Aquatics →
Lane Swim — and they are naming visitor-facing tabs from it. Their two failure modes are picking
the wrong level (a whole building when they meant one schedule) and picking something that is not
published yet, which currently produces a filter that saves cleanly and then never appears.

## Current state (read these before touching anything)

- **Schema**: `supabase/migrations/043_widget_config_scopes.sql`. Each row is
  `(label, facility_id, department_id?, schedule_group_id?, sort_order)` against a
  `widget_configs` row. Two RLS read policies: staff see every scope regardless of publish
  state; **the public policy only returns scopes whose entire chain is published** (facility
  `is_published`, department `is_published`, schedule group `status = 'published'`).
- **Write path**: `PATCH /api/widget-config` replaces the whole list, re-deriving a scope's
  department from its schedule group and rejecting cross-org ids. `sort_order` = array index.
- **Admin editor**: `src/components/widget/FilterEditor.tsx` — rows of three selects plus a
  hand-drawn `SwitcherMock` of coloured pills.
- **Visitor renderer**: `src/app/widget/[orgId]/page.tsx` loads the scopes →
  `WidgetScheduleClient` → `ScheduleHeaderBar`, which when given `scopeOptions` **replaces its
  title with a Radix Select** of the labels. `WidgetScheduleClient` drives
  `useTemplateSchedule` off the active scope's facility/department/schedule ids.
- **Harnesses**: `verify-n` (HTTP: saving, RLS, SSR markup), `verify-p` (browser: picking an
  option really re-scopes the data), `verify-q` (the studio).

### What's wrong, concretely

1. **Step 3 shows a drawing, not the component.** `SwitcherMock` renders coloured pills. The
   widget renders a dropdown. The admin designs against a picture of a UI that does not exist —
   which is exactly the inconsistency that prompted this work.
2. **The switcher eats the heading.** With filters on, `ScheduleHeaderBar` swaps its `<h2>` for
   the Select, so the org's `custom_title` silently stops rendering the moment a second filter is
   added, and the visitor is left with a bare label they have no reason to think is a menu.
3. **Nothing says what a filter covers.** Neither the editor rows nor the widget name the
   facility, department or schedule behind an entry. "Pool" is unambiguous to the person who
   typed it and to nobody else.
4. **The publish trap is silent.** A scope pointing at a draft schedule (or an unpublished
   department or building) saves with a 200, shows in the editor forever, and is invisible to
   every visitor. The editor never mentions publish state.
5. **The same trap one level up.** Step 1 will happily scope the whole embed to an unpublished
   building; anonymous RLS then can't see that facility, and the real embed quietly falls back to
   showing *every* building.
6. **The preview is signed in.** The preview iframe is same-origin, so it carries the admin's
   session and RLS shows them things a visitor does not get. The scope list is fixable (filter it
   by publish state in the route rather than relying on RLS to do it for anonymous callers only);
   the deeper divergence — unapproved weeks (migration 037) and draft schedules being visible to
   staff — is not, and must at least be said out loud.
7. **One control for two very different sizes.** A dropdown makes two options cost two taps;
   twenty options would overflow any pill row. Neither shape is right for both.

## Design principles

1. **The editor renders the real component.** No hand-drawn mock. One filter component, imported
   by both the widget and step 3, is the only durable way these stay in agreement.
2. **Name the thing.** Every filter, on both sides, carries its facility › department › schedule
   context wherever there is room for it.
3. **Tell the truth about visibility.** If a saved filter cannot be seen by the public, say so
   where it is edited, in words that name the fix ("Lane Swim is still a draft").
4. **Discoverable in a glance, switchable in a tap** — for the common case of two to four
   schedules. Degrade to a grouped dropdown when there are more.
5. **The heading survives.** Adding a filter must not remove the org's own title.
6. **Mobile first.** 320px embed on a phone is the design target; the filter row scrolls rather
   than wraps into a mess, and every target is thumb-sized.

## Scope of work

### A. One shared filter component

Extract the visitor-facing switcher into its own component used by both the widget header and the
editor's preview. Two shapes behind one API:

- **Up to four scopes**: a segmented pill row, all options visible, active one filled, keyboard
  navigable, horizontally scrollable at narrow widths.
- **Five or more**: the dropdown, with each option carrying its context as a second line, grouped
  by building where that helps.

It keeps its place inside the coloured header bar (that was a deliberate earlier decision) but
gets its own row there, so the title stays and the pills get the full width.

### B. The active scope's context, on screen

The widget must be able to say *Aquatic Centre › Aquatics › Lane Swim*, which means the route has
to load names, not just ids: extend the scope query in `src/app/widget/[orgId]/page.tsx` to embed
facility/department/schedule names and publish state, and **filter unpublished chains explicitly**
so a signed-in admin previewing the widget sees the same filter list a visitor will. Show the
context under the switcher, suppressing whatever the label already says.

### C. Step 3, rebuilt around what it produces

- Preview with the real component, in the org's brand colour, reflecting the rows as typed.
- Per row: a facility › department › schedule breadcrumb, a label placeholder that follows the
  deepest selection (pick "Lane Swim" and the placeholder becomes "Lane Swim"), and publish state
  shown against every option in the selects.
- A blocking-looking (but non-blocking) warning on any row whose chain is not fully published,
  naming the level that is not published.
- The empty state earns its CTA: offer one-click "add one filter per building" alongside the
  manual add, since the two-to-four-building case is the whole point.
- Say what one filter alone does (scopes the embed, shows no menu) rather than leaving it to be
  discovered.

### D. Step 1's version of the same trap

Mark unpublished buildings in the scope picker and warn when one is selected, naming the
consequence: the public embed will fall back to showing every building.

### E. Verification

`verify-n` and `verify-p` both encode the *old* dropdown markup and will need updating rather
than deleting — keep every assertion's intent (default selection, unpublished scope hidden, the
data really re-scoping, switching back working) and re-point them at the new shape. Add coverage
for: a department-only scope re-scoping correctly (only schedule-group scopes are covered today),
the context line rendering real names, an unpublished-chain scope being absent from a
*signed-in* preview, and the editor's publish warning appearing.

## Constraints

- No schema change: `widget_config_scopes` and the PATCH contract stay as they are.
- Do not regress the three non-widget `ScheduleHeaderBar` callers (facility page, command centre)
  — they pass no scopes and must render exactly as they do now.
- Keep the existing correctness rules: a row without a facility is dropped on save, an unlabelled
  row falls back to its facility's name, one scope still drives the data even though it shows no
  menu, and a schedule's own department is the source of truth for its scope.
- This Next.js version has breaking changes — read the relevant guides in
  `node_modules/next/dist/docs/` before writing code (per AGENTS.md).
- Verify against the running app with the harnesses, not just a passing build.

## Part 2: general filters — "when can I actually come?"

The switcher above answers *which schedule*. It does not answer the question a visitor actually
arrives with, which is some combination of "is Water Walking on this week?", "what's on a
Tuesday?" and "is there anything after work?" Right now a schedule is a wall of sessions and the
only way through it is to read all of them.

### What to build

A **filter bar** under the header, applying to whatever schedule is on screen, across every
layout (grid, list, by-space, timetable, floorplan — they all render from the same
`ExpandedSession[]`, so filter at the caller and every view inherits it).

The set worth having, all admin-toggleable:

- **Search** — free text over activity, schedule, space, location, age, skill. Multi-word ANDs.
- **Activity** — the name printed on each session (`templateName ?? scheduleGroupName`, e.g.
  "Water Walking"). Options derived from the week in view, never a static list.
- **Day** — the days someone can actually come.
- **Time of day** — morning / afternoon / evening.
- **Where** — which pool, court, studio.
- **Who it's for** — the age group, where the org fills it in.
- **Jump to a week** — a date, instead of paging one week at a time.

### Rules the filtering has to follow

1. **AND across dimensions, OR within one.** "Monday or Wednesday, in the morning."
2. **Empty means no opinion**, never "match nothing" — otherwise an untouched filter bar shows an
   empty schedule.
3. **Never offer a filter that can't change anything.** A control appears only when the loaded
   week has two or more distinct values for it, so an org can enable everything without getting a
   row of single-option controls.
4. **Filtering everything out must say so**, distinctly from a genuinely empty week, and offer one
   click back.
5. **Read occurrence times through the session helpers** (`zonedDayOfWeek`, `minutesOfDayIn`),
   never `getDay()`/`getHours()`. Occurrences are UTC-labelled wall-clock Dates; the local getters
   bucket an early session into the previous day on any machine west of UTC, silently.
6. **Client-side, over the week already loaded.** No new query shape, no round trip per chip.
7. **No portals.** This renders inside a themed iframe on someone else's site; chips in an
   expandable panel behave, floating dropdown menus do not. Every colour explicit — the
   dashboard's `.dark` class does not exist in the embed.

### Admin control

A new `widget_configs.enabled_filters` (additive migration, CHECK-constrained to the known keys,
empty array = no filter bar) and a block of toggles in step 3 alongside the schedule switcher, so
one step answers "how can visitors narrow this down" in both senses. The same setting drives the
embed and the public facility page — configured once.

### Verification

A browser harness with three activities placed to make each dimension independently falsifiable:
two on the *same day* at different times (so a day filter can't stand in for a time filter) and
one on a *different day* (so the timezone-sensitive day bucketing is actually exercised). Plus
both directions of every narrowing, the AND/OR semantics, the no-matches state, single-option
suppression, and the admin toggle really removing a control from the live embed.

## Definition of done

- Step 3's preview and the widget are the same component; they cannot drift.
- A visitor can find "Water Walking on a Tuesday evening" without reading the whole schedule.
- Every general filter is the org's choice, and no enabled filter ever renders as a control that
  cannot change what is on screen.
- Every filter names its building, department and schedule — in the editor and, for the active
  one, in the widget.
- A filter that visitors cannot see is impossible to save without being told, in the editor, why.
- Two to four schedules switch in one tap; twenty are still usable.
- The org's heading still renders with filters on.
- A signed-in preview shows the same filter list as an anonymous visitor, and the places where
  preview and reality still differ are stated on screen.
- `verify-n`, `verify-p` and `verify-q` all green against the new shape, with the department-only
  scope and publish-warning cases added.
