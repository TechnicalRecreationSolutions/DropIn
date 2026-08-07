# Resume here

Written 2026-08-06 at the end of a security-hardening session. Open this first;
it points at everything else.

---

## State right now

- Working tree **clean**, `main` **level with `origin/main`** — nothing stranded.
- Migrations **022–026 applied** to the hosted database and verified against it.
- `npx tsc --noEmit`, `npx eslint src`, and `npx next build` all pass.

Eight commits shipped this session:

| Commit | What |
|---|---|
| `aad5c3f` | Next 16 Cache Components (PPR) + Middleware→Proxy migration |
| `e82df5d` | Schedule Command Centre — facility/department/builder pages collapsed into `/dashboard/schedule` |
| `aca0c3d` | Security: superadmin escalation, invitation-token leak, member CRUD, rate limiting |
| `142ab7f` | `docs/SECURITY.md` — the living security register |
| `58003fd` | Stripe webhook no longer silently drops paid entitlements |
| `0030b2c` | Fail-fast env validation at server boot |
| `55c1aa1` | Email confirmation required; signup no longer leaks account existence |
| `9ca6272` | RLS: org billing details and unpublished widget scopes no longer anon-readable |

Security audit: **12 findings closed, 7 open.** Full detail — including how each
was verified — is in [`docs/SECURITY.md`](SECURITY.md). Don't reconstruct it from
memory; read it.

---

## ⚠️ Do this first: configure custom SMTP

**This is the one thing that will bite you.** Commit `55c1aa1` made signup send a
confirmation email (previously the code auto-confirmed every address, overriding
the project's own `mailer_autoconfirm: false` setting). Supabase's built-in
mailer allows roughly **two sends per hour**.

So right now, **signup works for about two people an hour and then silently
fails** — the user is told to check their inbox and nothing arrives. That is
deliberate: the response is identical whether or not the address already exists,
which is what closes the enumeration hole. The fix is delivery capacity, not code.

Supabase dashboard → Project Settings → Auth → SMTP. Resend is already implied by
`RESEND_FROM_EMAIL` in `.env.example`; no app dependency is needed, it's
Supabase-side config.

Until this is done, treat signup as demo-only.

---

## Other things only you can do

Full list in [`docs/SECURITY.md` → Owner-only actions](SECURITY.md#owner-only-actions).
The ones that matter most:

- [ ] **Live-mode Stripe price IDs in production.** Local values are *test* mode;
      live mode uses different strings. Since `0030b2c` the server refuses to
      boot without them — good, but it means a deploy will fail rather than
      quietly mis-price. Set them before deploying.
- [ ] **Login rate limiting** — Supabase dashboard. Cannot be done in app code:
      `LoginForm` calls `signInWithPassword()` straight from the browser, so the
      request never reaches this app.
- [ ] Spend caps / budget alerts: Vercel, Supabase, Stripe, Mapbox.
- [ ] Confirm backups (PITR) and run one restore test.

---

## Picking the next piece of work

### Security — 7 open findings

Ordered by what I'd do next. Detail for each is in `docs/SECURITY.md`.

1. **M8 — privacy policy + terms.** Launch blocker, but it's content, not
   engineering. No `privacy`/`terms` route exists; the signup form already links
   to them. Decide whether you want a draft.
2. **H4 — dependencies.** Needs a *decision*, not an upgrade: `xlsx` (SheetJS)
   has prototype-pollution and ReDoS advisories and **no fix on npm**. Options:
   pin the vendor build from `cdn.sheetjs.com`, swap the reader, or restrict
   imports to CSV-only via papaparse. `postcss`/`sharp` resolve with `next@16.3`.
3. **M7 — CSP + HSTS.** Fiddly, and worth doing carefully: a CSP that breaks
   Mapbox or the widget iframe is worse than none.
4. **L1–L4** — small cleanups (leaked Postgres error strings, a missing role
   check on `PATCH /api/sessions/[id]`, import row-cap ordering, `.single()`
   breaking multi-org users).

### Non-security, already known

- **Route de-duplication** — the `*/edit` and `*/new` form trees are still
  duplicated across department-nested and facility-direct paths. The command
  centre resolved most of the rest.
- **`docs/PLAN.md` may be stale.** It wasn't reviewed this session, and the
  command centre plus five security migrations landed since. Check it against
  reality before trusting it. (`README.md` was corrected — it still described the
  deleted `schedule-builder/` folder.)

### Feature work — needs your input

At the start of this session you mentioned "basic functionality improvements…
adding features," and we went down the security path instead without ever
capturing what they were. **I don't know what's on that list.** Jot it down here
next session and we can plan it properly:

- (your feature list)

---

## Re-verifying security work

`docs/SECURITY.md` has the SQL to dump every live policy, plus the harness
pattern and the three traps that produced *false green results* the first time
(`updateUser` needs `setSession`; an empty result proves nothing against an empty
table; the positive control must run last).

The harness scripts themselves were scratch files and are gone. The pattern is
documented well enough to rebuild them — or ask me to formalise them as proper
automated tests, which is the audit's Phase 5 and hasn't been done.

**One standing rule worth repeating:** a finding is only CLOSED when it has been
verified against the live database or a running app. Migration files are not
evidence — this project applies migrations by hand, so the files and the database
can drift.

---

## Related docs

| Doc | What it's for |
|---|---|
| [`SECURITY.md`](SECURITY.md) | Findings register, standing assumptions, owner actions |
| [`PLAN.md`](PLAN.md) | Delivery history and schema map |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Cache Components / PPR work |
| [`../README.md`](../README.md) | What the app is, how to run it |
| `src/components/schedule-command/README.md` | Command centre architecture + traps |
