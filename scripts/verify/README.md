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
```

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

`verify-e` also reads the deletion-impact counts back out of the **flight
payload** of the rendered edit page, because the dialog they feed is closed on
first render and so contributes nothing to the DOM. Its fixture uses four
different numbers (2 departments, 1 group, 4 sessions, 3 spaces) for the reason
in rule 1 below: four fields all reading `1` would pass even transposed.

## Teardown

Each script deletes its temp org, users and uploaded objects in a `finally`, then
prints what it found left over. If a run is killed mid-way, sweep with:

```sql
SELECT id, name FROM organizations WHERE name LIKE 'ZZ %';
```

Everything they create is prefixed `ZZ ` or `verify-`.
