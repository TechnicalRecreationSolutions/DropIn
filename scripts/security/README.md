# The security sweep

```bash
node scripts/security/sweep.mjs                  # static: no server, no database
node scripts/security/sweep.mjs --live           # + anonymous probes against PostgREST
node scripts/security/sweep.mjs --live --app=http://localhost:3000
node scripts/security/sweep.mjs --falsify        # self-test: every check must go red
node scripts/security/sweep.mjs --json           # machine-readable; exit 1 on any failure
```

One check per line, each tagged with the weakness class it belongs to in
[`docs/prompts/frontend-database-security.md`](../../docs/prompts/frontend-database-security.md).
That prompt is the method; this is the part of it cheap enough to re-run on
every boundary move. Findings go in [`docs/SECURITY.md`](../../docs/SECURITY.md),
which stays the register.

`--live` reads `.env.local` for the Supabase URL, the publishable key and the
service-role key. It writes nothing except one refused `analytics_events`
insert and one `subscriptions` PATCH that matches no rows — both are the probes.

## What the states mean

| | |
|---|---|
| **PASS** | The check ran and the claim held. |
| **FAIL** | A claim did not hold, or a hit appeared that nobody has reviewed. Triage it; do not widen the pattern. |
| **INCONCLUSIVE** | The check could not prove anything — almost always an empty table, where a blocked read and an absent row look identical. The line names the `verify-*` harness that builds a fixture and settles it. |
| **MANUAL** | Listed, not automated. Two orgs, a production build, a real Stripe event, four signed-in roles — the prompt's §3 says how. |
| **BITES / BLIND** | `--falsify` only: the check caught its own poison, or did not. A BLIND check is worse news than any red above it. |

## Why there are allowlists

Several checks carry a `reviewed` map — a call site that matches the pattern but
is not the bug, with the reason written beside it. Three routes return
`error.message` from a `SECURITY DEFINER` function that raises text written for
a person; `organizations::orgs_admin_update` has no `WITH CHECK` because
Postgres then applies the `USING` clause to the new row. Each is a claim
somebody checked on a date, so re-read it when its file changes.

The alternative — loosening the pattern until the site stops matching — also
stops the *next* site matching, and the next one may be the real thing. That is
standing assumption 35.

## Adding a check

Push a `{ id, claim, run, poison }` into `STATIC`. `run` is a pure function of
the collected evidence, which is what makes `poison` possible: it returns the
same evidence deliberately broken, and `--falsify` fails the build if the check
still passes. A check without a poison is reported as un-self-testable rather
than assumed good.

If a check needs a fixture — two orgs, a signed-in coordinator, a published
week — it does not belong here. It belongs in `scripts/verify/`, which already
builds those, and the entry here should be a MANUAL line pointing at it.
