# Pricing

**Written 2026-09-09.** The framework, the reasoning behind the billed unit, and
the competitive research it rests on. `src/lib/stripe/plans.ts` is the
implementation; this file is why it looks the way it does.

Read [What is not done](#what-is-not-done) before assuming any of this is
enforced. It is not. The tiers below are plan *terms*, published on two pages —
no code stops a customer exceeding them.

---

## The framework in one line

**Charge a base fee per organization, metered by facility. Meter nothing else.**

| Tier | Monthly | Yearly | Facilities | For |
|---|---|---|---|---|
| Starter | $89 | $890 | 1 | One building — a centre, a club, a branch |
| **Standard** | **$249** | **$2,490** | **up to 4** | **A town or small city rec department** |
| Multi-site | $549 | $5,490 | up to 12 | A city running every centre from one place |
| Enterprise | quoted | from $9,900/yr | unlimited | A region, a university, a large operator |

All prices CAD. Yearly is two months free. Extra facilities beyond a tier's
allowance are **$45/month each**. 14-day free trial, card up front.

Unlimited on every tier, deliberately: **departments, schedule groups, spaces,
sessions, session templates, staff accounts, embeds, patron pageviews.**

---

## Why the facility, and not the department or the schedule

This was the open question. Three candidate units, three tests.

A value metric has to (1) track the value the customer receives, (2) resist
being gamed, and (3) grow as the customer grows. Scored against this schema:

| Unit | Tracks value? | Gameable? | Grows? |
|---|---|---|---|
| **Facility** | **Yes** — each is a public page, an embed, an audience | **No** | Slowly |
| Department | Partly | **Yes, trivially** | Well |
| Schedule group | **Weakly** | **Yes, trivially** | Meaninglessly |
| Space | Yes | No | Well — but see below |

**Facility passes the test that matters most.** You cannot merge two buildings.
A customer *could* file three centres' sessions under one facility to dodge the
cap, but then their own public page is wrong — the schedule says the wrong
building, which destroys the thing they are paying for. The metric enforces
itself even before any code does.

**Department fails on gaming, and the schema says so out loud.** Migration
`009_departments_and_schedule_groups.sql` made `department_id` nullable, with the
comment *"an org that never creates a department keeps working exactly as before
this migration."* Anyone metered per department collapses Aquatics, Fitness and
Arena into one called "Programs" in an afternoon. Never meter a number the
customer defines freely and can collapse without losing anything.

**Schedule group fails worse, and capping it would fight the product.**
Splitting Aquatics into Lane Swim, Aqua Fit and Lessons creates no new
value — it is a presentation choice. Worse, `widget_config_scopes` (migration
`043`) exists *specifically* so patrons can filter between schedule groups.
Charging per group would tax the feature the product was built to provide.

**Space scales beautifully and is still wrong.** It is the cleanest correlate of
facility size — the live org has 22 spaces across 3 facilities, so spaces track
size about 7× more finely than facilities do, and [Skedda prices exactly this
way](https://www.g2.com/products/skedda/pricing). But a space is how a floorplan
gets drawn. Metering it means charging extra for drawing your building
properly — taxing the map view, which is the most distinctive thing here. Use it
as an internal sizing signal, never as a meter.

### Facility's one weakness, and the right fix

Facilities grow slowly. A city adds a rec centre once a decade, so per-facility
pricing has weak natural expansion.

The tempting fix is to meter departments, because *that* is the real expansion
vector — an org starts with Aquatics published through Dropin and ends with every
department in it. Resist it anyway: the gaming problem is fatal, and a metric
that can be zeroed out by renaming things is not a metric.

The right fixes are the base fee (which captures the org-level value — the one
`widget_configs` row per org since migration `045`, branding, analytics,
activity log), the capability ladder, and annual uplift at renewal.

A legitimate future refinement: a **large-facility uplift** keyed on *published
departments within a facility*, so Commonwealth Pool (aquatics + fitness + arena)
is not priced identically to a single-gym centre. That is a second-order
adjustment and should wait until real customers show the spread.

### Why nothing is charged per seat

[RecDesk](https://recdesk.com/pricing/), [MyRec](https://www.myrec.com/pricing/)
and [Skedda](https://www.g2.com/products/skedda/pricing) all advertise unlimited
users. They are right, and it matters more here than for most products: the value
only lands when the aquatics coordinator, the arena staff and whoever updates the
website are each editing their own part of the schedule. A seat cap does not
produce upgrades, it produces one shared login — and the `activity_log`
(migration `037`) becomes worthless the moment four people share an account.

The old catalogue capped Pro at 5 staff. That cap is gone.

---

## What the market charges

| Product | Model | Price | Metered by |
|---|---|---|---|
| [RecDesk](https://recdesk.com/pricing/) | Full rec suite | $3,835 → $16,250/yr | Population (<4,000 residents = entry), then transaction volume |
| [MyRec.com](https://www.myrec.com/pricing/) | Full rec suite | from ~$3,445/yr | **Annual org revenue**, via a calculator |
| [Amilia SmartRec](https://www.capterra.com/p/198905/SmartRec/) | Full rec suite | $99 / $499 / $799/mo + $899–$2,999 implementation | Org size |
| [Skedda](https://www.g2.com/products/skedda/pricing) | Space booking | $99 / $149 / $199/mo, +$4.99/space | Bookable spaces, unlimited users |
| Embeddable calendar widgets | Commodity | $10–$50/mo | Feeds |

Two patterns run through the whole municipal segment:

- **Nobody meters seats.** Stated above.
- **Nobody gates features much.** They say "all modules included" and size the
  price by how big the *organization* is. Feature-gating is a B2B-SaaS habit,
  not a municipal-software one — which is why the ladder here is mostly a
  facility allowance, with a deliberately short capability ladder on top.

Dropin is not a full suite. It does not do registration, payments or
memberships, and it is **additive** to whatever system the customer already runs.
That argues for pricing comfortably below the suites — Standard at $2,490/yr is
about 65% of RecDesk's entry tier, for one job done properly.

---

## The two numbers that set the price

### The market is narrow and deep, so the price cannot be cheap

- **>10,000** US [park and recreation agencies](https://www.nrpa.org/our-work/building-a-movement/parks-and-recreation-is-essential/).
- Canada has ~5,400 arenas and ~5,060 aquatic facilities, with
  [municipalities owning 98%](https://www150.statcan.gc.ca/n1/daily-quotidien/181009/dq181009a-eng.htm) —
  consolidating to maybe 1,500–2,500 buying organizations.
- Call it **~13,000 North American organizations, ever.** Plus YMCA branches,
  universities and private clubs.

At the old $49/mo, capturing *the entire market* is **$7.6M/yr**. At a ~$2,500
ACV it is **$39M**. There is no volume to grow into here — this market is priced
in the thousands per year per organization because that is the only thing the
arithmetic supports. That is the single strongest argument against the old price,
and it is why the ladder moved where it did.

### The procurement ceiling is ~$5,000/yr, not $75,000

- **$75,000 CAD** is the BC trade-agreement threshold for goods and services;
  above it a municipality must post the opportunity competitively. Nothing here
  comes close, so **Dropin never triggers an RFP** — a real advantage over a
  suite quoting $16,250.
- The line that actually binds is internal. Most municipal purchasing policies
  let staff buy on a procurement card without a purchase order under roughly
  **$5,000–$10,000/yr** ([Menlo Park](https://www.menlopark.gov/files/sharedassets/public/v/2/city-council/documents/cc-policies/cc-26-024-award-authority-and-bid-requirements.pdf),
  [San Rafael](https://employees.cityofsanrafael.org/purchasing/)).

**So every self-serve tier is kept under $5,490/yr on purpose.** Below that line
the buyer is the recreation manager with a card. Above it the buyer becomes a
procurement process — which is why Enterprise starts at $9,900 and is quoted,
invoiced and sales-led rather than self-serve. The jump from Multi-site to
Enterprise is not just a price step, it is a change of buyer.

### The ROI story, for the sales conversation

Seasonal schedule changes (re-laying out PDFs, updating web pages) run roughly
20 hours × 4 seasons, plus about an hour a week of ad-hoc changes — pool
closures, holiday hours. Call it ~130 hours a year of coordinator and
communications time. At a loaded ~$45/hour that is **~$5,850/year** of labour for
a handful of facilities.

Standard at $2,490/yr offsets under half of that. The pitch does not need the
patron-experience argument at all; it closes on staff time alone.

---

## What the tiers gate, and why those things

The capability ladder is short on purpose (see the market pattern above), and
every rung is a real mechanism in this codebase rather than invented copy.

| Capability | Mechanism | From |
|---|---|---|
| Grid, list, space views | `allowed_templates` default `["grid","list","map"]` | Starter |
| Embed widget, brand colour | `widget_configs` (one row per org, migration `045`) | Starter |
| CSV import | `/dashboard/import` | Starter |
| Floorplan and board views | `ScheduleTemplate`; `LayoutPicker` already locks `floorplan` behind `floorplanAvailable` | Standard |
| Visitor schedule filtering | `widget_config_scopes` (migration `043`) | Standard |
| Activity log, per-week review | `activity_log`, `schedule_week_reviews` (`037`–`039`) | Standard |
| Analytics history | `analytics_events` (migration `041`) — 30d / 365d / 730d / ∞ | all |

Starter getting grid, list and map is not a compromise — it is the existing
`allowed_templates` default, which already encodes the natural entry bundle.
`map` needs no drawing (it is space columns); `floorplan` needs a drawn
`facility_maps` row, which is genuinely a larger-customer feature.

---

## What is not done

Nothing in this file is enforced. Specifically:

- [ ] **No quota is checked anywhere.** `PLANS` is read by exactly two render
      paths — `(public)/page.tsx` and the billing page. No API route reads
      `plan_tier`. `POST /api/facilities` will create a fifth facility on
      Starter without complaint. The live org runs 3 facilities on a
      `free`/`canceled` subscription. **Until a quota module exists, the facility
      allowances on both pricing pages are terms of sale, not limits.**
- [ ] **The database cannot store the new tier names.** Migration `004` has
      `CHECK (plan_tier IN ('free','pro','enterprise'))`. `plans.ts` therefore
      carries a documented bridge — `StoredPlanTier`, `STORED_TIER_TO_PLAN`,
      `PLAN_TO_CHECKOUT_TIER` — mapping the catalogue onto what the column
      accepts. A migration must widen the constraint and backfill before the new
      Stripe prices go live, and the bridge retired with it.
- [ ] **Only two Stripe prices exist.** `STRIPE_PRICE_PRO_MONTHLY` and
      `STRIPE_PRICE_ENTERPRISE_MONTHLY`, both test mode. Standard and Multi-site
      route to checkout through them; **Starter and Enterprise render a contact
      link**, because a button that 400s is worse than an honest mailto.
- [x] **The 14-day trial is wired.** `TRIAL_PERIOD_DAYS` in `plans.ts` is the
      single source for the pricing page, the FAQ and
      `/api/stripe/create-checkout`, which passes `trial_period_days` on
      `subscription_data` — but only when the org has never had a Stripe
      subscription, so cancelling and re-checking-out cannot mint a fresh trial.
      **Not yet verified against a real Checkout session**; it is code, not
      evidence, until someone runs a test-mode checkout and reads the
      subscription back.
- [ ] **`free` is documented as an unpaid state but not enforced as one.** It now
      renders as "No active plan" rather than as a plan. Nothing yet restricts
      what an org in that state can do.

### Owner actions, in dependency order

1. Create 7 Stripe prices: Starter / Standard / Multi-site × monthly + yearly,
   plus a per-facility add-on at $45/mo. Live mode, not test.
2. Write the migration widening `plan_tier` and backfilling existing rows.
3. Add the new price env vars to `src/lib/env.ts`, `.env.example` and Vercel.
   Follow the existing pattern: the server should refuse to boot without them
   rather than quietly mis-price.
4. Run one test-mode checkout and confirm the trial actually lands on the
   subscription — read it back from Stripe and from `subscriptions`, not from a
   200 response. (See `SECURITY.md` finding M3 for why a Stripe 200 proves
   nothing about what was written.)
5. Build the quota module and gate `POST /api/facilities`.
6. Then delete the bridge in `plans.ts` and this checklist.

Steps 1–3 are blocked on you. Steps 4–6 are code and verification.

---

## Things decided, so they are not re-litigated

- **No free tier.** Considered and rejected: Starter's only advantage over a
  free 1-facility tier would be the embed widget, which would make the widget
  the paywall — and the widget is the point of the product. A 14-day card-up-
  front trial does the funnel job without that distortion.
- **No per-seat pricing, ever.** See above. This one is a standing rule.
- **No metering of departments, schedule groups, spaces or sessions.** All four
  either fail the gaming test or tax a feature the product exists to provide.
- **Monthly and yearly, both.** Yearly (two months free) suits the municipal
  budget cycle; monthly keeps private clubs, single gyms and YMCA branches
  reachable. Annual-invoice-only was considered and rejected for killing
  self-serve.
- **Prices in CAD.** Revisit when there are enough US customers to justify a
  second currency, not before.

---

## Related

| Doc | What for |
|---|---|
| [`RESUME.md`](RESUME.md) | Current state, launch blockers |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Stripe webhook and price-ID setup |
| [`SECURITY.md`](SECURITY.md) | Finding M3 — why a price-ID gap must never downgrade a customer |
| `src/lib/stripe/plans.ts` | The catalogue |
| `src/lib/stripe/prices.ts` | Server-only price IDs, and why they are separate |
