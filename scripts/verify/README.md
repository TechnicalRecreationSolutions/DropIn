# Verification harnesses

Three Node scripts that exercise the seasons / events / storage / brochure track
against a **running app and the live database**.

```bash
npm run dev            # they drive real HTTP; the server must be up
node scripts/verify/verify-b.mjs   # events calendar + featuring   (64 assertions)
node scripts/verify/verify-c.mjs   # storage bucket + policies     (19 assertions)
node scripts/verify/verify-d.mjs   # brochures                     (40 assertions)
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

## Teardown

Each script deletes its temp org, users and uploaded objects in a `finally`, then
prints what it found left over. If a run is killed mid-way, sweep with:

```sql
SELECT id, name FROM organizations WHERE name LIKE 'ZZ %';
```

Everything they create is prefixed `ZZ ` or `verify-`.
