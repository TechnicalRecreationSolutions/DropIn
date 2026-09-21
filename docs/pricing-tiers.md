# Pricing tiers — feature inventory and open decisions

**Written 2026-09-20.** An inventory pass, not an implementation pass. No code
was changed.

This file answers one question: *what goes in which tier.* It does **not**
re-derive the billed unit, the price points, or the market research — those are
settled in [`PRICING.md`](PRICING.md) and nothing here contradicts them. Read
that first if you want the *why* behind $89 / $249 / $549 / quoted.

**Decisions made 2026-09-20, same day.** Every question in §4 is now answered
and recorded inline with its reasoning, along with the lapsed-subscription call
in §6. §3 reflects the settled mapping.

**One change shipped the same day** — the pricing copy, so the live page stops
promising a custom domain, an uptime commitment and a multi-facility embed that
do not exist. §7 says what was done and what was deliberately left alone.
Everything else here is still a decision, not an implementation.

---

## The one thing to know before reading further

**There is no gating in this codebase. None. Anywhere.**

Not weak gating, not UI-only gating, not gating waiting on a config value.
`PLANS` is a plain TypeScript object read by three render paths, and
`subscriptions.plan_tier` is written by the Stripe webhook and read by the
billing page to decide which card says "Current plan". No API route, no Route
Handler, no RLS policy, and no component branches on a plan or a tier.

So every mapping in §3 is greenfield. Nothing below is "move feature X from
Standard to Starter" — it is all "decide, then build the first gate this app has
ever had". That changes the cost calculus for every ambiguous call in §4: the
cheap option is not the lower tier, it is **the option that needs no gate at
all.**

---

## 1. Inventory — what actually exists

Status vocabulary: **Complete** = shipped and used; **Partial** = works but a
named piece is missing; **Stubbed** = route or schema exists, behaviour does not.

"Gated by" names the *real* gate in the code today. Three kinds exist, and none
of them is a plan:

- **Role** — `requirePermission()` + RLS (migrations 024, 055, 056)
- **Data** — a row must exist or a flag must be on (`is_published`,
  `floorplanAvailable`, `status='published'`, `listed_in_directory`)
- **None** — reachable by any signed-in member of any org

### 1.1 Schedule building

| Feature | Where | Status | Gated by |
|---|---|---|---|
| Schedule command centre | `/dashboard/schedule`, `components/schedule-command/ScheduleCommandCentre.tsx` | Complete | Role (`session:write`, scoped) |
| Session CRUD + drag-reschedule | `/dashboard/schedule/sessions/*`, `components/schedule-editor/SessionForm.tsx`, `/api/sessions` | Complete | Role (scoped) |
| Recurrence builder | `components/schedule-editor/RRuleBuilder.tsx`, `lib/rrule/` | Complete | None beyond session write |
| Session templates | `/dashboard/sessions`, `/api/session-templates` (013, 042, 047, 050) | Complete | Role (`session-template:write`) |
| Template tags — facility vocabulary | migration 050, `components/session-template/TagPicker.tsx`, `/api/tags` | Complete | Role (`tag:create` / `tag:manage`) |
| Template registration links (max 3) | migration 050, `components/session-template/LinksEditor.tsx` | Complete | Role |
| Template description | migration 050 | Complete | Role |
| Spaces (+ zones, ordering) | `/dashboard/spaces`, `.../facilities/[id]/spaces`, migrations 012, 054 | Complete | Role (`space:write`, scoped) |
| Departments | `/dashboard/departments`, migration 009 | Complete | Role |
| Schedule groups + status/dates | migration 033, `components/schedule-group/ScheduleGroupForm.tsx` | Complete | Role (scoped) |
| Duplicate a schedule | `/api/schedule-groups/[id]/duplicate`, `DuplicateScheduleDialog.tsx` | Complete | Role |
| Session exceptions (per-occurrence cancel/move) | `/api/sessions/[sessionId]/exceptions` | Complete | Role |
| **Write-time conflict block** | `lib/sessions/conflicts.ts` → `findSessionConflict` | Complete | None — always on |
| **Org-wide conflict scan** | `lib/sessions/conflicts.ts` → `findOrgConflicts`, `/dashboard/conflicts` | Complete | None |
| Conflict dismissals | migration 039, `/api/conflicts/dismiss` | Complete | Role (`conflict:dismiss`, scoped) |
| Per-week review / approval | migration 037, `/api/schedule-groups/[id]/week-reviews`, `WeekReviewBar.tsx` | Complete | Role (`week-review:write`) |
| Occupancy kind + disclosure | migration 046, `lib/sessions/occupancy.ts` | Complete | None |
| **Staff-only holder name + setup notes** | migration 046 `session_internal`, `SessionForm.tsx`, `/api/sessions` | **Complete** | RLS — no public-read policy at all |
| Availability calculator | `lib/schedule/availability.ts` | Complete | None |

### 1.2 Publishing / embed

| Feature | Where | Status | Gated by |
|---|---|---|---|
| Public facility page | `/facility/[facilitySlug]` | Complete | Data (`is_published`) |
| Embeddable widget | `/widget/[orgId]`, `public/widget.js` | Complete | Data |
| Widget Studio (4-step) | `/dashboard/widget`, `components/widget/WidgetStudio.tsx` | Complete | Role (`widget:edit`) |
| Grid / List / Space-map views | `components/schedule/Weekly*.tsx`, `ScheduleView.tsx` | Complete | `allowed_templates` (per-org config, not a plan) |
| Floorplan view | `components/schedule/FloorplanView.tsx` + legend | Complete | **Data** — `LayoutPicker` locks it behind `floorplanAvailable` |
| Board view | `WeeklyScheduleBoard.tsx`, migration 040 | Complete | `allowed_templates` |
| Brand colour + logo | `BrandColorField.tsx`, `OrgThemeProvider.tsx`, migration 030 | Complete | Role |
| Visitor schedule switcher (scopes) | migration 043, `ScheduleScopeSwitcher.tsx` | Complete | Data (scope rows exist) |
| Visitor filters (search/activity/day/time) | migration 044, `VisitorFilterToggles.tsx` | Complete | Config array |
| Print button + PrintableSchedule | migration 051, `PrintToggle.tsx`, `PrintableSchedule.tsx` | Complete | Config (`allow_print`) |
| Resident directory `/find` | migration 052, `/api/public/v1/directory` | Complete | Data (opt-in `listed_in_directory`) |
| Org verification + global facility slugs | migration 057 | Complete | Trigger-locked |

**One row of `widget_configs` per organization** since migration 045. Every
capability in this section is therefore org-wide, not per-facility — which
matters for the Multi-site tier and is flagged in §4.8.

### 1.3 Facility map

| Feature | Where | Status | Gated by |
|---|---|---|---|
| Map editor | `/dashboard/map`, `components/facility-maps/MapEditorClient.tsx`, migrations 016–019 | Complete | Role (`map:edit` — owner/manager only) |
| Shape palette + pool/lane presets | `lib/facility-shapes/presets.ts`, `ShapePalette.tsx` | Complete | Role |
| Hotspots + context elements | `/api/facility-maps/[id]/hotspots`, `/context-elements` | Complete | Role |
| Live floorplan + transition alerts | `FloorplanView.tsx`, `FloorplanLegend.tsx` | Complete | Data |
| Public map read | `/api/facility-maps/public` | Complete | Data |

### 1.4 Analytics

| Feature | Where | Status | Gated by |
|---|---|---|---|
| Analytics dashboard | `/dashboard/analytics`, migration 041 | Complete | Role (`analytics:view`) |
| Event ingestion | `/api/analytics/track`, migration 025 lockdown | Complete | Rate limit |
| Views chart, template breakdown, dwell, referrer | `components/dashboard/analytics/*` | Complete | Role |
| **Retention window** | `lib/analytics/queries.ts` → `getAnalyticsSummary(..., days = 30)` | **Partial** | **Hardcoded 30. `PLANS[*].limits.analyticsHistoryDays` is never read.** |
| Retention *pruning* | — | **Does not exist** | Events accumulate forever; no `pg_cron` job (053 schedules only the rate-limit sweep) |

### 1.5 Branding

Covered by §1.2 — brand colour, logo, org theme. All org-wide, all role-gated,
none plan-gated.

### 1.6 Admin / roles

| Feature | Where | Status | Gated by |
|---|---|---|---|
| Four-role model (owner/manager/coordinator/aux) | migrations 055, 056, `lib/auth/roles.ts`, `lib/auth/guard.ts` | Complete | Role + RLS |
| Department/facility scopes | `components/staff/ScopePicker.tsx` | Complete | Role |
| Staff panel | `/dashboard/staff`, `StaffPanel.tsx` | Complete | Role (`staff:view`) |
| Invitations | `/api/staff/invitations`, `InviteDialog.tsx`, migration 056 | **Partial** | **No email delivery** — `RESEND_API_KEY` absent, falls back to copy-a-link |
| Transfer ownership | `/api/staff/transfer-ownership`, `TransferOwnership.tsx` | Complete | Role (owner only) |
| Leave organization | `/api/staff/members/leave` | Complete | Role |
| Activity log | migration 038, `/dashboard/activity`, `ActivityLogView.tsx` | Complete | Role (`activity:view`) |
| Revert a change | `/api/activity/[id]/revert` | Complete | Role (`activity:revert` — owner/manager) |
| Org settings | `/dashboard/settings`, `OrgSettingsForm.tsx` | Complete | Role |
| Facility delete | `/api/facilities/[facilityId]` DELETE, `DeleteFacilityDialog.tsx` | Complete | Role |
| Billing | `/dashboard/billing`, `/api/stripe/*` | **Partial** | Role (owner only). 2 of 7 Stripe prices exist, both test mode |

### 1.7 Import / export

| Feature | Where | Status | Gated by |
|---|---|---|---|
| CSV import wizard | `/dashboard/import`, `components/import/ImportWizard.tsx` | **Partial** | Role (`import:use`) |
| Import parse + preview | `/api/import`, `lib/import/rows.ts` | Complete | Rate limit; 500 rows / 10 MB |
| Import commit | `/api/import/commit` | **Partial** | Role |
| Deck sheet (print) | `/dashboard/schedule/deck` (print route group), `lib/schedule/deckSheet.ts` | Complete | Role + staff-only route group |
| **Any export** (CSV, ICS, PDF data) | — | **Does not exist** | — |

**The import gap matters for pricing.** `/api/import/commit` inserts into
`schedule_groups` and `sessions` only. It writes no `session_spaces` rows, no
templates, and no tags — imported sessions carry a free-text `location_detail`
and nothing else. So an imported schedule **cannot appear in the map, floorplan,
board or deck views** until someone opens every session and assigns spaces by
hand. `.xlsx` was deliberately dropped (SheetJS advisories, SECURITY.md → H4),
so customers must export to CSV first.

### 1.8 Notifications

**Does not exist in any form.** No table, no route, no component, no digest, no
change alert, no subscriber list. The only outbound mail in the product is
Supabase's auth confirmation (rate-limited to ~2/hour until custom SMTP is
configured — still launch blocker 1) and the unconfigured Resend path for staff
invites. Anything sold as a notification on any tier is net-new.

---

## 2. How gating works today

**It does not.** Stated once at the top; here is the evidence.

### The mechanism

`src/lib/stripe/plans.ts` exports `PLANS: Record<PlanTier, Plan>` — a literal
object with `limits.facilities`, `limits.extraFacilityMonthly`,
`limits.analyticsHistoryDays`, and a `views: ScheduleTemplate[]` array.

### Every place it is read

| Reader | What it does with it |
|---|---|
| `src/app/(public)/page.tsx` | Renders the marketing pricing grid |
| `src/app/(dashboard)/dashboard/billing/BillingClient.tsx` | Renders the plan cards |
| `src/app/(dashboard)/dashboard/billing/page.tsx` | Maps stored tier → catalogue entry for the "Current plan" badge |

That is the complete list. `limits.facilities` is rendered as copy.
`limits.analyticsHistoryDays` is rendered nowhere at all — it is dead data.
`views` is rendered nowhere; the actual view list comes from
`widget_configs.allowed_templates`, which has no relationship to a plan.

### Every place `plan_tier` is touched

| Path | Direction |
|---|---|
| `/api/stripe/webhook` | **Write** — sets `plan_tier` from the price ID, or `'free'` on cancel |
| `/api/stripe/create-checkout` | Reads `subscriptions` to decide trial eligibility only |
| `/dashboard/billing/page.tsx` | **Read** — for display |

No Route Handler, no server component, no client component and **no RLS policy**
reads `plan_tier` to decide whether an action is allowed. `POST /api/facilities`
will create a fifth facility on a Starter subscription without complaint, and the
live org currently runs 3 facilities on `free`/`canceled`.

### Server-side or UI-only?

Neither. There is nothing to enforce and nothing to hide. Plans are **terms of
sale printed on two pages.**

### Two structural obstacles to fixing that

1. **The database cannot store the tier names.** Migration `004` has
   `CHECK (plan_tier IN ('free','pro','enterprise'))`. `plans.ts` carries a
   documented bridge (`STORED_TIER_TO_PLAN`, `PLAN_TO_CHECKOUT_TIER`) that maps
   the four-tier catalogue onto three legacy values, mapping *up* on purpose. A
   migration must widen the constraint before any gate can key on a real tier.
2. **There is a second, stale `PlanTier` type.** `src/types/app.types.ts:20`
   declares `PlanTier = "free" | "pro" | "enterprise"` — same name, different
   meaning from the one in `plans.ts`. Whichever one a future gate imports, the
   other is a live trap. Worth deleting before writing the first gate, not after.

### What *is* enforced, and enforced well

The role layer. `requirePermission()` gives a 403 with a human explanation, and
every check has a matching RLS policy in migration 055 — because the publishable
key ships in the browser bundle, so anything enforced only in the app layer can
be skipped by calling PostgREST directly. Migration 024 exists because that
lesson was already learned once here.

### How much of that applies to a *plan* gate — corrected 2026-09-20

An earlier draft of this section said **any** plan gate must be built in both
layers or it is decorative. That is right for role gates and overreaching for
billing state, and the difference is the adversary.

RLS is mandatory for roles because an `aux` lifeguard **holds the publishable
key** and could call PostgREST directly to delete every session in the
organization. Hostile insider, real blast radius, and exactly the hole migration
055 §5 closed.

The adversary for a lapsed subscription is a customer who stopped paying and
wants to keep editing **their own schedule**. Blast radius: their own data. That
is a commercial risk, not a security one, and app-layer enforcement is
proportionate to it. A determined non-payer with devtools could bypass it; that
is an acceptable trade rather than a defect.

Two measurements that shaped this, both taken 2026-09-20:

- **There is no single write chokepoint in RLS.** 106 write-capable policies
  across the migrations, of which only 56 route through
  `can_write_department()`, `can_write_schedule_group()` or `org_can_manage()`.
  The raw count overstates the live surface — migrations drop and recreate
  policies — but patching those three functions would provably not cover it.
- **`requirePermission()` is not a chokepoint either.** 26 of 47 route files
  call it. Fourteen files have write handlers that do not; some correctly
  (`stripe/webhook`, `auth/signup`, `invitations/[token]/accept` are pre-auth or
  system paths), but `facilities/route.ts` **POST** — facility creation, the
  single most obvious quota target — is not one of them, nor are
  `import/commit`, `conflicts/dismiss`, or the `staff/*` family.

So a plan gate is app-layer work, and it is *route enumeration* work rather than
one-function work. Neither layer offers a switch.

---

## 3. The tier mapping — settled 2026-09-20

Applying your rule: **a feature belongs higher when it costs you support hours or
data-entry time, not when it was hard to build.** Reference budget — Starter ~3
hrs/customer/yr, Standard ~12, Multi-site ~20.

Three features are expensive to *support* and cheap to *build*; two are the
reverse. The rule sorts them correctly, and that is the main thing this section
changes versus the ladder currently in `PRICING.md`.

Every line below is decided. The reasoning for each contested one is in §4.

### Starter — ~3 hrs/yr. Must be self-serve end to end.

The test: a single coordinator sets this up alone on a Tuesday afternoon and
never calls you.

- 1 facility (already the tier's definition)
- Schedule builder: sessions, recurrence, templates, tags, links, exceptions
- Departments, schedule groups, spaces
- **Write-time conflict blocking** (`findSessionConflict`) — always on, never a
  tier lever; shipping a product that knowingly lets you double-book a lane is
  not a cheaper product, it is a broken one
- Public facility page, embed widget, grid / list / space-map views
- Brand colour and logo
- Print button
- Directory listing (opt-in)
- 30 days of analytics
- Roles: **Owner + Staff (aux) only**
- *No CSV import* — moved up, see §4.1

### Standard — ~12 hrs/yr. The tier with an onboarding conversation in it.

- up to 4 facilities
- **CSV import**, with the space-assignment follow-up as an explicit onboarding step
- **Facility map editor + floorplan and board views** — the single largest
  data-entry item in the product; you will be on a call while someone draws a pool
- **Internal view: holder names, setup notes, deck sheet** — the Commonwealth
  Excel-replacement feature, and pure data entry
- Visitor schedule switcher (multi-schedule filter)
- Org-wide conflict manager + dismissals (§4.2)
- Activity log, revert, per-week review
- Full role model: Manager + Coordinator with department scopes (§4.5)
- **Club / user-group allocation view** *(when built — §5.2; holders vocabulary
  is a precondition, §4.6)*
- 12 months of analytics
- Priority email support

### Multi-site — ~20 hrs/yr. Cross-building coordination.

- up to 12 facilities
- Guided onboarding for the first schedule
- Cross-facility allocation rollup *(the §5.2 rollup piece, once the Standard
  view exists)*
- 24 months of analytics
- Uptime commitment

**Note what Multi-site is now.** The "one embed spanning every facility" line is
gone (§4.8, it was never true as a tier capability), and club allocation moved
down to Standard (§4.6). What remains is a **volume tier**: facility allowance,
analytics window, onboarding and an uptime commitment. That is a defensible
thing to be — `PRICING.md` already argues the ladder should be short and the
facility count should carry the price — but it means Multi-site has no
capability of its own except the rollup, and the rollup does not exist yet.
Worth revisiting once a real multi-building customer says what they actually
need across sites.

### Enterprise — quoted.

- Unlimited facilities
- Custom domain
- Unlimited analytics history
- PO and annual invoicing
- Named contact, security review, data export on request

### What deliberately stays ungated on every tier

Stated so it is not quietly re-litigated into a tier later:

- **Write-time conflict blocking.** Correctness, not a feature.
- **RLS and the disclosure model.** A security boundary is never a SKU.
- **Departments, schedule groups, spaces, sessions, templates, staff accounts,
  embeds, pageviews.** Already settled in `PRICING.md`; metering any of them
  either fails the gaming test or taxes the thing the product exists to do.

---

## 4. Open decisions

**This is the section that needs your calls.** Each one states both cases and the
support-hour consequence. None is decided here.

Recurring consideration, so it is stated once rather than six times: **a gate
that does not exist costs zero support hours and zero build time.** Every "put it
in the higher tier" answer below buys you an upgrade lever and sells you a gate
to build in two layers, plus the support calls from people who hit it.

---

### 4.1 CSV / bulk import

**Case for Starter.** It is the on-ramp. A single centre arriving with a
spreadsheet and no way to load it is a centre that types 200 sessions by hand or
walks away during the trial. It is also already built, so including it costs
nothing.

**Case for Standard.** Import as shipped does not finish the job. It writes
schedule groups and sessions and **no space assignments** — so the imported
schedule renders in grid and list and is invisible in map, floorplan, board and
the deck sheet. Every import therefore ends in either a support ticket ("why is
my map empty?") or hours of manual space assignment. That is the definition of
your rule's higher tier. It also has the sharpest edges in the product: CSV-only
since the SheetJS advisories, 500-row cap, 10 MB cap, a fixed column set, and
date/day parsing that fails per-row.

**Support cost.** In Starter: realistically **1.5–3 hrs per importing customer**
— malformed-CSV help, column questions, and the empty-map conversation. That is
half to all of the entire Starter budget, spent on the customers paying least.
In Standard: roughly the same hours, inside a budget with room for them, and
attached to the onboarding call where you would be looking at their data anyway.

**Worth deciding separately from the tier:** whether Starter gets import *without*
the views that expose the gap. Grid and list only is Starter's bundle anyway, and
that is the one arrangement where Starter import does not generate the empty-map
ticket — the gap only becomes visible once a customer has the map views, and on
this proposal they do not.

> **Decision (2026-09-20): Standard.** The support-load arithmetic decided it —
> 1.5–3 hrs per importing customer against a 3-hour budget, spent on the
> customers paying least. Import moves to the tier that already has an
> onboarding call in it, and space assignment becomes an explicit step in that
> call rather than a surprise afterwards.
>
> **Follow-on, not blocking the tier:** `/api/import/commit` still writes no
> `session_spaces`. Tiering it relocates that cost rather than removing it, so
> the fix is still worth scheduling — just not before a Standard customer is
> using import in anger.

---

### 4.2 Conflict detection depth

Three genuinely separable layers, currently all on for everyone:

| Layer | Where | What it does |
|---|---|---|
| A. Write-time block | `findSessionConflict` | Refuses a save that double-books a space |
| B. Org-wide scan | `findOrgConflicts`, `/dashboard/conflicts` | On-demand sweep across every active session, incl. drafts |
| C. Dismissals | migration 039 | Mark a flagged pair as intentional so it stops reappearing |

**Case for all three in Starter.** Layer A is correctness and should never be a
lever (§3). Layers B and C are computed on demand with no persisted table behind
B, so they cost you nothing to run. A one-facility customer with three schedule
groups can still double-book Lane 3 between Aquatics and a rental.

**Case for B and C in Standard.** The org-wide scan only becomes *interesting*
across departments and buildings — which is where multiple coordinators are
editing at once. And it has a support shape of its own: a sweep that surfaces 40
historical overlaps on day one is a phone call, and the answer to that call is
"dismiss them", which is layer C. Selling the alarm without the mute button is
worse than selling neither.

**Support cost.** B+C in Starter: **~1 hr/customer/yr**, spike-shaped — almost
all of it in week one, explaining the first scan. In Standard: the same hour,
absorbed by onboarding. Splitting them (B in Starter, C in Standard) gives the
worst version: the alarm with no mute.

**The real question is not the tier, it is whether B and C travel together.** They
should. Pick one tier for the pair.

> **Decision (2026-09-20): layers B and C both in Standard.** They travel
> together — shipping the alarm without the mute button was explicitly rejected.
>
> **Layer A (write-time blocking) stays on for every tier, permanently**, and is
> recorded in §3 under "what deliberately stays ungated". It is correctness, not
> a feature, and it is not revisited.

---

### 4.3 How many schedules and spaces a Starter facility gets

**Case for unlimited (the status quo).** `PRICING.md` already decided this and
the reasoning holds: schedule groups and spaces both fail the gaming test, and
capping spaces means charging a customer for drawing their own building
properly — taxing the map, which is the most distinctive thing here. A pool with
8 lanes, a hot tub and a leisure tank is 10 spaces before anyone has done
anything unusual. A cap low enough to matter commercially is low enough to break
a normal single facility.

**Case for a cap.** Facilities grow slowly, so Starter has no natural expansion
path at all — a single centre pays $89 forever. A space or schedule cap is the
only in-tier growth vector that exists, and Skedda prices spaces successfully.

**Support cost.** Unlimited: **zero.** A cap: **~0.5–1 hr/customer/yr** in
"why can't I add another lane" tickets, *plus* the build cost of the count check
in both the API and RLS, *plus* the risk of a customer modelling their building
wrong to stay under it — which produces a broken floorplan, and that support call
is much more expensive than the one you were trying to monetise.

**Note the asymmetry.** Every other decision on this page is a choice between two
defensible options. This one is lopsided: the cap costs support hours, build time
and product correctness, in exchange for revenue from the tier least able to pay
it.

**If you want a Starter expansion lever anyway**, the honest candidates are
published departments within the facility (the large-facility uplift already
floated in `PRICING.md`) or simply annual uplift at renewal — neither of which
touches spaces.

> **Decision (2026-09-20): unlimited, and closed.** This was already settled in
> `PRICING.md` under "Things decided, so they are not re-litigated" — no
> metering of departments, schedule groups, spaces or sessions. It was surfaced
> here only because it was on the list to flag, and re-deciding it would have
> contradicted a standing decision.
>
> Recorded as closed so a future pass does not raise it a third time. If Starter
> ever needs an expansion lever, the candidates are the large-facility uplift
> (published departments within one facility) or annual uplift at renewal.
> Neither touches spaces.

---

### 4.4 Analytics retention

**What is true today.** The window is hardcoded — `getAnalyticsSummary(..., days
= 30)`. `limits.analyticsHistoryDays` exists in `PLANS` (30 / 365 / 730 / ∞) and
**is read by nothing.** There is also **no pruning job**: events accumulate in
`analytics_events` forever regardless of tier, so retention is purely a
*read-window* question, not a storage question.

**Case for a short Starter window.** It is the cheapest gate in the entire
product to build — one number, passed from the plan into an existing query
parameter, with no new UI and no RLS consequence. The ladder is already written
down. And year-over-year comparison is a genuine reason a municipality upgrades:
"what did attendance look like last September" is exactly the seasonal question
this market asks.

**Case against tiering it at all.** It produces almost no upgrade pressure in
practice, because the data does not exist yet to want. A customer who signs in
September has no September-last-year to look at until September next year — so
the lever does nothing during the first 12 months of every customer
relationship, which is the window in which upgrades actually happen. Meanwhile
`analyticsHistoryDays` sitting in a shipped object as dead data is itself a small
liability.

**Support cost.** Either way: **effectively zero.** Nobody files a ticket about a
chart window. This is the one item on this page where the support-load rule gives
no signal at all — decide it on whether you believe the seasonal-comparison
upgrade story, not on cost.

**Decide alongside it:** whether to prune at all. Unlimited retention on
Enterprise is currently true by accident rather than by design, and an events
table nobody prunes is a slow-growing bill on your side.

> **Decision (2026-09-20, tiering): keep the ladder already in `PLANS`** —
> 30 / 365 / 730 / ∞. Wiring `limits.analyticsHistoryDays` into
> `getAnalyticsSummary()` is one query parameter, and that is where it should
> have been pointing all along rather than sitting as dead data. Decided on the
> seasonal-comparison story, not on cost — the support-load rule gave no signal
> here, and that is recorded rather than dressed up as conviction.
>
> **Decision (2026-09-20, pruning): yes, prune.** Unlimited retention on
> Enterprise is currently true by accident rather than by design, and an events
> table nobody prunes is a slow-growing bill on your side. Needs a `pg_cron` job
> alongside the rate-limit sweep already scheduled in migration 053 — the
> mechanism exists, so this is a job definition rather than new infrastructure.

---

### 4.5 Staff roles and permissions

**What exists.** Four roles with department and facility scopes, enforced in both
layers (migrations 055/056 + `lib/auth/roles.ts`). It is the most carefully built
subsystem in the app. **Invitations are not emailed** — `RESEND_API_KEY` is
absent, so the flow falls back to copy-a-link.

**Case for the full model on Starter.** `PRICING.md` has a standing rule — never
meter seats — and it applies with force here: the value only lands when the
aquatics coordinator, the arena staff and the web person each edit their own
part. A role cap does not produce upgrades, it produces one shared login, and a
shared login makes the `activity_log` worthless the moment four people use it.
That log is a Standard selling point, so gating roles quietly degrades a feature
you are selling one tier up.

**Case for splitting the ladder.** *Number* of accounts and *sophistication* of
the permission model are different things, and the standing rule only covers the
first. A one-facility Starter centre genuinely does not need department-scoped
coordinators — there is often one department. Meanwhile scopes are the single
biggest support-load generator in the whole product: every "I can't see my
schedule" ticket is a scope misconfiguration, and `guard.ts` already carries
three distinct explanation strings because there are three distinct ways to be
confused by it.

**The shape that respects both:** unlimited accounts on every tier (rule intact),
but Starter gets **Owner + Staff (aux)** only, with Manager and Coordinator — the
roles that *have* scopes — starting at Standard. That gates the support load, not
the seats.

**Support cost.** Full model on Starter: **~2–4 hrs/customer/yr** once a centre
has three or more people, almost entirely scope confusion. That alone can exceed
the entire 3-hour Starter budget. Owner + aux only: **~0.5 hr**, because there is
nothing to misconfigure.

**Blocker either way:** until custom SMTP and Resend are configured, *every*
tier's invite flow is copy-a-link. Staff roles cannot carry a tier's value
proposition while the onboarding path is a manually pasted URL.

> **Decision (2026-09-20, accounts): unlimited on every tier.** The standing
> "never meter seats" rule from `PRICING.md` is intact and was not reconsidered.
>
> **Decision (2026-09-20, roles per tier): Starter gets Owner + Staff (aux).**
> Manager and Coordinator — the two roles that carry scopes — start at Standard.
> This gates the *support load* rather than the seats: ~0.5 hr/customer/yr on
> Starter instead of 2–4, because a tier with no scopes has nothing to
> misconfigure.
>
> **Still blocked, independent of this decision:** until custom SMTP and Resend
> are configured, every tier's invite flow is copy-a-link. Staff roles cannot
> carry Standard's value proposition while onboarding a coordinator means
> pasting a URL into a chat window.

---

### 4.6 Anything touching club / user-group data

**What exists.** `session_internal.holder_name` (migration 046) — free text, one
row per session, with **no public-read policy at all**. Plus
`occupancy_kind = 'rental' | 'program'` and the deck sheet that prints holder
names for staff on deck. What does **not** exist is any *club* entity: no table,
no vocabulary, no per-club view, no allocation total. "Island Swimming" is a
string typed into a session, again, every time.

**Case for Standard.** This is the Commonwealth feature — the reason the internal
view was built. It is the difference between replacing their Excel sheet and not,
and it is what a second aquatics prospect will ask for on the first call.

**Case for Multi-site.** Club allocation is a *negotiation* artifact — "Island
Swimming has 6 lane-hours a week across three buildings" — and the question only
has an interesting answer above one facility. At one centre the coordinator
already knows.

**Support cost, and this is the one that is badly underestimated.** Free-text
holder names drift exactly the way migration 050 predicted for tags: "Island
Swimming", "Island Swim Club", "ISC" and "island swimming" become four clubs in
any report built over them. The moment you sell an allocation *view*, you own
that drift — every wrong total is a support ticket, and the fix is manual data
repair on your side. Estimate **3–6 hrs/customer/yr** if built over free text,
versus **~1 hr** if a holders vocabulary table lands first.

**So the prior decision is not the tier.** It is whether a `holders` table (the
same shape as `tags` in migration 050: one row per concept, facility- or
org-scoped, picked rather than typed) is a precondition. Tiering the view without
it sells a report you cannot make correct.

> **Decision (2026-09-20, tier): Standard.** It is the Commonwealth
> Excel-replacement feature and the thing a second aquatics prospect asks for on
> the first call. Moved down from the Multi-site slot it held in the first draft
> of §3 — the cross-facility *rollup* stays at Multi-site, the view itself does
> not.
>
> **Decision (2026-09-20, vocabulary): holders table first, always.** The
> allocation view is not built over free text. ~1 hr/customer/yr instead of 3–6
> spent on manual data repair, and it is the difference between a report that is
> correct and one you cannot fix from your side once a customer disputes a
> total.

---

### 4.7 Facility map editor and floorplan *(not on your list — flagging it)*

Placed in Standard in §3, but it is arguable, and it is the biggest data-entry
item you have.

**Case for Starter.** It is the most distinctive thing in the product and the
best demo. A single aquatic centre is precisely the customer whose building is
worth drawing, and `LayoutPicker` already gates floorplan on `floorplanAvailable`
— the drawing existing — so a natural gate is in place with no plan involved.

**Case for Standard.** Drawing a building is hours of work and you will be on the
call for it. That is your rule's clearest possible case.

**Support cost.** Starter: **2–5 hrs per customer who attempts it**, which blows
the 3-hour budget on its own. Standard: the same hours, budgeted, and it is the
feature that justifies the price step.

> **Decision (2026-09-20): Standard.** 2–5 hrs of data entry per customer who
> attempts it — the clearest case on this page for the support-load rule, and
> the feature that carries the step from $89 to $249.
>
> Note this makes `floorplanAvailable` and the plan check two *different* gates
> on the same view. Both are correct and both must stay: the plan check answers
> "may this org publish a floorplan", the data check answers "is there a drawing
> to publish". Collapsing them would let a Standard customer select a view that
> renders nothing.

---

### 4.8 Multi-facility embed *(structural — decide before selling it)*

Multi-site's headline is "one embed spanning every facility". **Migration 045
collapsed `widget_configs` to one row per organization** — and it did so because
the per-facility split silently overrode step 1 of the studio and left facility
pages un-branded.

So "one embed spanning every facility" is already how the product works on every
tier, including Starter. It is not a Multi-site capability; it is the current
architecture. Either the tier needs a different headline, or per-facility widget
configuration has to come *back* as the differentiator — which means re-opening a
decision that was reversed, for good reasons, two weeks ago.

> **Decision (2026-09-20): new headline; migration 045 stands.** Per-facility
> widget configs do not come back. The "one embed spanning every facility" line
> comes **out of `PLANS.multisite.adds`** — it describes the current
> architecture on every tier including Starter, so as a tier claim it is simply
> false. Multi-site leads on the facility allowance and cross-building
> coordination instead.
>
> This is one of three false lines currently rendering on the live pricing page.
> The other two are in §5.4 and come out at the same time.

---

## 5. Gaps — Standard features that do not exist

You named three. **One is already built, one is half-built, and one was built and
deliberately removed.** Details matter here, so each gets its evidence.

### 5.1 Staff-only operational notes on sessions — **ALREADY BUILT**

Shipped in migration 046 and live. `session_internal` holds `holder_name` and
`setup_notes` ("soft lane ropes, wave breakers, polo nets"), 1:1 with sessions,
with **no public-read policy of any kind** — the redaction is a property of the
database rather than something the API must remember. `SessionForm.tsx` edits
both fields, `/api/sessions` writes them, `/api/sessions/expand` attaches them
for insiders only, and the deck sheet prints them as numbered footnotes.

**Estimate: 0 days.** Sell it today.

The one real limitation, deliberately deferred in 046: notes are **per session,
not per occurrence.** "Polo nets this Tuesday but not next" needs
`session_exceptions` to carry its own note. If Standard's promise includes
per-occurrence notes, that increment is **~2 days** (column on
`session_exceptions`, an override in the expander, exception-aware footnotes in
the deck sheet).

### 5.2 Club / user-group allocation view — **HALF BUILT**

Present: `holder_name`, `occupancy_kind='rental'|'program'`, RLS isolation, and
holder names rendered on the deck sheet. Absent: any club *entity*, and any view
that aggregates across sessions.

**Estimate: 4–7 days**, and it splits cleanly:

| Piece | Days | Note |
|---|---|---|
| `holders` vocabulary table + picker | 2 | Same shape as `tags` (050); the precondition from §4.6 |
| Backfill / merge UI for existing free-text names | 1 | Needed the day the table lands, not later |
| Allocation view (per club: lane-hours, days, facilities) | 2 | Reuses `expandOccurrenceTimes` and the availability calculator |
| Cross-facility rollup | 1–2 | Only if this is a Multi-site feature |

Built over free text instead of a vocabulary it is **~2 days** — and it produces a
report that is wrong in a way you cannot fix from your side. Not recommended.

### 5.3 Alternate pool layouts (50M / 25M / shallow) — **BUILT, THEN REMOVED ON PURPOSE**

This one needs care before it is sold.

This is `facility_configurations`, migration **048**, removed by migration **049**
four days later. 049 is explicit that this was not a bad deploy: 048 worked, and
it described the building wrongly in a way that could not be repaired.

Three findings from 049, all worth keeping:

1. `UNIQUE (facility_id, slug)` from migration 012 forbids two spaces named
   "Lane 1" at one facility — so **the feature failed on its own motivating
   example**, a long-course Lane 1 and a short-course Lane 1, with a
   duplicate-name error.
2. Widening that constraint makes it worse. Two rows both named "Lane 1", both
   bookable, both the same water: a 9am claim on each is a real double-booking the
   conflict engine cannot see, because they are different `space_id`s. Duplicate
   lanes make physical overlap an unsolvable geometry problem.
3. `configuration_id = NULL` meant both "exists in every configuration" and "not
   tagged yet", indistinguishable — so the map filter silently did nothing until
   an invisible setup step had been completed across every space.

The replacement decision was: lanes stay 1–8 permanently, and whether the tank is
long course or short course is **a fact about the session running in it**, not
about the water — expressed as a label on the session. In practice today that
label is a **facility-scoped tag** (migration 050). No dedicated column exists; I
grepped for one.

So there are two quite different things you could sell, and they cost very
different amounts:

| Option | Days | What you get |
|---|---|---|
| **A. Label only** — a first-class "layout" field on template/session, driving the legend and a public "Long Course tonight" badge | **2–3** | Patron-legible. Conflict engine unaffected. Does not re-open 049 |
| **B. Real configurations** — spaces that exist in one layout and not another, with a correct denominator for the availability calculator | **10–15, plus a design decision you have already made twice** | Requires solving physical lane overlap — the thing 048 declined to model and 049 identified as the root error |

**Recommendation: A, and do not describe it as B in the pricing copy.** Option B
is not expensive because it is hard to build; it is expensive because it re-opens
a closed architectural decision, and the last two attempts at this shape both
ended in a removal migration.

If a customer genuinely needs B — a 50m tank with a bulkhead, where "how many
lanes exist right now" must be a real number — that is a scoping conversation
before it is a pricing one.

### 5.4 Also missing, and easy to promise by accident

| Thing | Status | Estimate |
|---|---|---|
| **Notifications of any kind** | Does not exist — no table, no route, no component | 5–8 days for a first digest, and **blocked on SMTP** |
| **Any data export** (CSV, ICS, PDF-of-data) | Does not exist | 2–3 days for CSV; ICS is 3–4 and invites a sync conversation |
| **Emailed staff invitations** | Code path exists, keys absent, copy-a-link fallback | Configuration, not code — needs a domain |
| **Custom domain** (an Enterprise bullet) | Removed from `adds` 2026-09-20 | 3–5 days plus Vercel domain automation |
| **Uptime commitment** (a Multi-site bullet) | Removed from `adds` 2026-09-20 | Not a code task — an operational commitment |
| **Annual billing** — advertised on every tier | **Code shipped 2026-09-20; waiting on Stripe prices.** See below | Two env vars, once the prices exist |

### Annual billing — the mechanism now exists, the prices do not

**Fixed 2026-09-20**, after the finding below. `create-checkout` takes an
`interval`, `prices.ts` maps (tier, interval) to a price ID, and the billing
page offers a Monthly/Yearly toggle.

It **ships dark**. The annual Stripe prices do not exist yet, so
`STRIPE_PRICE_PRO_ANNUAL` and `STRIPE_PRICE_ENTERPRISE_ANNUAL` are deliberately
*optional* env vars — making them required would have taken every deployment
down at the next boot to enable something nobody can buy. With them unset the
toggle is not rendered, checkout refuses `interval: "year"` with an explanatory
400 rather than a 500, and the page is byte-identical to before. Setting both
turns it on with no code change; setting only one leaves it off on purpose.

Three things worth keeping from building it:

- **The reverse lookup had to stop throwing.** `getPlanTierFromPriceId()` used
  to call `getStripePriceId()` for every known tier, which is safe only while
  every price is a *required* env var. With an optional one present, that
  `requireEnv` throws while identifying a perfectly valid **monthly**
  subscription — the webhook 500s, Stripe retries forever, no entitlement is
  ever written. Strictly worse than the bug being fixed. It now scans
  configured prices only. Demonstrated, not reasoned about: restoring the old
  implementation crashes the harness with
  `Missing required environment variable STRIPE_PRICE_PRO_ANNUAL` thrown from
  `getPlanTierFromPriceId`.
- **The "Current plan" card was quietly wrong.** It printed
  `${priceMonthly}/month`, true only while monthly was the only purchasable
  thing. `subscriptions` has no interval column — migration 004 stores period
  *dates*, not a cadence — so once annual exists the app cannot know which an
  org pays. The price was removed from that line rather than guessed; Stripe's
  portal is authoritative and the tier's list price is on its card below. A
  future interval column would let it be stated again.
- **The public pricing page correctly gets no toggle.** Its CTA is "Start free
  trial" → `/signup`, not checkout, so there is no interval for it to carry.
  The choice belongs on the billing page, where the purchase actually happens.

**Still true until the prices exist:** both pricing surfaces advertise a yearly
figure and the FAQ promises two months free. That copy remains unhonourable
until an owner creates the prices and sets the two variables.

### The finding that prompted it

Found 2026-09-20 while listing the Stripe prices, *after* the `adds` cleanup —
because it lives in the price block rather than the feature list, and the
cleanup was a sweep of `PLANS[*].adds`. Same class of problem as the four lines
removed that day: published copy the product cannot honour.

`priceAnnual` is populated for all three self-serve tiers, so both pricing
surfaces render "or $890/year", "or $2,490/year", "or $5,490/year", and the FAQ
promises two months free. But:

- `create-checkout/route.ts` accepts `tier: z.enum(["pro","enterprise"])` and
  **no interval parameter at all**, then passes one price ID to `line_items`.
- `prices.ts` knows only `STRIPE_PRICE_PRO_MONTHLY` and
  `STRIPE_PRICE_ENTERPRISE_MONTHLY`.

So there is no code path that can charge an annual price on any tier.

**It is not just an env var.** Annual needs a second price ID per tier, an
interval selector in the UI, the parameter threaded through the route, and
`getPlanTierFromPriceId()` widened to reverse-map six IDs instead of two. That
last one is the careful part: `SECURITY.md` finding M3 is precisely about that
lookup, and a price ID it fails to recognise must never fall back to `free`.

Deferred with the rest of the billing work — there are no subscriptions, so
nothing can be billed annually or monthly today. Recorded here so it is not
rediscovered by a customer clicking a yearly price.

### The full Stripe price list

Seven, not the six that "three tiers, two intervals" suggests — Enterprise is
quoted and invoiced, so it has no Stripe price, and the seventh is the
per-facility add-on.

| # | Price | Amount | Source |
|---|---|---|---|
| 1 | Starter — monthly | $89 | `PLANS.starter.priceMonthly` |
| 2 | Starter — yearly | $890 | `PLANS.starter.priceAnnual` |
| 3 | Standard — monthly | $249 | `PLANS.standard.priceMonthly` |
| 4 | Standard — yearly | $2,490 | `PLANS.standard.priceAnnual` |
| 5 | Multi-site — monthly | $549 | `PLANS.multisite.priceMonthly` |
| 6 | Multi-site — yearly | $5,490 | `PLANS.multisite.priceAnnual` |
| 7 | Extra facility — monthly | $45 | `EXTRA_FACILITY_MONTHLY` |

**Two exist, both test mode**, and neither is named for the tier it now sells:
`STRIPE_PRICE_PRO_MONTHLY` serves Standard and
`STRIPE_PRICE_ENTERPRISE_MONTHLY` serves Multi-site, through
`STORED_TIER_TO_PLAN`. Starter and Enterprise have no price at all, which is why
both render a contact link instead of a checkout button.

---

## 6. What has to be true before any of this is enforceable

In dependency order. None of it is started.

1. **Widen `subscriptions.plan_tier`.** Migration 004's
   `CHECK (plan_tier IN ('free','pro','enterprise'))` cannot hold `starter`,
   `standard` or `multisite`. Migration + backfill, then retire the bridge in
   `plans.ts`.
2. **Delete the duplicate `PlanTier`** in `src/types/app.types.ts:20`. Same name,
   different members, no compiler help when the wrong one is imported.
3. **Create the remaining Stripe prices.** 7 needed, 2 exist, both test mode.
   Owner action. Starter and Enterprise currently render a contact link.
4. **Build the entitlement module** — one function answering "may this org do X",
   reading the stored tier.
5. **Enforce in both layers.** App-layer checks alongside RLS policies, the same
   way migration 055 pairs with `roles.ts`. The publishable key is in the browser
   bundle; an app-layer-only gate can be skipped by calling PostgREST directly.
   Migration 024 exists because that already happened once.
6. **The `free`/expired behaviour — decided 2026-09-20.**

   > **Public surfaces stay up; the dashboard goes read-only.**
   >
   > Facility pages, embeds and the directory listing keep serving. A dark
   > schedule punishes residents rather than the customer, breaks every embed on
   > the customer's own website and every link a patron has saved, and makes
   > re-subscribing *less* likely rather than more. Staff lose write access
   > across the board.
   >
   > **Most of the mechanism already exists.** This is very close to what the
   > `aux` role already means — read everything, write nothing — so the
   > enforcement shape is one the app has already built and tested in both
   > layers. It is not a new concept, it is an existing one applied for a
   > different reason.
   >
   > Two things this decision does *not* settle, deliberately: whether there is
   > a grace period before read-only bites (rejected for now only because the
   > product has no way to warn anyone — no notification system, SMTP
   > unconfigured), and how a lapsed org is told. Both become answerable once
   > §5.4's notification gap closes.

Step 6 deserves the emphasis it got during the decision round: **every decision
in §4 is worth less than this one.** A perfectly tiered product that never
downgrades an expired org has no pricing at all — and it is also the one gate a
customer trips silently and accidentally, which is the test for what must be
enforced in code rather than by a monthly look at the database.

---

## 7. What was done, and what was deliberately not

An earlier version of this section listed a seven-step plan. Verifying it before
starting found four errors in it, three of them pessimistic and one a real hole.
Corrected below, with the work that actually shipped marked.

### Done 2026-09-20

- [x] **Removed the false lines from `PLANS[*].adds`.** Four, not three:
      `multisite` lost "One embed spanning every facility" (§4.8) and "Uptime
      commitment" (no monitoring, status page or SLA); `enterprise` lost "Custom
      domain" (does not exist). Each removal carries an inline comment saying
      why, so it is not helpfully restored later.
- [x] **Brought the tier copy in line with §3.** Starter lost "CSV import"
      (§4.1) and gained "Printable schedules", which it already has. Standard
      gained CSV import, "Manager and coordinator accounts" (§4.5) and the
      conflict manager (§4.2). Multi-site now reads as the volume tier it is.
- [x] **Deleted the duplicate `PlanTier`** from `src/types/app.types.ts`,
      replaced by a comment explaining where the name lives and why there are
      two vocabularies. It had **zero importers** — every `PlanTier` in the app
      already resolved to `@/lib/stripe/plans`.
- [x] `tsc --noEmit` and `eslint` clean on both files.

No migration, no new mechanism, no behaviour change. `plan.adds` renders through
a `.map()` on both the marketing page and the billing page, so one edit to
`plans.ts` fixed both surfaces.

### Deliberately not done

**The lapsed-org gate, the `plan_tier` migration, and the entitlement module are
all deferred** — not sequenced, deferred. The reason is the same for all three:
**there are no subscriptions, so nothing can lapse and nothing can exceed a
quota.** Building against tiers no customer has pushed on yet is the same
mistake twice over.

Four corrections from the verification pass, kept because they change the shape
of that work whenever it happens:

1. **The lapsed gate was never blocked on the `plan_tier` migration.** It reads
   `subscriptions.status` — a separate column, `NOT NULL DEFAULT 'active'`, with
   **no CHECK constraint**. The dependency in the old plan was invented.
2. **"Modelled on `aux`" was misleading.** There is no single switch; see the
   two measurements in §2. It is route-enumeration work.
3. **It is app-layer work, not both-layer work.** See §2's corrected rule — the
   adversary is a non-paying customer editing their own data, not a hostile
   insider with the publishable key.
4. **Two estimates were too high.** `pg_cron` is already enabled and scheduling
   jobs (migration 053 runs `sweep-rate-limits` hourly), so the analytics prune
   is a job definition — about an hour. And `analyticsHistoryDays` really is one
   parameter: `getAnalyticsSummary(supabase, orgId, days = 30)`.

`getOrgContext()` already returns `subscription` on every dashboard page, so
whenever the gate is built, the data is in hand.

### Owner actions, unchanged from `PRICING.md`

Create the 7 Stripe prices in live mode (2 exist, both test), and configure
custom SMTP + Resend. The second blocks Standard's role story (§4.5) and the
whole of §5.4 — and it is still launch blocker 1.

---

## Related

| Doc | What for |
|---|---|
| [`PRICING.md`](PRICING.md) | The billed unit, the price points, the market research. Settled |
| [`RESUME.md`](RESUME.md) | Current state and launch blockers |
| [`PLAN-staff-roles.md`](PLAN-staff-roles.md) | The role model this must not fight |
| [`PLAN-internal-view.md`](PLAN-internal-view.md) | Holder names, setup notes, deck sheet |
| [`LEARNING-crystal-pool.md`](LEARNING-crystal-pool.md) | Second aquatics prospect; the vocabulary argument behind §4.6 |
| `supabase/migrations/049_remove_facility_configurations.sql` | Read before re-opening §5.3 |
