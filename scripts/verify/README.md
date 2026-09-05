# Verification harnesses

Node scripts that exercise the app against a **running server and the live
database**.

```bash
npm run dev            # they drive real HTTP; the server must be up
node scripts/verify/verify-e.mjs   # facility delete + org settings (51 assertions)
node scripts/verify/verify-f.mjs   # recurrence + conflict correctness (11 assertions)
node scripts/verify/verify-g.mjs   # schedule-group publish gate (5 assertions)
node scripts/verify/verify-h.mjs   # schedule list: published_at + modified tracking
node scripts/verify/verify-i.mjs   # per-week schedule review + public visibility gate (7 assertions)
node scripts/verify/verify-j.mjs   # activity log + revert (migration 038, 21 assertions)
node scripts/verify/verify-k.mjs   # conflict manager + dismissals (migration 039, 21 assertions)
node scripts/verify/verify-m.mjs   # departments page + facilities edit link (32 assertions)
node scripts/verify/verify-n.mjs   # widget multi-schedule filter (migration 043, 36 assertions)
node scripts/verify/verify-o.mjs   # local JWT verification rejects tampered tokens (10 assertions)
node scripts/verify/verify-p.mjs   # widget schedule switcher, driven in a real browser (17 assertions)
node scripts/verify/verify-q.mjs   # widget studio + filters: preview window, custom_title, default view, department scoping, publish trap (43 assertions)
node scripts/verify/verify-r.mjs   # general schedule filters (migration 044), driven in a real browser (28 assertions)
node scripts/verify/verify-s.mjs   # list view starts at today, earlier days collapsed (18 assertions)

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

## What they cover

| | |
|---|---|
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
