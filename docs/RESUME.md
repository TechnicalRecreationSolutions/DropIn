# Resume here

Written 2026-08-07 at the end of a security-remediation session. Open this
first; it points at everything else.

---

## State right now

- Working tree **clean**, `main` **level with `origin/main`**.
- Migrations **022–026 applied** to the hosted database and verified against it.
  No new migrations this session — every fix was application-level.
- `npx tsc --noEmit`, `npx eslint src` and `npx next build` all pass.
- `npm audit` reports **0 vulnerabilities**, down from 12.
- Running on **Next 16.3.0** (up from 16.2.10). PPR confirmed intact after the
  bump — the build output still shows `◐` on every dashboard route.

**The security audit is fully closed: 19 findings, 0 open.** Detail for each,
including how it was verified, is in [`docs/SECURITY.md`](SECURITY.md). Don't
reconstruct it from memory; read it.

That number means *code* findings only. Two things still gate launch, below.

---

## ⚠️ Do this first: configure custom SMTP

**Unchanged from last session, and still the thing that will bite you.** Commit
`55c1aa1` made signup send a confirmation email. Supabase's built-in mailer
allows roughly **two sends per hour**.

So signup works for about two people an hour and then **silently fails** — the
user is told to check their inbox and nothing arrives. That silence is
deliberate: the response is identical whether or not the address already exists,
which is what closes the enumeration hole. The fix is delivery capacity, not
code.

Supabase dashboard → Project Settings → Auth → SMTP. Resend is already implied by
`RESEND_FROM_EMAIL` in `.env.example`; no app dependency is needed.

Until this is done, treat signup as demo-only.

---

## ⚠️ Second launch blocker: the legal pages need a lawyer

`/privacy` and `/terms` now exist, are linked from the footer and signup, and
were drafted from the actual schema rather than a template — the data inventory
matches the migrations and the processor list matches the CSP allowlist.

They are **drafts**. Every fact only you can supply — legal entity name,
jurisdiction, contact address, retention periods, liability cap — renders as a
visible amber `[placeholder]`. That is intentional: the pages cannot quietly go
live looking finished. Search `<Placeholder>` in
`src/app/(public)/privacy/page.tsx` and `src/app/(public)/terms/page.tsx`.

One finding was dismissed rather than fixed: the audit asked for cookie consent,
but the app sets only Supabase auth session cookies and uses no local storage at
all. Strictly-necessary cookies don't require consent, so there is no banner by
design, and the privacy policy discloses them instead.

---

## Other things only you can do

Full list in [`docs/SECURITY.md` → Owner-only actions](SECURITY.md#owner-only-actions),
which grew this session. The ones that matter most:

- [ ] **Live-mode Stripe price IDs in production.** Local values are *test* mode.
      Since `0030b2c` the server refuses to boot without them — good, but it
      means a deploy fails rather than quietly mis-pricing.
- [ ] **Login rate limiting** — Supabase dashboard. Cannot be done in app code:
      `LoginForm` calls `signInWithPassword()` straight from the browser, so the
      request never reaches this app.
- [ ] **Browser-verify the CSP.** Load `/search` (Mapbox) and an embedded widget
      with the policy live and confirm a clean console. The headers are verified
      by curl and Mapbox's requirements were checked against its bundle, but
      nothing has actually rendered under enforcement. Attempted this session;
      the Chrome extension wasn't connected.
- [ ] Spend caps / budget alerts: Vercel, Supabase, Stripe, Mapbox.
- [ ] Confirm backups (PITR) and run one restore test.

---

## What changed this session

Seven findings closed. Four of them turned out to be different from their
write-ups, which is the part worth knowing:

| Finding | Outcome |
|---|---|
| **H4** | `npm audit` 12 → **0**. `xlsx` removed (imports are **CSV-only** now), `shadcn` moved out of `dependencies`, `next` → 16.3.0. |
| **M7** | CSP + HSTS added. `script-src` keeps `'unsafe-inline'` — nonces are incompatible with PPR, so this is a recorded ceiling, not an oversight. |
| **M8** | `/privacy` + `/terms` shipped. Cookie banner deliberately *not* added. |
| **L1** | The leak was in `context-elements` too, not just `hotspots`. |
| **L2** | **No code change** — the missing role check was correct. Members are granted schedule editing by the role model and by migration `024`; adding `owner\|admin` would have broken it. Documented instead. |
| **L3** | Fixed, and exposed a worse hole beside it: `/api/import/commit` had **no row cap at all** and trusted the client's own `_errors` array, so posting `_errors: []` wrote unvalidated rows. Both fixed. |
| **L4** | 18 `.single()` sites replaced with `src/lib/auth/membership.ts`. |

Two new shared modules came out of this — `src/lib/auth/membership.ts` and
`src/lib/import/rows.ts`. Both exist because the same logic was duplicated
across many routes, which is how L1 and L4 each managed to be under-reported.

### Product change worth flagging

**Excel upload is gone.** `/api/import` accepts CSV only. `xlsx` (SheetJS) has
an unfixed prototype-pollution advisory and no patched release on npm, and it
was parsing attacker-supplied files. You chose removal over pinning the vendor
tarball. Staff with .xlsx schedules must now Save As → CSV; the uploader, the
import page and the API error message all say so. If that turns out to be too
much friction, `read-excel-file` is maintained and on npm — that's the fallback,
not reinstating `xlsx`.

---

## Picking the next piece of work

Security is done. What's left is the backlog that was never captured:

### Feature work — still needs your input

Two sessions running, you've mentioned "basic functionality improvements…
adding features," and both times the work went elsewhere. **I still don't know
what's on that list.** It is now the main thing blocking planning:

- (your feature list)

### Non-security, already known

- **Route de-duplication** — the `*/edit` and `*/new` form trees are still
  duplicated across department-nested and facility-direct paths. The command
  centre resolved most of the rest.
- **`docs/PLAN.md` may be stale.** Still not reviewed. Check it against reality
  before trusting it.
- **Automated security tests** — the audit's Phase 5, never done. The harness
  pattern is documented in `SECURITY.md`; the scratch scripts are gone. Worth
  formalising now that the register claims 0 open, because nothing currently
  stops a regression from silently reopening a closed finding.

---

## Re-verifying security work

`docs/SECURITY.md` has the SQL to dump every live policy, the harness pattern,
and the three traps that produced *false green results* the first time
(`updateUser` needs `setSession`; an empty result proves nothing against an empty
table; the positive control must run last).

**One standing rule worth repeating:** a finding is only CLOSED when it has been
verified against the live database or a running app. Migration files are not
evidence — this project applies migrations by hand, so the files and the database
can drift.

[Standing assumptions](SECURITY.md#standing-assumptions) grew from 18 to 23
entries this session. That section is the regression checklist: if a future
change violates a line in it, the fix above it is silently undone.

---

## Related docs

| Doc | What it's for |
|---|---|
| [`SECURITY.md`](SECURITY.md) | Findings register, standing assumptions, owner actions |
| [`PLAN.md`](PLAN.md) | Delivery history and schema map |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Cache Components / PPR work |
| [`../README.md`](../README.md) | What the app is, how to run it |
| `src/components/schedule-command/README.md` | Command centre architecture + traps |
