# Schedule list view + sidebar Facility &gt; Department &gt; Schedule tree

## Where this comes from

A user-supplied prompt asked for a RecStaff-style "schedule list view" home
screen, with explicit authority to rework navigation if the current layout
didn't serve it. The build followed that prompt's own checkpoint structure —
Phase 0 (navigation audit) → Phase 1 (data audit) → Phase 1.5 (layout
proposal) → Phase 2 (component design) → Phase 3 (build) — each with a real
stop for user confirmation, not skipped.

**One thing changed the plan mid-flight.** Phase 1.5's first proposal kept
the sidebar untouched (facility list only, per the 2026-08-04 flattening —
see `TreeNavContent.tsx`'s own comment on why that happened). After seeing
it, the user pushed back explicitly: *"I want you to actually leverage using
the side navigation more... create a new way to filter by facility,
department and schedule."* That's the three-level tree this shipped —
resurrected, but as an accordion (one facility open at a time) rather than
the fully-expanded tree that made the sidebar "unusably tall" the first
time around, and added *alongside* the command centre's existing chip
picker rather than replacing it.

## State right now (2026-08-16)

- Working tree **clean**, `main` **pushed to `origin/main`** at `8a98ebe`.
- This work is specifically commit **`2c7439f`** — `feat(dashboard): schedule
  list view + sidebar Facility>Department>Schedule tree`. The three commits
  after it (`947b487`, `5d7181e`, `8a98ebe`) are unrelated leftover work from
  an earlier session (schedule-group/session form field consolidation, a
  brochure candidacy fix, and a reference PDF) that got committed and pushed
  in the same request — don't confuse them with this track.
- **Migration `035_schedule_group_modified_tracking.sql` is applied** to the
  hosted database (pasted into the Supabase SQL editor by the user, same
  process as every prior migration — this project has no CLI migration
  push). Rollback at `supabase/rollbacks/035_schedule_group_modified_tracking.sql`.
- `npx tsc --noEmit`, `npx eslint`, `npx next build` all clean.
- `node scripts/verify/verify-h.mjs` — **24/24 assertions pass** (published_at
  transition logic, the session-write trigger, duplicate's field/template
  copy + session exclusion, role gating, cross-org isolation, cascade
  delete).
- **Verified live in a browser**, not just via the harness: a throwaway
  seeded org (2 facilities, 5 status states, a no-department facility) was
  clicked through end-to-end — all five status badges, the All/Active/Draft
  filter, sort, the collapsed Stored section, Duplicate (real API round
  trip + list/sidebar refresh), Delete (confirm dialog + real cascade), and
  the Edit action's deep link straight into the command centre pre-scoped to
  the exact schedule. The probe script and its org/user were deleted after.

## What shipped

- **`schedule_groups.published_at`** (migration 035) — set only on the
  transition INTO `'published'`, never on an ordinary edit to an
  already-published row. Compared against `updated_at` to derive the
  **MODIFIED** status.
- **Two DB triggers** (`sessions_touch_schedule_group`,
  `session_exceptions_touch_schedule_group`) that bump the parent
  `schedule_groups.updated_at` whenever a session or session_exception
  changes — needed because staff mostly edit a published schedule by
  touching its *sessions*, not the schedule_groups row itself, and nothing
  else in this schema had ever bumped `updated_at` on `UPDATE` (see the
  migration's own header — this was a pre-existing, unrelated gap that
  happened to matter now).
- **`PATCH /api/schedule-groups/[id]`** now sets `updated_at` explicitly on
  every write (it never did before), and `published_at` on the
  draft→published transition only.
- **`POST /api/schedule-groups/[id]/duplicate`** (new) — copies the
  schedule's own fields and its `session_templates` +
  `session_template_spaces`, not its sessions (the whole point of
  duplicating is placing fresh ones into new dates). Always creates a
  `draft`.
- **`DELETE /api/schedule-groups/[id]`** (new) — hard delete, mirroring
  `/api/facilities/[facilityId]`'s existing pattern. There is no
  soft-delete/archive column anywhere in this schema; one wasn't invented
  just for this.
- **`src/lib/schedule/scheduleStatus.ts`** — `deriveScheduleStatus()`, pure,
  five states: `unfinished → modified → active → published → stored`, in
  that precedence order (stored wins over everything on dates alone;
  modified wins over active/published once published).
- **Sidebar rebuilt** (`TreeNavContent.tsx`, `TreeNavNode.tsx`) — accordion
  Facility → Department → Schedule tree (one facility expanded at a time),
  each facility also getting Spaces/Map/Widget leaves. `TreeNavNode` gained
  an `expandable`/`expanded`/`onToggleExpand` chevron, rendered as a sibling
  of the row's `<Link>`, not nested inside it.
- **Overview page rewritten** (`src/app/(dashboard)/dashboard/page.tsx`) —
  now the schedule list itself: facility-scoped (via `?facility=`, driven by
  the sidebar; defaults to the alphabetically-first facility), two sections
  (current/active, Stored collapsed by default), the All/Active/Draft
  filter, sortable columns. The old stats row and "needs attention" list
  were cut — both are now redundant with status badges sitting directly in
  the list. "Recent activity" was kept, shrunk to a secondary panel.
- **`src/components/schedule-list/`** (new) — `ScheduleListSection.tsx` (the
  table + filter/sort/actions), `DuplicateScheduleDialog.tsx`,
  `DeleteScheduleDialog.tsx`.

## Deliberate deviations from the original brief

- **Spec's `Facility` column → `Department` column.** With the whole list
  already scoped to one facility (via the sidebar), a Facility column would
  repeat the same value on every row; Department is the dimension actually
  worth scanning.
- **ACTIVE vs PUBLISHED**, which the brief left ambiguous: PUBLISHED means
  live but starting later (`starts_on > today`); ACTIVE means running today
  (`starts_on` null or `<= today`).
- **Hard delete, not "soft-delete or archive"** as the brief said — see
  above, no such column exists anywhere in this schema.
- **The command centre's `FacilityBoxes`/`ScopePicker` chips were kept**,
  not removed, even after the sidebar tree shipped. They're the fast in-page
  way to pivot scope without touching the sidebar, which matters most on
  mobile where the tree lives behind a slide-over sheet. One selection
  mechanism per *page*, not one for the whole app — the sidebar and the
  chips agree on state via the same URL params either way.

## Traps worth knowing, for whoever touches this next

- **MODIFIED depends on `published_at` staying untouched by ordinary
  edits.** If a future change to `PATCH /api/schedule-groups/[id]` ever sets
  `published_at` unconditionally instead of only on the
  not-published→published transition, MODIFIED silently stops being
  detectable — every edit would look like a fresh publish.
- **The session-write triggers are DB-level, so they're robust against any
  future app-code path** that writes to `sessions`/`session_exceptions`,
  including ones that don't exist yet. The one thing that is *not*
  DB-enforced: a direct write to `schedule_groups` itself from some future
  route or script that bypasses `PATCH /api/schedule-groups/[id]` and
  forgets to set `updated_at` explicitly. There's no trigger on
  `schedule_groups`' own `UPDATE` — by design, so a schedule's own
  `updated_at` doesn't move just because the query touched it, only when
  the app actually meant to.
- **`facilityOverviewHref()` vs `commandCentreHref()`** in
  `TreeNavContent.tsx` are deliberately two different destinations — a
  facility row goes to Overview (`/dashboard?facility=`), a
  department/schedule/settings row goes to the command centre
  (`/dashboard/schedule?...`). Don't collapse them into one; they answer
  different questions ("show me everything here" vs. "let me edit this
  exact thing").

## Left undone

- **No README on `src/components/schedule-list/`.** Sibling modules
  (`schedule-command/`, `schedule/editing/`) each have one; this one
  doesn't yet. Worth adding before this module grows further, per this
  project's standing convention of a README on every non-trivial module.
- **Department-level filtering on the list itself** and **bulk actions**
  were both explicit scope cuts in the original brief ("hard stop on scope
  creep") — not started, not currently planned. Don't add either without a
  fresh decision.
- The **schedule_group_status "Option B" timeline-slice plan**'s step 5
  (batch week-override UI) is a separate, older thread — unrelated to this
  doc, still open, tracked in memory as `project_schedule_group_status`.

## If resuming

- Re-run `node scripts/verify/verify-h.mjs` after touching any of the
  files above — it's the regression check for the publish/modified/
  duplicate/delete logic, not a one-off.
- The sidebar/Overview navigation question is **closed** — don't re-litigate
  "should the sidebar have a tree" or "should Overview be the schedule
  list." Both were explicit, confirmed user decisions this session.
- `git status` first, same as always — this session found three unrelated
  pieces of uncommitted work already sitting in the tree before starting.
