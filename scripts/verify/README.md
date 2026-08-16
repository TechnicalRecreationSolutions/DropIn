# Verification harnesses

Node scripts that exercise the app against a **running server and the live
database**.

```bash
npm run dev            # they drive real HTTP; the server must be up
node scripts/verify/verify-b.mjs   # events calendar + featuring   (64 assertions)
node scripts/verify/verify-c.mjs   # storage bucket + policies     (19 assertions)
node scripts/verify/verify-d.mjs   # brochures                     (40 assertions)
node scripts/verify/verify-e.mjs   # facility delete + org settings (51 assertions)
node scripts/verify/verify-f.mjs   # recurrence + conflict correctness (11 assertions)
node scripts/verify/verify-g.mjs   # schedule-group publish gate (5 assertions)
```

They read `.env.local` for the Supabase URL, publishable key and service-role
key. Nothing is hard-coded and no secret is committed.

## What these are, and are not

**Not a test suite.** There is no runner, no CI wiring, no mocking. They are the
pattern `docs/SECURITY.md` documents: a service-role script builds a throwaway
org, drives the real routes as a really signed-in user, and deletes everything in
a `finally`. Run them by hand after touching the code they cover.

They exist because this project applies migrations by hand, so **the migration
files and the database can drift** — and because most of what they check fails
*silently*. A brochure that resurrects a dismissed entry, a calendar fetching a
week's data for a month, an unpublished page that keeps serving: none of these
throw. They just quietly do the wrong thing.

## Rules they follow, learned the hard way

1. **Every assertion has a positive control.** An empty result is not proof —
   `[]` from a working policy and `[]` from an empty table look identical. This
   repo has produced false green results twice from exactly that.
2. **Never the service role for the thing under test.** It bypasses RLS, so a
   policy test that uses it passes no matter what the policy says. The service
   role builds and tears down fixtures; a signed-in user does the acting.
3. **Two users where a role distinction is the point.** `verify-c` uses an admin
   *and* a member, because testing a member/manager split with one role proves
   half a decision.
4. **Assert the mechanism, not just the outcome.** `verify-d` asserts an entry
   survives its source being deleted — and caught that the source was never
   deleted at all, because a CHECK constraint blocked it. An assertion that only
   checked "the entry still exists" would have passed.

## What they cover

| | |
|---|---|
| `verify-b` | Range expansion, `isEvent`/`feature` reaching the calendar, the widget gate opening and closing, one-offs expanding once, flag-only PATCH semantics leaving copy intact, `SessionForm`'s two-request save, the Events tab spanning two facilities, 400/401/404 guards |
| `verify-c` | The `org-media` folder role split both ways, cross-org isolation, anonymous denial, SVG / `text/plain` / 6 MB rejection for an *authorized* user, malformed paths denying without a DB error, public read returning real bytes |
| `verify-d` | Candidacy refusing non-candidates, snapshots freezing, tombstones surviving a re-pull and a section delete, season changes not touching entries, publish gating, unpublish taking effect immediately, entries outliving their source |
| `verify-e` | Facility delete's **cascade** (departments/groups/spaces/sessions all gone, a second org's identical tree untouched), the owner/admin line on both features, cross-org delete answering 404, org PATCH stripping `slug` and `status`, empty string stored as NULL, and both new pages rendering server-side |
| `verify-f` | Session-conflict detection and recurrence expansion (`src/lib/rrule/expand.ts`, see its README): a genuine overlap still 409s, a same-space pair that only *touches* and recurs across a DST boundary does not, an evening session's expanded occurrence lands on its configured local weekday rather than the day before, and a session on an unpublished Space doesn't crash the public (anonymous) schedule read |
| `verify-g` | Schedule-group publish gate: a start date but no end date now publishes (POST and PATCH), no start date still doesn't, and a genuine space overlap between two open-ended published schedules is still caught |

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
