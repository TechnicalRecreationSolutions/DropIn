# Verification harnesses

Node scripts that exercise the app against a **running server and the live
database**.

```bash
npm run dev            # they drive real HTTP; the server must be up
node scripts/verify/verify-e.mjs   # facility delete + org settings (49 assertions)
node scripts/verify/verify-f.mjs   # recurrence + conflict correctness (10 assertions)
node scripts/verify/verify-g.mjs   # schedule-group publish gate (5 assertions)
node scripts/verify/verify-h.mjs   # schedule list: published_at + modified tracking (24 assertions)
node scripts/verify/verify-i.mjs   # per-week schedule review + public visibility gate (8 assertions)
node scripts/verify/verify-j.mjs   # activity log + revert (migration 038, 21 assertions)
node scripts/verify/verify-k.mjs   # conflict manager + dismissals (migration 039, 21 assertions)
node scripts/verify/verify-l.mjs   # analytics tracking + summary (migration 041, 16 assertions)
node scripts/verify/verify-m.mjs   # departments page + facilities edit link (32 assertions)
node scripts/verify/verify-n.mjs   # widget multi-schedule filter (migration 043, 36 assertions)
node scripts/verify/verify-o.mjs   # local JWT verification rejects tampered tokens (10 assertions)
node scripts/verify/verify-p.mjs   # widget schedule switcher, driven in a real browser (17 assertions)
node scripts/verify/verify-q.mjs   # widget studio + filters, in a real browser (50 assertions)
node scripts/verify/verify-r.mjs   # general schedule filters (migration 044), driven in a real browser (28 assertions)
node scripts/verify/verify-s.mjs   # list view starts at today, earlier days collapsed (21 assertions)
node scripts/verify/verify-t.mjs   # pricing surfaces match the catalogue (57 assertions)
node scripts/verify/verify-u.mjs   # deleting a session template, in a real browser (16 assertions)
node scripts/verify/verify-v.mjs   # occupancy kinds + disclosure + staff-only sidecar (migration 046, 33 assertions)
node scripts/verify/verify-w.mjs   # staff/patron audience toggle + conflict occupancy labels (20 assertions)
node scripts/verify/verify-x.mjs   # template occupancy defaults (migration 047, 16 assertions)
node scripts/verify/verify-z.mjs   # the printable deck sheet, in a real browser (29 assertions)
node scripts/verify/verify-aa.mjs  # the availability calculator in shadow mode (18 assertions)
node scripts/verify/verify-ab.mjs  # template description, tags + registration links (migration 050)
node scripts/verify/verify-ac.mjs  # the session-template form as three steps, in a real browser
node scripts/verify/verify-ad.mjs  # visitor print button + filtered printout (migration 051), in a real browser (34 assertions; 25 before 051 is applied)
node scripts/verify/verify-ae.mjs  # directory opt-in + geocoding on facility save (migration 052; makes real Nominatim requests)
node scripts/verify/verify-af.mjs  # the public directory API (/api/public/v1/directory, 39 assertions; throttles this IP for a minute at the end)
node scripts/verify/verify-ag.mjs  # the /find page in a real browser: search, sport, near-me sort, saved centres, phone width (30 assertions)
node scripts/verify/verify-ah.mjs  # robots.txt, sitemap.xml, facility breadcrumb/canonical, and a save refreshing the cached facility page (38 assertions)
node scripts/verify/verify-ai.mjs --app=http://localhost:3002  # CSP in a real browser; PRODUCTION BUILD ONLY (22 assertions)
node scripts/verify/verify-aj.mjs  # space zones + display order (migration 054), in a real browser (13 assertions)
node scripts/verify/verify-ak.mjs  # department scoping of the space pickers (6 assertions)
node scripts/verify/verify-al.mjs  # staff roles, scopes + invitations (migrations 055/056) — NEEDS BOTH APPLIED
node scripts/verify/verify-am.mjs --app=http://localhost:3001  # impersonation guards: global facility slugs, platform-only org columns, verified-only directory (migration 057; 21 assertions). The verify→listed flip needs a PRODUCTION BUILD — `next dev` serves the stale page past 10 s
node scripts/verify/verify-an.mjs  # floorplan: status rules (fixed clock), map-editor spaces sidebar, public tags + legend, in a real browser (47 assertions; --logic-only needs no server)
node scripts/verify/verify-ao.mjs  # widget Floorplan: card names the missing building/map + links to it; one-building orgs and step 1 switchers unlock it; the embed map follows the switcher; "No more sessions today" wording (26 assertions, real browser)
node --experimental-strip-types scripts/verify/verify-as.mjs  # department operating hours + all-day sessions (migration 058; 78 assertions) — NEEDS 058 APPLIED
node --experimental-strip-types scripts/verify/verify-as.mjs --logic-only  # ...or just its section 0: the real expand.ts, no database, no server, no migration (28 assertions)
node --experimental-strip-types scripts/verify/verify-at.mjs  # statutory holidays per department (migration 059; needs 058 too)
node --experimental-strip-types scripts/verify/verify-at.mjs --logic-only  # ...its catalogue + resolver alone: no database, no server, no migration (26 assertions)
node scripts/verify/verify-au.mjs  # departments: the card grid, and the edit page's summary/sections/unsaved work/day switch (52 assertions, real browser)
node --experimental-strip-types scripts/verify/verify-av.mjs  # dragging a space into place on the Spaces page, with the arrows kept (49 assertions, real browser)
node --experimental-strip-types scripts/verify/verify-av.mjs --logic-only  # ...just the move itself: no database, no server, no browser (30 assertions)
node --experimental-strip-types scripts/verify/verify-aw.mjs  # the spreadsheet canvas + /api/sessions/batch (165 assertions; 0/0b logic, 1-9 HTTP, 10 a browser incl. the week panel, 11 the READ-ONLY render of the same component, 12 touch)
node --experimental-strip-types scripts/verify/verify-aw.mjs --logic-only  # ...just the arithmetic in gridEdits.ts + weekOverview.ts: no database, no server, no browser (48 assertions)
node --experimental-strip-types scripts/verify/verify-ax.mjs  # the rebuilt analytics page: ranges, the paged read, the four CSV exports, the permission gate (78 assertions)
node --experimental-strip-types scripts/verify/verify-ax.mjs --logic-only  # ...just range.ts + csv.ts + the classifiers: no database, no server, no browser (41 assertions)
node --experimental-strip-types scripts/verify/verify-ay.mjs  # the rebuilt Overview: today ribbon, named conflicts, phone actions, the paged activity count (72 assertions)
node --experimental-strip-types scripts/verify/verify-ay.mjs --logic-only  # ...just the ribbon geometry: no database, no server, no browser (25 assertions)

node scripts/verify/perf-nav.mjs   # navigation timings — prints a table, asserts nothing
```

`perf-nav.mjs` is the odd one out: it measures rather than checks. Run it
before and after anything that touches the dashboard's data path. Dev numbers
are only comparable to other dev numbers, so for a real result build and serve
production alongside the dev server:

```bash
NEXT_DIST_DIR=.next-perf npx next build
NEXT_DIST_DIR=.next-perf npx next start -p 3001
node scripts/verify/perf-nav.mjs --app=http://localhost:3001
```

See `docs/PERFORMANCE.md` Part 3 for what its columns mean and what the numbers
were last time.

`verify-b`/`verify-c`/`verify-d` (events calendar + featuring, storage bucket
role split, brochures) tested the seasons/events/brochure track and were
removed with it — see `docs/PLAN.md` §3a and
`supabase/migrations/036_remove_events_brochure_seasons.sql`.

They read `.env.local` for the Supabase URL, publishable key and service-role
key. Nothing is hard-coded and no secret is committed.

**Last full run: 2026-09-12 — all 23 harnesses green, 572 assertions**, against
one clean server (`NEXT_DIST_DIR=.next-verify npx next dev -p 3001`). The counts
above were measured in that run, not carried forward; four harnesses had drifted
and are described below. Re-measure before quoting this — see
`docs/SECURITY.md`'s note about recorded numbers going stale on their own.

## The security sweep is next door

`scripts/security/sweep.mjs` is the repeatable half of the security audit
(`docs/prompts/frontend-database-security.md`). It overlaps these harnesses
deliberately and stops where they start: it asks questions answerable from the
source or from an anonymous PostgREST call, and hands anything needing a
fixture — two orgs, a signed-in coordinator, a published week — back to a
`verify-*` script by name. When it reports INCONCLUSIVE because a table is
empty, the line says which harness settles it.

## What these are, and are not

**Not a test suite.** There is no runner, no CI wiring, no mocking. They are the
pattern `docs/SECURITY.md` documents: a service-role script builds a throwaway
org, drives the real routes as a really signed-in user, and deletes everything in
a `finally`. Run them by hand after touching the code they cover.

They exist because this project applies migrations by hand, so **the migration
files and the database can drift** — and because most of what they check fails
*silently*. A calendar fetching a week's data for a month, an unpublished page
that keeps serving: none of these throw. They just quietly do the wrong thing.

## Rules they follow, learned the hard way

1. **Every assertion has a positive control.** An empty result is not proof —
   `[]` from a working policy and `[]` from an empty table look identical. This
   repo has produced false green results twice from exactly that.
2. **Never the service role for the thing under test.** It bypasses RLS, so a
   policy test that uses it passes no matter what the policy says. The service
   role builds and tears down fixtures; a signed-in user does the acting.
3. **Two users where a role distinction is the point.** `verify-e` uses an admin
   *and* a member, because testing a member/manager split with one role proves
   half a decision.
4. **Assert the mechanism, not just the outcome.** `verify-f` asserts a genuine
   space overlap still 409s and that a same-space pair that only *touches*
   does not — checking only "a conflict was reported" would miss either half.
5. **Check the fixture inserts, especially `org_memberships`.** Migration 055
   replaced the old roles with `owner`/`manager`/`coordinator`/`aux` and added a
   CHECK constraint. Every harness still inserting `role: "admin"` has a
   membership insert that silently fails — nothing throws, because the insert's
   error is not read — and then every request 403s with
   `{"error":"No organization found"}`, which reads like a product bug rather
   than a fixture one. **25 harnesses still do this** and cannot currently run;
   `verify-q`, `verify-aa` and `verify-ac` were repaired. Fixing one is a
   one-line change from `"admin"` to `"owner"`.

## What they cover

| | |
|---|---|
| `verify-ax` | The rebuilt `/dashboard/analytics` and its CSV export. Its centre is a **measured** bug, not a hypothetical one: the old summary read the table with a single `.limit(20_000)`, and this project's PostgREST answers at most 1,000 rows, so every total shown was the first thousand events with nothing saying so. Section 3 inserts 1,100 views and insists the export reports 1,101 — with `!== 1000` asserted beside it, so the check cannot pass by accident. The other traps: an event at 23:30 on the range's last day must be inside the window (the far end is exclusive-next-midnight, not `lte` the last day), and the daily breakdown must land a late-evening event on the day it happened rather than the UTC one. Section 0 pins the range arithmetic without a database — presets, reversed/future/over-long custom ranges being clamped rather than refused, the previous-period window, gap-filled days, and two DST crossings. Section 1 proves the CSV cannot execute: `=`, `+`, `-` and `@` cells are neutralised *inside* the quoting, which is why the module does not use papaparse's `unparse`. Section 6 proves the export carries no `ip_hash` and no raw `user_agent`, only the device class derived from it. Section 7 is the first enforcement anywhere of `analytics:view` — a coordinator 403s, anon 401s, the owner succeeds |
| `verify-ay` | The rebuilt `/dashboard/overview` (`/dashboard`). Three of its sections exist because the page used to be wrong rather than merely plain. **Section 3** repeats verify-ax's measured bug on a second table: 1,050 `activity_log` rows are inserted in scope and the "Changes (30d)" tile must read more than 1,000 — falsified by restoring the old `.limit(5000)`, which reports **997**, no error, no sign anything was cut. **Section 5** asserts a schedule row's Edit is visible, inside the 390px viewport *and* at least 40px tall: the desktop table renders at 390px too and passes the first two, so only the height catches the old layout (26px icons past a sideways scroll). **Section 7** is the permission trap: `session:write` is department-scoped, so `can()` without a department answers false for a coordinator, and gating the create buttons on it hid them from the role that needs them most — the coordinator context asserts the button is there while the analytics tile, gated on an unscoped permission, is not. Two locators had to be narrowed before they meant anything: the topbar has an icon-only link to `/dashboard/activity` and the sidebar a text link to `/dashboard/analytics`, so a bare href locator measures the chrome and passes whatever the tile does. **Section 0** is the ribbon geometry with no server: hour-aligned axis bounds, a minimum window so one short session is not the whole day, greedy row packing that hands overflow back rather than dropping it, thinned hour ticks, and the half-open "on now" interval that stops a session ending at 10:00 and one starting at 10:00 both counting as running |
| `verify-at` | Statutory holidays (059): the catalogue's nth-weekday and Easter arithmetic hand-checked against 2026, jurisdiction differences (BC Day vs Civic Holiday; Boxing Day statutory in ON and not BC; Nunavut Day offered only to NU), and the resolver's three observances — including that `closed` and `normal_hours` both store **zero** window rows and only the column separates them. Section 2 asserts Christmas Day vanishes from a following session **alongside a fixed-time control that still runs on it**. Sections 4 and 5 cover the two scoping traps a replace-by-year API has (clearing one department must not touch another's identical date; clearing 2026 must not touch 2027), plus the anonymous read being permitted on purpose and dying with the parent department |
| `verify-av` | The Spaces page's two ways to reorder — drag a chip by its grip, or step it with the arrows — and the claim that they cannot disagree. Section 0 runs the shared move with no database, server or browser: a drop is lift-and-insert (4 to the front leaves 4,1,2,3, **not** the 4,2,3,1 a swap would leave), an adjacent drop and the arrow return the identical list, and a drop into another zone, the zone-less bucket, another department or the whole-building bucket is refused outright — with a same-zone drop as the control, since "returns null" would otherwise pass on a function that refuses everything. Crossing a zone is a `zone_name` write and crossing a section a `department_id` one; this page only renumbers `display_order`, so an approximated drop would write a lie. Sections 1+ drive a real pointer: the drag is pressed on the grip (the chip's face is the edit link, which is asserted to still navigate), the database is checked to agree with the screen at 1..N with no ties, the cross-zone drag is asserted to change **nothing** in the row it was dropped on, and the arrows are exercised afterwards. It also watches the console for a hydration mismatch — spreading dnd-kit's `attributes` onto the handle caused one, because its `aria-describedby` counter restarts on the client |
| `verify-au` | The department edit page after it became a summary + three sections. Asserts what the redesign claims: the heading names the department, the week reads back in one line before any control is touched, only one section is on screen and the open one is in the URL, and unsaved work is marked on its tab and survives a switch (the panels are hidden, not unmounted). Section 4 is the one that matters — the per-day open/closed switch replaced "delete every window with the little x", so it proves a closed day loses its rows **in the database** and leaves the rest of the week alone, rather than only changing the screen. Section 6 covers the landing page's cards: each card's schedule and space counts are checked against a SECOND department that has none, so a count cannot pass by being a constant, and the missing-hours CTA has to point at `…/edit#hours`. Nothing here asserts on a reload showing a just-saved value: `next dev` serves cached segments for minutes, and that red would be the dev server |
| `verify-as` | Operating hours (058) and the sessions that follow them: a split Monday producing two occurrences, a closed Wednesday producing none **alongside a fixed-time control that does**, overlapping windows merging, the flag surviving a partial update, the write guard on a department with no hours, and the fallback when hours are deleted outright. Its centre is section 4 — change the hours through the real route, re-expand, assert the occurrences moved **and that `sessions.dtstart` did not**, which is the whole "points at, does not copy" claim. Section 7 asserts an exclusive program inside the open window 409s *and* that the same program in the midday gap does not — on BOTH sides of the check, since breaking the candidate's own hours lookup went undetected until it did. Section 6 pins the anonymous path to migration 037's per-week review gate, asserted in both directions so the gate cannot silently become the reason a run passes. Section 0 runs the real `expand.ts` with no database at all (`--logic-only`); both modes need `--experimental-strip-types` |
| `verify-al` | The whole role matrix (055/056), asserted **against PostgREST directly** rather than through the API routes — a coordinator confined to their department, an aux staffer who can read the internal schedule and write nothing, the NULL-department schedule group staying owner/manager-only, a coordinator with zero scopes reaching nothing, managers barred from the owner row, nobody editing their own row, `staff_invitations` returning nothing to anon (regression guard on migration 023), a token that cannot be redeemed twice or from the wrong address, and a transfer leaving exactly one owner |
| `verify-e` | Facility delete's **cascade** (departments/groups/spaces/sessions all gone, a second org's identical tree untouched), the owner/admin line on both features, cross-org delete answering 404, org PATCH stripping `slug` and `status`, empty string stored as NULL, and both new pages rendering server-side |
| `verify-f` | Session-conflict detection and recurrence expansion (`src/lib/rrule/expand.ts`, see its README): a genuine overlap still 409s, a same-space pair that only *touches* and recurs across a DST boundary does not, an evening session's expanded occurrence lands on its configured local weekday rather than the day before, and a session on an unpublished Space doesn't crash the public (anonymous) schedule read |
| `verify-g` | Schedule-group publish gate: a start date but no end date now publishes (POST and PATCH), no start date still doesn't, and a genuine space overlap between two open-ended published schedules is still caught |
| `verify-h` | Schedule list build: `schedule_groups.published_at` + session-write triggers, the PATCH route setting `updated_at`/`published_at` explicitly, and the duplicate/delete routes |
| `verify-i` | Per-week schedule review (`schedule_week_reviews`, migration 037): a pending (unreviewed) week of a published schedule is hidden from anonymous reads, `approved` makes it public, `needs_changes` hides it again, staff (org admin) sees the week regardless of review status throughout, and a plain `member` is rejected (403) from writing a review |
| `verify-j` | Activity log (`activity_log`, migration 038): create/edit a facility logs insert/update rows with the actor's email, label and `changed_fields`; a session insert's pure `updated_at` bump to its parent `schedule_groups` row (migration 035's touch trigger) is *not* logged, while the session insert itself is; a plain `member` is rejected (403) from `revert_activity`, an org owner/admin can revert an update (value actually restored), undo a create (row deleted) and undo a delete (row restored with its original id); reverting the same entry twice is rejected; a second org's admin reads zero rows querying the table directly, proving the RLS policy rather than just the route's own filter; and deleting a whole org (cascading through a live facility, which itself fires `log_activity()` again) doesn't FK-violate against `activity_log`'s own `org_id` column — the regression that first surfaced this suite failing everything |
| `verify-k` | Conflict manager (`findOrgConflicts()`, `session_conflict_dismissals`, migration 039): two sessions inserted directly (bypassing the write-time gate, the same way `/api/import/commit` does) show up as an active conflict via `GET /api/conflicts`, including when both belong to a *draft* schedule group; a non-overlapping same-space session is a negative control and never appears; a plain `member` (not just an admin) can dismiss and restore; reassigning one session to a free space via `POST /api/sessions` resolves the conflict for real (it disappears, not just shows dismissed); deactivating a session resolves its conflicts too; `POST /api/conflicts/dismiss` 404s if either session belongs to another org; and a second org's admin reads zero rows of the first org's dismissals querying `session_conflict_dismissals` directly, proving the RLS policy itself |
| `verify-m` | Departments page (`/dashboard/departments`, `/api/departments`) and the Facilities list's edit link: the rendered department list shows a created department's name/description/Draft badge and the survivor department (positive control) alongside it; a plain `member` gets 403 on create/update/delete while an org1 admin succeeds; the edit page is prefilled server-side; publishing + renaming via PATCH is reflected on a re-fetch of the list; a cross-org PATCH 404s; delete removes the department while the survivor remains; a second org's admin reads zero rows of org1's departments directly, proving RLS rather than just route filtering; `/dashboard/facilities` links each card to its edit page; and a cross-org facility edit request gets the not-found body with zero facility data, not a hard 404 — see the soft-404 note below |
| `verify-n` | Widget multi-schedule filter (`widget_config_scopes`, migration 043): a plain `member` is rejected (403) from saving filters; an org1 admin saves a facility-only scope and a schedule-level scope, the latter's `department_id` auto-derived from the schedule rather than trusted from the request; a scope naming another org's facility, or a department that doesn't actually belong to the named facility, is rejected (404) without touching the previously-saved list; omitting `scopes` on a PATCH leaves the saved list alone while `scopes: []` explicitly clears it; direct RLS reads prove staff see every scope regardless of publish state, anon and a second org's admin both see only the fully-published-chain scopes and never one on an unpublished facility (published data is legitimately public to anyone, not just the owning org — the gate is publish state, not org); the live, unauthenticated embed's colored header renders a schedule dropdown (Radix Select, built into `ScheduleHeaderBar`) once there are 2+ published scopes, defaulted to the first by `sort_order`, and hides the unpublished one entirely; with exactly one scope the dropdown disappears (nothing to switch between) but the header still shows that scope's own name and that scope still has to drive the data, not silently fall back to an unfiltered embed — caught a real bug of exactly that shape during this suite's own first run; and a second bug, an empty header title on first paint, from `SelectValue` needing an explicit child to render server-side at all. The dropdown only opens client-side (Radix portal), so these checks confirm the affordance and default selection over plain HTTP, not actually picking a different option — that needs a real browser. |
| `verify-o` | Local JWT verification (`src/lib/auth/claims.ts`), the change that took `auth.getUser()` off the dashboard render path. Two layers: the primitive — `getClaims()` against the project's real JWKS accepts a genuine token (the positive control, without which "rejects everything" would pass) and rejects both a token whose `sub` was rewritten to name another user and one whose signature bytes were flipped; and the app — over real HTTP a genuine cookie renders the org name while the same cookie carrying a tampered token renders neither user's org, so "refused" is distinguishable from "rendered the wrong user". Also asserts the project still signs ES256, since a switch back to a shared secret would silently turn every verification into the network call this change removed. |
| `verify-p` | The widget schedule switcher actually switching, in a real signed-out Chromium — the half `verify-n` documents itself as unable to reach, because Radix portals the option list into existence only on click. Asserts the mechanism rather than the label: the default scope's sessions are on screen and the other scope's are not (both directions, since "the right ones show" only means something next to "the wrong ones do not"); the dropdown offers both published scopes and never the one on an unpublished facility; picking the second scope swaps the rendered sessions *and* issues a fresh `/api/sessions/expand` carrying that scope's schedule group id, which is what separates a re-scoped query from a re-labelled header; and switching back restores the first, so it is a filter and not a one-way latch. Verified to fail correctly: stubbing `onScopeChange` to a no-op turns its section 4 red. Note the two fixture requirements in its header — sessions with no template (so each renders its schedule group name) and *approved* week reviews (migration 037 hides unapproved weeks from anonymous callers, which otherwise empties the widget and fails everything for the wrong reason). |
| `verify-q` | The redesigned widget studio (`/dashboard/widget`), signed in, in a real browser. Covers the four things the redesign made load-bearing, each of which fails silently: the preview window mounts its iframe only while open and its `src` carries the *unsaved* heading and brand colour through the route's preview-only params (with a before-edit control), including a colour picked on the window's own quick-tweak strip; those same params are inert on a real embed — asserted on the rendered heading and the header bar's computed background in a browser, because a dev build echoes search params into the RSC payload and a substring check on the HTML reports a defacement that isn't there; `custom_title` renders on the live embed where the header used to hardcode `"Schedule"` (with the generic title captured first as the control); and "Loads first" genuinely reorders `allowed_templates` so the real embed comes up pressed on the promoted view. Plus the studio's own guard rails: the publish bar appearing and clearing around one publish action, filters saving from their empty state, and a scope switch with unsaved edits stopping on a dialog instead of discarding them. It also covers the filter (step 3), whose fixture deliberately puts **two departments in one building** — with one department per building, a department-level scope and a facility-level scope select the same sessions, so dropping the department id entirely would still pass: the editor previews the real `ScheduleScopeSwitcher` rather than a drawing, a department-level filter shows its own department's sessions and not the sibling's in both directions, and a filter pointing at a draft schedule is warned about in the editor, saved anyway (control: the gate is visibility, not the write), absent for a visitor, and absent from the *signed-in* preview too — the last only holds because `/widget/[orgId]` filters publish state itself instead of leaning on anonymous RLS, since the preview iframe carries the admin's session. `--shots=<dir>` writes desktop/phone/preview/unsaved screenshots. Unlike its siblings it counts a thrown fixture as a failure — the shared `try/finally { process.exit }` shape otherwise reports "0 passed, 0 failed" as success. |

| `verify-r` | The general schedule filters (`widget_configs.enabled_filters`, migration 044) in a signed-out browser, since they run client-side over the loaded week and are invisible to a `fetch()`. Its fixture is built to make each dimension independently falsifiable: three activities, two of them on the **same day** at 9am and 7pm (so a day filter cannot pass by standing in for a time filter) and one on a **different day** (so the timezone-sensitive `zonedDayOfWeek` bucketing is genuinely exercised — reading `getDay()` instead drops early sessions into the previous day on any machine west of UTC, invisibly). Asserts each filter narrows in both directions, that dimensions AND while choices within one OR, that filtering everything out says so distinguishably from an empty week and offers a way back, that a filter with only one available value is not rendered at all, that an unknown filter key is rejected by the API rather than silently dropped, and that turning filters off in the config really removes them from the embed while leaving the schedule itself intact. |

| `verify-s` | `WeeklyScheduleList` opening on today instead of on Sunday, in a signed-out browser. Its fixture is one differently-named schedule group per weekday, so "is Tuesday on screen" is a text assertion no other day's row can satisfy. Asserts the collapse in both directions (earlier days and their **sessions** gone, then back after the toggle, then gone again — a heading with no rows under it would pass a heading-only check), that the toggle names how many days it is holding, that the day index is resolved against the *week in view* rather than `new Date().getDay()` alone (next week and a paged-back week both render all seven days and offer no toggle), and that the phone layout's day chips agree with what is rendered rather than leaving a collapsed day selected and the list empty. It self-skips the collapse assertions when run on a Sunday, when there is nothing to collapse. Fixture note beyond `verify-p`'s two: **`dtstart` must be two weeks back**, not this week — a recurrence has no occurrences before its own anchor, so paging back lands on an empty week and the widget drops the whole schedule region (`WeekNavigator` included) rather than rendering empty days. |

| `verify-t` | The pricing surfaces agreeing with the catalogue (`src/lib/stripe/plans.ts`, see `docs/PRICING.md`). Every expected figure is **parsed out of `plans.ts`** rather than restated, so a price typed into JSX instead of imported fails here — falsified by moving the trial to 21 days and the overage to $60 and confirming both pages followed. Covers the four tier names, monthly and annual prices, the arithmetic that annual really is ten months of monthly, each tier's facility allowance, the quoted tier still anchoring a floor, and both far-flung "plans start at …" lines in the hero and closing CTA — which is where two stale `$49/month` strings were actually found. Section 3 is the negative control: the new figures prove nothing while `programsPerFacility`'s "schedules per facility" (it metered `programs`, dropped in migration 011), a staff-account cap or the old `$49/mo` sit on the page beside them. On the billing page it asserts the legacy-tier bridge in both directions — an org with no subscription row, and one with a cancelled `plan_tier='free'` row, must both say "No active plan" and must **not** name a paid tier, since `PLANS['free']` is now a miss whose sloppy fix is to fall back to Starter and tell an unpaid org it is paying; then a positive control flips `plan_tier` to the legacy `pro` and requires it to render as Standard with that tier's price, allowance and portal button, without which "says no plan" would pass on a page that says it unconditionally. Also that `POST /api/stripe/create-checkout` really does 400 on a catalogue key it has no Stripe price for, which is why those tiers render a mailto rather than a button. **The FAQ answers need a browser**: a closed Radix Collapsible renders no markup at all, so section 2 asserts they are absent over HTTP and 2b clicks them open — the same split `verify-n`/`verify-p` make for a portalled Select. |

| `verify-v` | Occupancy kinds, disclosure and the staff-only sidecar (migration 046, stage 1 of `docs/PLAN-internal-view.md`). The point of the fixture is that a rental and a public drop-in block **claim the same lane at the same hours** — before 046 that was a hard 409 from `findSessionConflict()`, and it is the exact shape the internal view exists to record. Asserts it now saves, and immediately that the protections either side of it did not go with it: a *second* exclusive claim on that lane is still 409, and so is a second drop-in block (residual-vs-residual is unchanged) — without both, section 2 would pass just as well against a conflict engine that had been switched off. Then the disclosure halves: staff get the holder name and setup notes; anon gets the reserved block with its **time and lane intact** (that is the availability the whole feature exists to publish) and its label replaced, with the holder name, setup notes and the renter-ish schedule-group name asserted absent from the *whole serialized body* rather than field by field, so a future field carrying the name cannot slip past. A signed-in admin of a *second* org is checked alongside anon, since anon alone leaves it untested whether the gate is publish state or membership. Two assertions exist only to separate RLS from route filtering — anon and the outsider select `session_internal` directly and get zero rows, with a service-role read as the control that the rows exist at all — and two more cover `session_spaces`, whose own public policy would otherwise still answer "something holds ZZ Lane 2 at 6am" for a session anon cannot see. Section 11 is the trap that shaped the API's contract: the conflict manager and drag-reschedule both send partial payloads, so a zod `.default()` on `occupancy_kind`/`disclosure` would silently turn a withheld rental into a public drop-in on any update that didn't mention them — it reschedules the rental and asserts all three of kind, disclosure and holder name survive. **Verified to fail correctly**, and the way it failed is the point: with `applyDisclosure`'s redaction branch short-circuited, the two group-name assertions went red while the holder name and setup notes stayed absent — the sidecar's RLS held on its own with the app layer broken, which is the two-layer defence of migration 046 decision 4 demonstrated rather than asserted. Takes `--app=` like `verify-t`: a wedged Next dev worker answers *every* dynamic `[param]` route with a 500 and an HTML body, which reads here as a route bug rather than a server needing a restart — this cost a diagnosis on its first run. |

| `verify-w` | The staff/patron audience toggle (`audience=public` on `/api/sessions/expand`) and the conflict manager's occupancy labels — stage 2 of `docs/PLAN-internal-view.md`. Its whole subject is that **one signed-in caller gets two different payloads for the same week**, differing only by that parameter, so every assertion is a diff between the two rather than a property of one: staff get the holder name and setup notes, Patron view has neither, the withheld booking reads "Reserved", and the public drop-in block is untouched by the toggle (without that last one, "the toggle hides things" would pass on a toggle that hid everything). Section 3's internal-booking check is the one that would fail *silently*: internal rows are normally dropped by RLS, which cannot help here — the caller is a real org member, so their own rows come back, and only `applyDisclosure`'s app-layer filter removes them. Section 4 cross-checks the preview against a genuinely anonymous fetch of the same week, count and labels in order, which is the assertion that catches a preview drifting from the thing it previews. Section 5 separates disclosure from week review by leaving a second week unapproved: full for staff, empty in Patron view. Section 6 pins the parameter's one-way property — anon passing it gains nothing, and `audience=staff` is rejected 400 rather than ignored, so a typo in a future caller cannot quietly produce a staff payload on a public surface. Sections 7–8 cover the conflicts page: two rentals on one lane are reported *with* their kind and disclosure, while the rental-during-drop-in pair is **not** reported at all — the negative control that matters most, since reporting it would fill the page with one row per rental the moment a customer used the feature. **Verified to fail correctly**: removing the app-layer internal filter reddens sections 3 and 4, and removing the org scan's `claimsCanCollide` guard reddens section 8. |

| `verify-x` | Template occupancy defaults (migration 047): a template carries the `occupancy_kind`/`disclosure` every session placed from it starts with, so a club booking is one drag from the rail instead of a drag plus two corrections on the edit form. Its centre of gravity is section 6, which rules out the design that would have looked identical in normal use: these are **defaults, not links**. It flips the template to internal *after* a session has been placed and asserts the placed session stays `rental`/`reserved`, with a control proving the template itself really changed — resolving through to the template at render time would pass every other assertion here and would retroactively republish a withheld booking the first time anyone tidied a template. Section 4 is the bug preserved as a test: the API deliberately does **not** read the template, so a payload omitting the fields takes the column defaults — which is exactly why the client must send them, and what the command centre's create path was failing to do. Also covers a pre-047 template reading as a public drop-in with no backfill, a per-placement override beating the template, a PATCH that doesn't mention the fields leaving them alone, one placed session's edit not disturbing its siblings, and an unknown kind being rejected 400. **Verified to fail correctly** by making `POST /api/sessions` read through to the template, which reddens section 4 alone. Its own first run also red-flagged a genuine fixture error rather than a code one: the override placement was an exclusive `program` on the same lane and hour as section 3's rental, so the conflict engine 409'd it — correctly — and the fixture now keeps them apart. |


| `verify-z` | The printable deck sheet (`/dashboard/schedule/deck`, stage 4 of `docs/PLAN-internal-view.md`) in a real Chromium, because the deliverable is a **printout** and no `fetch()` can see a page break, a repeating header, or a hidden control. Its centre is the design decision the sheet is built on: exclusive claims are drawn in lane columns, residual drop-in blocks are listed *below* the grid and appear in **no** lane cell — they hold whatever the claims leave, so a cell claiming one would be false. Positions are asserted by `data-deck-claim="<space id>"` rather than by text, so "the holder name is on the page" cannot pass with every booking piled into column one, and a 90-minute booking is required to span exactly three half-hour rows. Section 5 is the print stylesheet itself: the Print control visible on screen and gone under print media, `thead` computed as `table-header-group` (without which page two is a grid of unlabelled lanes), one page, and landscape taken from the `@page` rule rather than a dialog setting — read off the PDF's own `/MediaBox`. Also: an unplaced booking (exclusive, no space) gets its own section instead of vanishing, setup notes render as numbered footnotes with the matching marker in the cell, a signed-out visitor is redirected to /login by the proxy (the reason this route lives under `/dashboard` despite having no dashboard chrome), and another org's admin passing this facility's id gets their **own** building and never the holder name. **Verified to fail correctly, twice**: drawing residual blocks in lane columns reddens section 3 alone, and changing the print `thead` rule to `table-row-group` reddens that one assertion alone. Two real defects came out of its own first run — see the next two paragraphs. |

| `verify-aa` | The availability calculator in **shadow mode** (stage 5 of `docs/PLAN-internal-view.md`). Every rule in the plan's §4 gets a fixture whose arithmetic is read back off a rendered surface: bands cut at each claim edge (3 of 6 while a club has three lanes, 1 of 6 while a program has five), §4.4's merge on the **label** rather than the number (5 free and 6 free both read "More than 4 lanes available" and must become *one* band carrying the lower count — asserted by requiring three bands over three hours, not four), and §4.3's zero case reported as "nothing left" rather than as "0 lanes", because the block does not exist then. Section 4 is the one that makes it shadow mode: an anonymous read of the same week still publishes all six lanes and contains no computed number under any field name. Section 5 covers the trap the panel exists to avoid — it opens the editor on the *Lengths* schedule group while every rental lives under *Bookings*, and requires a holder name from that other group to appear, since a panel scoped to the editor's own group would see no rivals and reassure staff with a number computed from nothing. **Verified to fail correctly, twice**: merging on `available` instead of the label splits the 8:00–9:00 band and reddens §4.4 alone, and scoping the panel's fetch to the editor's schedule group turns section 5 red with the exact wrong answer in the failure detail — *"2 blocks this week match the bookings entered"*. |
| `verify-ad` | The visitor Print button (`widget_configs.allow_print`, migration 051), in a signed-out browser. The printout is a print-only rendering of the *filtered* week, so every check reads it under `emulateMedia({ media: "print" })`. Off by default (and the embed still renders before 051 is applied); with it on, the sheet is hidden on screen and the header is hidden on paper; the unfiltered print lists all three activities, keeps empty days and has **no** "filtered view" notice (the negative control); a Monday filter and a search each narrow the sheet, the excluded activity is asserted absent, and the notice names the filter with an N-of-M count. With 051 applied, it also checks the saved setting end to end, on the embed and on `/facility/[slug]`. The last check turns printing off and revisits the facility page it just cached with printing on. That page is `"use cache"` for hours, so this checks that a publish expires the cache; it failed (button still shown) with the PATCH's `revalidateTag` removed. The facility page's wait is scoped to `.org-theme`, because its "Schedules offered" sidebar prints the same names server-side and let the first version of this check pass while the schedule was still loading. Writes `verify-ad-*.pdf` and a facility screenshot to `--out=` for a look. Uses the **grid** view because the list view folds away past days: `verify-r` uses the list and goes red on any day after Monday for that reason (seen 2026-09-16, a Wednesday: 20/25). Its search term is "fit" because search also matches facility names, and "aqua" matched the fixture's "Aquatic Centre". Before 051 is applied it runs through the `?preview=1&print=1` override and SKIPs the API, saved-setting and facility-page section. **Verified to fail correctly**: feeding the sheet the unfiltered sessions turns 4 checks red. |
| `verify-ae` | The directory opt-in and address geocoding (migration 052, `POST /api/facilities`). A never-signed-in client sees a published, listed facility (the positive control) but neither a published, unlisted one nor a listed draft. The `location` trigger is checked by comparing two rows with the same lat/lng, overwriting a conflicting direct write, and clearing lat. The route is checked on the **mechanism**, `geocoded_at`: it is set on create, left alone when an edit keeps the address (including whitespace and case changes), and moved when the address changes. A bad address clears the coordinates, and the edit page then says the address was not found. Saving over another org's facility returns 404 and leaves the row untouched. Makes about five real Nominatim requests, so it needs network access. Not covered: the "Nominatim unreachable" branch, which would need the network cut mid-request. |
| `verify-af` | The public directory API, `GET /api/public/v1/directory`. Warms the cache **before** inserting fixtures, so it can show a listing inserted behind the app's back staying hidden until an app save expires the `directory` tag. Exclusions (unlisted, unpublished, pending org) each sit beside a positive control. A signed-in member gets exactly what a resident gets, including *not* seeing their own unpublished listed facility, because the response is `public`. Sports: a draft and an ended schedule each carry a sport the fixture must not advertise. Checks the exact key set of the contract, accent-insensitive multi-word search, the sport filter, 400s, attribution, Cache-Control, and that opting out and deleting disappear on the next request. Ends with a 130-request flood for the 429 + `Retry-After`, which throttles this IP for a minute, so wait before rerunning. No Nominatim requests. **Falsified twice:** making saves not expire the tag turns 16 checks red (the opt-out check passes vacuously there, and its "still listed remains" control is what catches it); dropping the listing filter and the ended-schedule filter turns exactly the 5 dependent checks red. |
| `verify-ag` | The resident `/find` page in a real Chromium, with the browser's position mocked to Victoria, BC. The two listed fixtures are named so that alphabetical order is the **reverse** of distance order, so the unsorted order is the negative control for "Use my location". A context with no geolocation permission must show the blocked message. Search (accent-insensitive) and the sport chip must narrow the list, be written to the URL and survive a reload. The position must **not** go into the URL. A starred centre must survive a reload in "Your saved centres" and be hidden while searching. At 390 px the page must not scroll sideways and the star must be at least 44 px; tapping a card opens the facility page. Also checks the nav link and the OpenStreetMap credit, and writes `verify-ag-phone.png` / `verify-ag-desktop.png` to `--out=`. Fixture names carry the run stamp and the page is searched by it, so real listings can't change the counts. **Falsified:** skipping the distance sort turns the 3 sort checks red. A first version read results with a selector that matched nothing; "the unlisted fixture is not shown" passed on that empty list, and its "both fixtures shown" control is what caught it. **Dev-server caveat:** on `next dev`, `/find` kept serving a deleted org's fixtures for minutes (only an API request refreshed the shared entry). A production build (`/find` is `○`, revalidate 1m) was checked by hand: a change made behind the app's back appeared on the second request after 65 s, and a deleted org's facility left the same way. |
| `verify-ah` | Phase 4 of the directory. `robots.txt` disallows `/dashboard`, `/api/`, `/widget/` and `/callback` and names an absolute sitemap. `sitemap.xml` lists `/find` and listed facilities only (a published but unlisted one and a draft are absent beside a listed control), and opting out removes the URL. A listed facility's breadcrumb leads to `/find`, an unlisted one keeps Home. Canonical tags: `/find?q=…` points at `/find`, and a facility page at its own slug. The main point is **freshness of the facility page**, which is cached for hours and was never expired by a facility edit before this phase. Each case writes the change straight to the database first and asserts it is *not* shown, proving the page is cached, then saves through the app and asserts it *is*: an edit, publishing onto a slug whose "not found" was cached, a rename (the new slug serves, the old one stops) and a delete. **Falsified:** removing the slug expiry from `POST /api/facilities` turns exactly the 5 dependent checks red. **Dev-server lag:** `next dev` applies a tag expiry ~100 ms after the route responds, so the harness pauses 400 ms after each save; a production build (`NEXT_DIST_DIR=.next-perf next build && next start -p 3002`) passed 38/38 with no pause. `verify-ag` got the same pause after it failed on this lag; it had passed earlier by timing luck. |
| `verify-ai` | The Content-Security-Policy in a real Chromium (SECURITY.md M7, DEPLOYMENT.md §5). **Refuses to run against `next dev`**, whose policy adds `unsafe-eval` and `ws:`, so a pass there would prove nothing. Build with `NEXT_DIST_DIR=.next-perf npx next build`, then `npx next start -p 3002`. Checks: exactly one CSP header and `frame-ancestors 'self'` on `/`, `/find`, a facility page and the public API; `/find` keeps `geolocation=(self)`; no violations while `/`, `/find` (location granted, a sport chip, a star) and a listed facility page with a **real Supabase Storage cover photo** are used. Violations are collected from `securitypolicyviolation` events and the console. **Positive control:** an image from `example.com` is requested and must be reported, so a silent collector cannot pass. A throwaway page on port 3099 loads `/embed/widget.js` as a centre's site would, and the widget must render inside the cross-origin iframe; control: `/find` framed the same way must be refused. First run 2026-09-16: 22/22. |

| `verify-aj` | Space zones and `display_order` (migration 054). The fixture reproduces the production state the complaint came from — every space at `display_order` 0, which is how every row shipped, since nothing ever wrote the column — and inserts the eight lanes **scrambled**, so a passing "in order" result cannot come from insertion luck. The reorder buttons are then clicked until the Spaces page reads Lane 1-8, and the check is that `/dashboard/schedule/sessions/new` agrees; **positive control:** the editor's order before the reorder must differ, or the sort proved nothing. Also asserts `display_order` came out distinct per row rather than all 0, that zone labels group the page (a second zone renders separately, a zone-less space is labelled rather than hidden, and zones nest *inside* the department heading), that zones create **no** `session_spaces` rows — a zone is a label, never a booking — and no sideways scroll at 390 px. The four zone checks **SKIP rather than fail** until 054 is applied, since `zone_name` is the only part needing DDL. **Caught two real races on its first full run**, neither of them harness flake: (1) `router.refresh()` after each move re-fetched the order just written and landed on top of the *next* click — removed, since it only re-renders this route and so could never reach the session editors it was added for; (2) two overlapping PATCHes each wrote `display_order` 1..N row by row and interleaved, leaving duplicate positions and a gap (`1,2,3,4,5,6,8,9,10` across ten rows) — fixed with a single-flight saver that queues the newest order behind the one in flight, which is correct because every save sends the whole facility. The "survives a reload" check then failed because the last write was still in flight; that is a user-visible hole too (navigate away and the last click is lost), so the page now renders "Saving order…" and a `data-saving` attribute the harness waits on rather than sleeping. 2026-09-17: 13/13. |

| `verify-ak` | Department scoping of the three space pickers. Reproduces the reported shape exactly: one facility with **both** an Aquatics and a Tennis department, lanes filed under Aquatics, and a tennis court left at `department_id` NULL — which the pickers used to admit everywhere, on the theory that an untagged space belongs to the whole building. NULL means both "shared" and "nobody filed it yet" and the two are indistinguishable, so the second leaked. Asserts the court is absent from an Aquatics session picker and from an Aquatics template's "usual spaces" (which was not scoped by department at all), with a **positive control** on each that the Aquatics lanes are still offered — "the wrong one is gone" proves nothing without it. A second facility with no departments is the control for the case the old fallback existed to serve: its untagged spaces must still appear, which they do, because a department-less schedule matches `department_id` NULL under the strict rule too. Last check covers the dead end the change creates: a Tennis schedule with nothing filed under it must explain where the spaces went rather than showing an empty picker. First run 2026-09-17: 6/6. |
**Two of these harnesses had drifted out of true and were fixed here, not by
this feature's code:** `verify-f` section 4 expected an anonymous caller to see a
session on a published schedule, which migration **037** made impossible — it
hides any week no admin has approved, and `verify-f` predates 037
(last touched in `9152b46`) and so had been failing on that since. It now
approves its week, the same fixture requirement `verify-p`/`verify-s` document.
And `verify-f`/`verify-i`/`verify-k` hardcoded `localhost:3000`, which matters
because of the wedged-server paragraph below. `verify-m`, then
`verify-e`/`g`/`h`/`j`, were the remaining holdouts; **every harness now takes
`--app=`**, and the difference is not subtle: against a wedged server `verify-e`
read 32 passed / 17 failed, `verify-h` 8 / 8, `verify-j` 8 / 7 and `verify-m`
18 / 14, and against a healthy one 49 / 0, 24 / 0, 21 / 0 and 32 / 0 with nothing
else changed. A harness that cannot be pointed at a second server will eventually
be read as a product bug.

**`verify-h` section 6 was stale in the same way `verify-f` was.** It inserted a
`session_templates` row keyed by `schedule_group_id` and asserted that
duplicating a schedule copied it — behaviour migration **042** deliberately
removed when templates moved to the facility/department, which the duplicate
route's own header has said ever since. The select returned `null` (no such
column) and read as two failures in the route. It now asserts the current
contract — the palette is *not* cloned, and the duplicate lands in the same
department so it already sees it — which still fails if a duplicate starts
copying templates again.

**Build the fixture's week the way the app builds it, or the harness is a clock
bomb.** `verify-p`/`q`/`r`/`s` each carried a `weekStartOf()` that read its
argument with **UTC** getters, while the app decides which week to render with
**local** ones (`getWeekStart`, `src/lib/utils/dates.ts`). Those agree only while
UTC and local share a calendar date. On 2026-09-12 at 17:00 Pacific they stopped:
the app was rendering the week of Sep 6 and the fixtures were writing sessions
into the week of **Sep 13**, a week the page was not showing. `verify-r` went to
4 passed / 3 failed — starting with its own control, "all three activities are on
screen before any filtering", finding none of them — and `verify-s` to 20 / 1.
Nothing had changed in the product: both failed identically with that day's work
stashed, on a freshly restarted server, with the widget route already compiled.

`verify-s` is the one to learn from, because it contained *both* conventions: it
computed `localWeekStart` from local getters for its assertions and its fixture
dates from the UTC helper. A harness that disagrees with itself passes for twelve
hours a day.

All four now take the local calendar date. The change is a no-op wherever the two
coincide — under `TZ=UTC` the old and new helpers return the same week the app
does — so this is not a Pacific-specific patch. If you write a fifth browser
harness: anchor fixtures to the same calendar the thing under test uses, and
remember that `toISOString().slice(0, 10)` is a **UTC** date, which is why these
helpers return local calendar dates parked at UTC midnight.

**`page.pdf()` uses print CSS — unless you told the page otherwise.** Playwright
emulates print media for `page.pdf()` on its own, but an explicit
`emulateMedia({ media: "screen" })` earlier in the script *overrides* it, and
`verify-z`'s first run did exactly that: it reported two pages measured against
the screen stylesheet, a number that says nothing about the printout. It was
still right for a different reason — the sheet really was 1022px against ~740px
of usable page — but the measurement that found it was meaningless. Take print
measurements in print media, and print the measured height in the failure detail
so the next reader gets a number rather than a verdict.

**A fixture where two things render the same string proves nothing.** `verify-z`
section 3 asks whether a drop-in block appears in any lane cell. Its first fixture
put every session under one schedule group — and a session with no template
displays its schedule group's name — so the drop-in block, the program and the
closure all rendered the identical string and the assertion failed against correct
code. The fixture now uses two groups ("Lengths" and "Bookings"), which is also
how a real facility is set up. Before blaming the code, check that the fixture can
tell its own rows apart.

**A signed-in client is not anon, and the mistake is invisible.** These harnesses
reuse one publishable-key client for `signInWithPassword`, and supabase-js keeps
that session **in memory even with `persistSession: false`** — so every later
`anon.from(...)` runs as whoever signed in last. It first surfaced as an RLS
check that looked like a policy hole and was really being asked as an org member,
who saw the row by right. `verify-v` had the same flaw where it least wanted it — its "anon selects
`session_internal` directly" assertions were in fact the other org's admin, which
passed for a different reason than the label claimed. Both now use a second
client that never signs anyone in. If a direct PostgREST read is supposed to be
anonymous, it needs its own client.

**A wedged Next dev server looks like a route bug.** When the dev server's render
worker dies (`Jest worker encountered N child process exceptions`), *every*
dynamic `[param]` route answers 500 with an HTML body while static paths keep
working — so a harness reports failures in whatever it happens to touch. `verify-i`
read as 4 passed / 4 failed purely from this. Every harness takes `--app=` (as of
2026-09-12 — that was checked, not assumed); start a second server on another port with its own dist dir
(`NEXT_DIST_DIR=.next-verify npx next dev -p 3001`) rather than diagnosing the
code. Curl one `[param]` route before believing a failure.

`verify-t`'s `textOf()` strips HTML comments to *nothing*, before tags, and the
ordering matters: React emits `<!-- -->` between adjacent text nodes, so
`$<!-- -->89` reads as `$89` but becomes `$ 89` if the comment is replaced with a
space — which failed every price assertion in its first run against a page that
was entirely correct.

`verify-e` also reads the deletion-impact counts back out of the **flight
payload** of the rendered edit page, because the dialog they feed is closed on
first render and so contributes nothing to the DOM. Its fixture uses four
different numbers (2 departments, 1 group, 4 sessions, 3 spaces) for the reason
in rule 1 below: four fields all reading `1` would pass even transposed.

**Soft-404s under `cacheComponents` (PPR):** several dashboard edit pages
(`/dashboard/facilities/[facilityId]/edit`, likely others with the same
`loading.tsx`-above-`notFound()` shape) answer a cross-org or missing id with
HTTP 200 and the not-found page's body, not a real 404 — the Suspense boundary
above the route commits the response before `notFound()` resolves, same
mechanism `docs/SECURITY.md`/[[feedback_soft404_cache_components]] documents
for the public `/facility/[slug]` family. `verify-m`'s cross-org facility-edit
check asserts the safe half of that (zero rows, no data leak) rather than a
status code that isn't actually 404 here. Don't "fix" this by deleting the
`loading.tsx` boundary — verified elsewhere in this repo to break
`next build` outright, since these routes have no `generateStaticParams` and
lose their only prerenderable shell.

## Teardown

Each script deletes its temp org, users and uploaded objects in a `finally`, then
prints what it found left over. If a run is killed mid-way, sweep with:

```sql
SELECT id, name FROM organizations WHERE name LIKE 'ZZ %';
```

Everything they create is prefixed `ZZ ` or `verify-`.
