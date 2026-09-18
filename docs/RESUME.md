# Resume here

Open this first; it points at everything else.

**Last updated 2026-09-18**, at the end of the session that built multi-account
staff roles (see the box below). The session before it brought back a resident
directory (`/find`). This file is the single entry point. The per-track `RESUME-*.md` files are historical
records of finished work, not live handoffs — see [Related docs](#related-docs).

---

## Multi-account staff roles — shipped 2026-09-18

Four roles: `owner` / `manager` / `coordinator` (department-scoped) /
`aux` (facility-scoped, read-only). `admin` and `member` are retired — there
were zero rows of either, which is why the restructure was free.

Design and decisions: [`docs/PLAN-staff-roles.md`](PLAN-staff-roles.md).

**Migrations `055` and `056` are applied.** `verify-al` passes 41/41, five of
its assertions were falsified to prove it is sensitive, and the new pages were
rendered in a browser as each role (32 more checks). Nothing is committed yet.

Two things to know:

- **Billing is now owner-only** (was `owner|admin`). A Manager cannot cancel
  the subscription or delete the org — that was the point of keeping Owner
  separate.
- **Invitations are created but not emailed.** `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL` are still absent from `.env.local`, so the invite dialog
  falls back to "copy this link", which works fine. Note this is *not* launch
  blocker 1 below: that one is Supabase's own mailer, which the invitee still
  needs in order to confirm a new account, and it caps staff onboarding at
  roughly two people an hour until custom SMTP is configured.

While applying `055` it also closed a real hole: migration 024 deliberately
left `sessions`, `session_exceptions` and `session_spaces` writable by any org
member, which was correct when `member` meant "read plus schedule editing". An
`aux` account is a member, and the publishable key is in the browser bundle —
so before this, a lifeguard account would have been able to delete every
session in the organization through PostgREST.

---

## State right now

**Everything is pushed and deployed.** On 2026-09-17, `main` was pushed with
the internal-view track (migrations 046–049), tags/links (050) and the print
button (051), then fast-forwarded to `feat/directory` (migration 052, the
resident directory and the L5 privacy fix) and pushed again. Vercel had it live
in about two minutes; `/robots.txt`, `/find` and the directory API answered
from production. `feat/internal-view` and `feat/directory` are on GitHub too,
and both are fully contained in `main`.

- Migrations **through `052`** are applied to the hosted database, checked by
  querying it (050 and 051 by column probe, 052 by `verify-ae`). Production code
  (`3f6e085`) runs fine against the newer schema.
- `tsc`, `eslint src` and `next build` pass on `feat/directory`.
- `npm audit` reports **0 vulnerabilities**, re-measured 2026-09-16.
- Next **16.3.4**.
- Live at `https://drop-in-ten.vercel.app`; Vercel auto-deploys from `main`.

Data, measured 2026-09-16: 4 facilities (3 published), 7 sessions, **none of
them public** (see below), and no facility listed in the directory yet.

---

## ⚠️ The thing that will embarrass you first: there is no schedule

This is not a bug and nothing is broken. It is a data gap, and it undercuts a
demo more than any defect on this page would.

**Saanich Commonwealth Pool has zero sessions.** It has 6 spaces, 12 session
templates and a *published* "Lengths Swimming" group — and nothing in it. The
only sessions in the entire database (7 as of 2026-09-16, up from 2) belong to
Panorama, and they are invisible to the public because that group is
`status=draft`, which RLS correctly filters. Verified directly on 2026-09-09:

```
/api/sessions/expand?facilityId=<commonwealth>  →  {"data":[]}
/api/sessions/expand?facilityId=<panorama>      →  {"data":[]}
```

So every public surface (facility page, widget, and now any centre a resident
opens from `/find`) renders "No drop-in sessions this week." The empty states are good. That is the problem: a schedule
product demoing an empty schedule looks finished and pointless at the same time.

Two consequences worth knowing before you go looking for bugs that aren't there:

- **No view can be demoed, not just the grid.** `FacilityScheduleClient.tsx:83`
  short-circuits to the empty state *before* dispatching to `ScheduleView`, so
  all five tabs render the same message. Correct behaviour — the emptiness is a
  property of the week, not of the view — but it means Floorplan cannot be shown
  at all while the schedule is empty.
- **Commonwealth Pool also has no facility map** (`facility_maps` has rows for
  Test Rec Centre and Panorama only), so even with sessions, Floorplan would
  need one drawn at `/dashboard/map?facility=<id>`.

`scripts/seed-saanich-pool.mjs` has the real schedule transcribed from the SCP
Lengths PDF, but it is a create-everything script of plain inserts and will
collide with the facility that already exists. Making this demo-ready needs a
**sessions-only variant** that attaches to the existing facility, department,
group and spaces — and ideally links each session to one of the 12 templates
already sitting there. That has not been written.

---

## ⚠️ Launch blocker 1: configure custom SMTP

**Unchanged across three sessions now, and still the thing that will bite you.**
Commit `55c1aa1` made signup send a confirmation email. Supabase's built-in
mailer allows roughly **two sends per hour**.

So signup works for about two people an hour and then **silently fails** — the
user is told to check their inbox and nothing arrives. That silence is
deliberate: the response is identical whether or not the address already exists,
which is what closes the enumeration hole. The fix is delivery capacity, not
code.

Supabase dashboard → Project Settings → Auth → SMTP.

**The full picture lives in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) → "The domain
decision is now the bottleneck".** Seven things point at the same address and
all change together; there is a table there, and it is the single copy — do not
restate it here, it will drift.

The two-line version:

- Everything is blocked on **owning a domain**. Every mail provider requires a
  verified sending domain before it will send for you.
- There are **two independent email paths** and they fail differently:
  *auth* mail (Supabase → SMTP) and *app* mail (`RESEND_*`, staff invitations).
  Only the first blocks anything — invitations already fall back to
  "copy this link" and work today.

Worth knowing: the built-in mailer is not merely slow. It generally delivers
**only to addresses in your Supabase organization**, so a real lifeguard's
Gmail will most likely never receive a confirmation at all.

Until this is done, treat signup as demo-only.

---

## ⚠️ Launch blocker 2: the legal pages need a lawyer

`/privacy` and `/terms` exist, are linked from the footer and signup, and were
drafted from the actual schema rather than a template — the data inventory
matches the migrations and the processor list matches the CSP allowlist.

They are **drafts**. Every fact only you can supply renders as a visible amber
`[placeholder]`, deliberately, so the pages cannot quietly go live looking
finished. There are **13 distinct facts outstanding**:

| Page | Still needed |
|---|---|
| `/privacy` | legal entity name · postal address · `privacy@` address · region · email provider · retention periods (12 months, 13, 30) |
| `/terms` | legal entity name · postal address · `legal@` address · jurisdiction · province/state and country · liability cap (CAD $100) · periods (12, 30) |

Search `<Placeholder>` in `src/app/(public)/privacy/page.tsx` and
`src/app/(public)/terms/page.tsx`.

One finding was dismissed rather than fixed: the audit asked for cookie consent,
but the app sets only Supabase auth session cookies, and uses local storage only
for the theme choice and (since 2026-09-16) the centres a resident stars on
`/find`. Strictly-necessary cookies and on-device preferences don't require
consent, so there is no banner by design, and the privacy policy discloses both.

---

## Other things only you can do

Full list in [`docs/SECURITY.md` → Owner-only actions](SECURITY.md#owner-only-actions).
The ones that matter most:

- [ ] **Live-mode Stripe price IDs in production.** Local values are *test*
      mode. Since `0030b2c` the server refuses to boot without them — good, but
      it means a deploy fails rather than quietly mis-pricing.
- [ ] **Stripe webhook in production** — still not started
      (`docs/DEPLOYMENT.md` step 4). Independent of everything else.
- [ ] **Login rate limiting** — Supabase dashboard. Cannot be done in app code:
      `LoginForm` calls `signInWithPassword()` straight from the browser, so the
      request never reaches this app.
- [x] **Browser-verify the CSP in production.** Done 2026-09-17:
      `node scripts/verify/verify-ai.mjs --app=https://drop-in-ten.vercel.app`
      passed 22/22 (`/`, `/find`, a facility page, and the widget framed on
      another origin, with a positive control).
- [x] **Clear the rate-limit table.** Done 2026-09-17: the sweep removed 249
      stale rows, and the 2 remaining raw-IP rows (written by the old production
      build) were deleted once the fix was live. A fresh production request was
      confirmed to store a hashed key.
- [x] **Schedule the rate-limit sweep.** Done 2026-09-17 with migration `053`
      (pg_cron job `sweep-rate-limits`, hourly; `cron.schedule` returned job 1).
      Its first run hadn’t been checked yet; the query is at the bottom of `053`.
- [ ] **Custom domain, then raise HSTS.** `max-age` is currently **3600** — a
      deliberate low value for a domain still in flux. Raise it once the real
      domain is in place, not before.
- [ ] Spend caps / budget alerts: Vercel, Supabase, Stripe.
- [ ] Confirm backups (PITR) and run one restore test.

### Data hygiene, before showing anyone

- [ ] **The org logo is a 🦖 dinosaur** (`organizations.logo_url`, an uploaded
      file in Supabase Storage). It renders on every facility page under the org
      and in the widget header. Change at `/dashboard/settings`.
- [ ] **Brand colour is `#7a00cc`**, an unmodified purple, in the single
      `widget_configs` row. Change at `/dashboard/widget` → branding.
- [ ] **"Test Rec Centre" is published and in the live org** — it shows in the
      sidebar, the facility grid and publicly. Delete from the facility danger
      zone (it takes 1 department and 8 spaces with it, 0 sessions) or unpublish.

---

## What changed this session (2026-09-16): the resident directory

You decided to bring back a public, no-account directory, smaller than the old
marketplace, with a downloadable app as the long-term goal. Your decisions are
recorded at the top of `docs/PLAN.md`: opt-in listing, `/find` as its own
route, Nominatim for geocoding, free on every plan, and launch now.

| Commit | What |
|---|---|
| `fb5881f` | The uncommitted tags/links (050), print button (051) and compact pickers, committed together on `feat/internal-view` and fast-forwarded into local `main`. |
| `4d43e47` | Phase 1: migration `052` (`listed_in_directory`, `geocoded_at`, `location` trigger), Nominatim geocoding on save, the "List in the Dropin directory" toggle, and the backfill script (**applied**: Panorama and Commonwealth located). |
| `22e2763` | Phase 2: `GET /api/public/v1/directory`, versioned, cached and rate-limited. |
| `087eda5` | Phase 3: `/find`, with search, sport chips, "Use my location" and saved centres, built for phones first. |
| `ba1784f` | Phase 4: `sitemap.xml`, `robots.txt`, canonical tags and a breadcrumb back to `/find`. Also fixes a pre-existing bug: **facility pages stayed stale for hours after any edit**; they now refresh on save and delete. |
| `e58e02f`, `bb223d4` | Phase 5: CSP checked in a browser (`verify-ai`). **L5**: the rate limiter stored raw IPs, now hashed. `/privacy` corrected (local storage, location, Nominatim). Docs. |

Harnesses `verify-ae` through `verify-ai` all pass, and each was deliberately
broken at least once to prove it catches the bug it targets.

### Before the directory is worth visiting

1. ~~Push and deploy~~ — done 2026-09-17.
2. **List the real centres.** On each facility's edit page, tick "List in the
   Dropin directory". Nothing is listed yet, so `/find` says "No centres are
   listed yet".
3. **Give them a public schedule** (see the section above). A listed centre
   with an empty week is the first thing a resident will see.
4. ~~Run `verify-ai` against production and clear the rate-limit table~~ — done
   2026-09-17, and the sweep is now scheduled (migration `053`).

### Things this session found that are worth carrying forward

- **Don't judge caching on `next dev`.** It applies a tag expiry about 100 ms
  late, and it held a stale `/find` for minutes. A production build was
  correct both times. Build to `.next-perf` and run `next start -p 3002` (see
  `scripts/verify/README.md`). Three harnesses had been passing on timing
  luck and now pause after saves.
- **On Windows, stopping a background `next start` can leave it running.** The
  next start then fails, and requests silently reach the *old* build. Check the
  port before believing a result.
- **The mobile app needs a `v1` schedule endpoint.** The directory API is
  versioned, but the schedule on a centre's page still comes from the internal
  `/api/sessions/expand`.
- **Not planned yet** (see `PLAN.md`): session search ("lane swim near me
  tonight"), a map, an installable web app, the native app, resident accounts.
  Schedule and session edits still don't refresh the facility page's cache;
  facility edits now do.

---

## Previous session (2026-09-09)

A pre-demo scan. The application itself was healthy — build, types, lint and a
browser pass over the public surfaces were all clean, with no runtime or console
errors and no horizontal overflow at 390px. Five commits came out of it.

| Commit | What |
|---|---|
| `5dfab13` | **Critical Next.js RCE patched**, 16.3.0 → 16.3.4, plus `npm audit fix`. Also declared `playwright` — see below. |
| `75d2baf` | Removed the marketplace-era "Claim this facility" CTA and the duplicated `— Dropin \| Dropin` tab title from the public facility page. |
| `e31b6e6` | The mobile view-pill strip now scrolls instead of clipping "Floorplan" mid-word at 390px. |
| `bd1d258` | Removed the permanently-disabled notifications bell from the dashboard topbar. |
| `fda8bd6` | README rewritten (it documented `src/store/`, an `(admin)/` panel and `lib/maps/`, none of which exist); `/admin` guard annotated. |

### Two things worth carrying forward

**`npm audit` had silently regressed to 4 production advisories**, including a
**critical unauthenticated RCE** in Next 16.3.0 (Windows-hosted servers, and the
Image Optimization API on AVIF input) — while this doc claimed 0. The register
was accurate when written. Dependency advisories reopen on their own schedule,
so *"npm audit was 0"* is a statement with an expiry date. Re-run it before any
release rather than trusting the last recorded number.

**The verification harness was resting on a phantom dependency.** Every script
in `scripts/verify/` does `import { chromium } from "playwright"`, and
`playwright` was never in `package.json` — it only ever resolved transitively.
`npm audit fix` removed it, which broke the entire harness in one command; a
fresh `npm ci` would have done the same. It is now a declared devDependency.
Worth a general suspicion: **a tool the harness needs but the manifest doesn't
name is not actually installed, it is merely present.**

---

## Picking the next piece of work

### Pricing is now a framework, and it is not enforced

[`docs/PRICING.md`](PRICING.md) is new and is the entry point. The billed unit is
the **facility**, plus a base fee; departments, schedule groups, spaces,
sessions and staff are unlimited on every tier on purpose — the reasoning, the
competitor research and the market arithmetic are all in there.

Two things to carry forward:

- **No quota is checked anywhere.** `PLANS` is read by two render paths and no
  API route reads `plan_tier`. The facility allowances on both pricing pages are
  terms of sale, not limits. `POST /api/facilities` will happily create a fifth
  facility on a 1-facility plan.
- **The database cannot store the new tier names.** Migration `004`'s
  `CHECK (plan_tier IN ('free','pro','enterprise'))` is unchanged, so `plans.ts`
  carries a documented bridge. A migration and 7 new Stripe prices are owner
  actions listed in `PRICING.md`; the new prices must not go live before the
  migration does.

`scripts/verify/verify-t.mjs` covers the surfaces (57 assertions, green), and
was falsified by moving the trial and overage in the catalogue and confirming
both pages followed.

### Feature work — still needs your input

Across several sessions you've mentioned "basic functionality improvements…
adding features," and each time the work went elsewhere. **That list still isn't
written down anywhere**, and it remains the main thing blocking planning. Docs
that describe a "next phase" are *not* authorization to build it — ask.

- ~~Multiple staff accounts per organization~~ — you asked for this on
  2026-09-18 and it is built; see the box at the top of this file.
- (the rest of your feature list)

### Known and unscheduled

- **Dark mode is most of the way there, not done.** The rework left 28 files
  under `src/app/(dashboard)` hardcoding `gray-*`/`white` against 2 using
  semantic tokens; it is now **9 against 32**. The toggle works; those last 9
  files will still look light when switched to dark. Mechanical, file-by-file.
- **Notifications don't exist** — no table, no triggering events, no delivery.
  The disabled bell that used to advertise them is gone as of `bd1d258`.
  Building this starts with deciding *what* should notify someone, not with UI.
- **No org-wide session list.** `/dashboard/sessions` is now the real session
  *templates* page (`0cbc005`), not a placeholder — but a cross-schedule,
  org-wide list of actual sessions is still a different page and a different
  query shape.
- **Route de-duplication** — the `*/edit` and `*/new` form trees are still
  duplicated across department-nested and facility-direct paths. The command
  centre resolved most of the rest.
- **Automated security tests** — the audit's Phase 5, still never done. Worth
  formalising now that the register claims 0 open, because nothing currently
  stops a regression from silently reopening a closed finding. The harness
  conventions in `scripts/verify/README.md` are the pattern to follow.
- **`docs/PLAN.md` may be stale.** Still not reviewed against reality.

---

## Re-verifying security work

**The security audit is fully closed: 20 findings, 0 open** (L5 was found and
closed on 2026-09-16). Detail for each,
including how it was verified, is in [`docs/SECURITY.md`](SECURITY.md). Don't
reconstruct it from memory; read it. That number means *code* findings only —
the two launch blockers above are not code, and the dependency regression this
session was not a finding either.

`docs/SECURITY.md` has the SQL to dump every live policy, the harness pattern,
and the three traps that produced *false green results* the first time
(`updateUser` needs `setSession`; an empty result proves nothing against an empty
table; the positive control must run last).

**One standing rule worth repeating:** a finding is only CLOSED when it has been
verified against the live database or a running app. Migration files are not
evidence — this project applies migrations by hand, so the files and the database
can drift.

[Standing assumptions](SECURITY.md#standing-assumptions) is the regression
checklist: if a future change violates a line in it, the fix above it is silently
undone.

---

## Related docs

| Doc | What it's for |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Vercel + Supabase go-live checklist, in dependency order** |
| [`SECURITY.md`](SECURITY.md) | Findings register, standing assumptions, owner actions |
| [`PRICING.md`](PRICING.md) | **Pricing framework, the billed unit, and what is not yet enforced** |
| [`PLAN.md`](PLAN.md) | **Directory decisions and phases (top)**, delivery history and schema map |
| `src/app/api/public/README.md` | **Public API contract** (versioning rules) |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Cache Components / PPR work |
| [`../README.md`](../README.md) | What the app is, how it's built, how to run it |
| `scripts/verify/README.md` | Verification harness conventions |
| `src/components/schedule-command/README.md` | Command centre architecture + traps |
| `src/components/widget/README.md` | Widget studio + the two publish traps |

### Finished tracks — historical record, not handoffs

None of these is a live entry point. Each documents a track that shipped (or was
deliberately removed), and they are kept for the reasoning, not the TODOs.

| Doc | Track | State |
|---|---|---|
| [`RESUME-schedule-list-view.md`](RESUME-schedule-list-view.md) | List view + sidebar tree | Shipped |
| [`RESUME-schedule-input-fixes.md`](RESUME-schedule-input-fixes.md) | Dogfooding bug fixes | P0/P1 shipped; P2 open |
| [`RESUME-timezone-removal.md`](RESUME-timezone-removal.md) | Timezone removed as a concept | Shipped (migration `034`) |
| [`RESUME-layout-rework.md`](RESUME-layout-rework.md) | Dashboard chrome rework | Shipped; its open items are folded into this doc above |
| [`RESUME-events.md`](RESUME-events.md) | Seasons / events / brochures | **Removed on purpose** (migration `036`). Nothing to resume. |

Two chapters are closed for good and should not be reopened without a deliberate
decision: **scraping** (migration `021`) and **events/brochures** (migration
`036`). Both were built end-to-end and then torn out.
