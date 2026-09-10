# Resume here

Open this first; it points at everything else.

**Last updated 2026-09-09**, at the end of a pre-demo scan session. This file is
current: it supersedes the 2026-08-07 security-remediation version, and it is
again the single entry point. The per-track `RESUME-*.md` files are historical
records of finished work, not live handoffs — see [Related docs](#related-docs).

---

## State right now

- Working tree **clean**, `main` level with `origin/main` at **`fda8bd6`**.
- Migrations **through `045`** applied and verified against the hosted database
  by querying it, not by reading the files. Every table the recent tracks added
  exists: `schedule_week_reviews`, `activity_log`,
  `session_conflict_dismissals`, `widget_config_scopes`.
- `npx tsc --noEmit`, `npx eslint src` and `npx next build` all pass.
- `npm audit` reports **0 vulnerabilities** — see the note below, this had
  regressed and was fixed today.
- Running on **Next 16.3.4**. PPR confirmed intact after the bump (`◐` still on
  every dashboard route in the build output).
- **Deployed and live** at `https://drop-in-ten.vercel.app`. Vercel auto-deploys
  from `main`; today's push was live within minutes and was verified in
  production, not assumed.

The app has real dogfooding data behind it: 290 activity-log rows and 373
analytics events across 4 facilities.

---

## ⚠️ The thing that will embarrass you first: there is no schedule

This is not a bug and nothing is broken. It is a data gap, and it undercuts a
demo more than any defect on this page would.

**Saanich Commonwealth Pool has zero sessions.** It has 6 spaces, 12 session
templates and a *published* "Lengths Swimming" group — and nothing in it. The
only two sessions in the entire database belong to Panorama, and they are
invisible to the public because that group is `status=draft`, which RLS
correctly filters. Verified directly:

```
/api/sessions/expand?facilityId=<commonwealth>  →  {"data":[]}
/api/sessions/expand?facilityId=<panorama>      →  {"data":[]}
```

So every public surface — facility page and widget alike — renders "No drop-in
sessions this week." The empty states are good. That is the problem: a schedule
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

Supabase dashboard → Project Settings → Auth → SMTP. Resend is implied by
`RESEND_FROM_EMAIL` in `.env.example`; no app dependency is needed. Note that
`RESEND_API_KEY` and `RESEND_FROM_EMAIL` are **not** in the local `.env.local`
today, and `resend` appears in exactly one file (the Stripe webhook).

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
but the app sets only Supabase auth session cookies and uses no local storage
for anything but the theme choice. Strictly-necessary cookies don't require
consent, so there is no banner by design, and the privacy policy discloses them.

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
- [ ] **Browser-verify the CSP in production.** Headers *are* verified live by
      curl and were re-confirmed today; runtime enforcement in a browser is
      still outstanding. Load `/`, a facility page and an embedded widget with
      the policy live and confirm a clean console.
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

## What changed this session (2026-09-09)

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

- (your feature list)

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

**The security audit is fully closed: 19 findings, 0 open.** Detail for each,
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
| [`PLAN.md`](PLAN.md) | Delivery history and schema map |
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
