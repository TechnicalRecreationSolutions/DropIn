# Options: The Internal (Staff-Only) View

Companion to `docs/DISCOVERY-internal-view.md` (the customer conversation) and
`docs/prompts/internal-view-options.md` (the brief). **Nothing here is
authorized.** This is a decision document.

Every claim about schema, policy or code below was read this session, not
recalled. File and migration references are exact.

---

## Part 1 — Seven findings that constrain every option

These came out of reading the code, and several contradict the assumptions in
the brief. Read them before the options; three of them eliminate otherwise
attractive designs.

### 1. The conflict engine hard-blocks the exact thing we're building ⚠️

`POST /api/sessions` calls `findSessionConflict()` and returns **409** when the
candidate shares any space with an overlapping active session
(`src/app/api/sessions/route.ts:96`, `src/lib/sessions/conflicts.ts:59`). It is
a write-time gate, not a warning.

The internal view exists to record that Island Swimming holds Lanes 1–3 *during*
the drop-in Lengths block that also claims those lanes. **That is a 409 today.**

This is the single most important finding. It means "internal sessions" is not
additive — it forces a decision about what a space claim *means*. Any option
that puts internal bookings on the same `spaces` rows as public sessions is
blocked until this is resolved.

### 2. `sessions.is_active` is already a per-session public gate — and it's the soft-delete

The brief says there is no per-session visibility. That is *almost* right.
`sessions_public_read_active` gates on `is_active = TRUE AND EXISTS(sg
published)`, and org members bypass it via `org_id = ANY(user_org_ids())`. So
`is_active = false` already means "staff see it, public doesn't."

**Do not reuse it.** `DELETE /api/sessions` sets `is_active: false`
(`src/app/api/sessions/route.ts:157`) — it is the soft-delete. And every staff
read path filters `.eq("is_active", true)`: the dashboard, the command centre,
`conflicts.ts`, `publishOverlap.ts`, the expand API. An internal session marked
this way would be invisible to staff *and* indistinguishable from a deleted one.
The gate exists; the slot is taken.

### 3. One endpoint serves both the public and staff, separated by RLS alone

`/api/sessions/expand` is, in its own words, used by "the weekly
grid/list/map, the floorplan, the public widget, and the command centre." It
does `.select("*")` with no explicit `status = 'published'` filter — **RLS is
the only thing separating patron from staff output** (`route.ts:147-171`).

That is one choke point, which is good for auditing and bad for blast radius.
It is also the only place a leak can happen, which makes the leak test tractable
for every option below.

### 4. A "staff see more than the public" precedent already exists

`filterUnapprovedPublicWeeks()` (`expand/route.ts:261`) resolves the caller's
org memberships and hides unapproved weeks **only from callers outside the org**.
Its header explains why it's app-layer rather than RLS: a session is a recurring
template, so per-occurrence gating can't be a row policy.

Internal-session filtering is the same shape and can follow the same pattern —
and note it reads `user.app_metadata`, never `user_metadata`, because the latter
is user-writable (migration 022). Any new filter must copy that discipline.

### 5. Sessions have no name of their own

`programs` was collapsed into `schedule_groups` in migration 011 and
`sessions.program_id` was dropped. A session row is `schedule_group_id + rrule +
times + template_id` — there is **no title column**. Display names come from
`schedule_groups.name` or `session_templates.name`.

This matters more than it sounds. The lifeguard sheet needs "Island Swimming" in
the cell. `session_templates` carries `name`, `color`, `department_id`, and
`session_template_spaces` pre-fills default lanes (migration 020) — so a
template per renter is the natural carrier, and **Commonwealth already has 12
templates and 6 spaces sitting in the database** (`docs/RESUME.md`).

Good news for options 1–3: a one-off rental *can* be a session with no schema
strain.

### 6. There is zero print capability in the codebase

No `@media print`, no `window.print`, no print route — verified by search. The
brochure print path went out with the events/brochure teardown (migration 036).

The artifact we are replacing is **printed and posted on deck**. If print is a
requirement, it is net-new work in every option, and it is the kind of work that
looks trivial and isn't.

### 7. Commonwealth is already in the database, and empty

6 spaces, 12 session templates, a *published* "Lengths Swimming" group with zero
sessions. `scripts/seed-saanich-pool.mjs` has the real PDF transcribed but
collides with the existing facility.

Whichever option wins, the demo needs a sessions-only seed first. That is
prerequisite work, not part of any option.

---

## Part 2 — The options at a glance

| # | Option | Bet | Effort | Kills the Excel sheet? | Ships in simplify-for-launch? | Public stays availability-only? | Generalises? |
|---|---|---|---|---|---|---|---|
| 1 | **Staff Notes** | They need context, not a schedule | 2–3d | ❌ No | ✅ Easily | ✅ Yes | ✅ Yes |
| 2 | **Internal Schedule Group** | Internal is a *folder* | 4–6d | ⚠️ Partly | ✅ Yes | ✅ Yes | ✅ Yes |
| 3 | **The Deck Sheet** | It's a *view* problem | +6–9d | ✅ Yes | ⚠️ Tight | ✅ Yes | ✅ Yes |
| 4 | **Occupancy Layer** | A booking isn't a session | 12–18d | ✅ Yes | ❌ No | ✅ By construction | ✅ Yes |
| 5 | **Claim Types** | Availability should be *computed* | 15–25d | ✅ Yes | ❌ No | ✅ Yes, and better | ✅ Strongly |
| 6 | **Two-Layer Schedule** | One source, two outputs | 30d+ | ✅ Yes | ❌ No | ✅ Yes | ✅ Strongly |

Options 2 and 3 are designed to compose: 2 is the mechanism, 3 is the view. 5
subsumes the fix that 2 and 3 both need for finding #1.

---

## Part 3 — Option detail

### Option 1 — Staff Notes

**Thesis:** he asked for a cheat sheet, not a second scheduling system. Attach
internal free text to what already exists and see whether that closes the gap.

**Schema (migration 046):** `session_features` already exists (028) and is
org-scoped. Add `internal_note TEXT` to `sessions`, plus a small
`facility_day_notes` table (`facility_id`, `date`, `note`, `org_id`) for the
"Camps In Pool 12-1pm" class of annotation the PDF already carries.

**RLS blast radius:** minimal but *not* zero. `sessions.internal_note` is a
column on a publicly-readable row — RLS is row-level, so **the column ships to
the public the moment it's added**, because `expand` does `select("*")`. The
note must either live on a separate table with no public-read policy (safe) or
be stripped in the API response (fragile). Prefer the table.

**UI:** a note field in `SessionModal`, a notes strip in the existing views. No
new route.

**Reuses:** everything. Builds: two small forms.

**Failure mode:** it doesn't model occupancy, so nothing computes and the Excel
sheet survives. He'd be typing lane assignments into a free-text box — which is
worse than Excel, because Excel at least has columns.

**Leak test:** `select("*")` on `sessions` is the hazard. A note on a separate
table with no public policy cannot leak; a column on `sessions` leaks by default.

**Verdict:** the honest floor. Cheap enough to be worth shipping as a probe even
if a larger option is chosen — but on its own it does not answer the ask.

---

### Option 2 — Internal Schedule Group

**Thesis:** visibility is a property of the *folder*, not the booking. Staff
create a schedule group called "Lane Bookings", mark it internal, and every
existing authoring tool works unchanged.

**Schema (migration 046):**
```
ALTER TABLE schedule_groups
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public','internal'));
```
Deliberately **orthogonal to `status`**. `status` answers "is it finished?";
`visibility` answers "who is it for?" An internal group can still be
draft→published, which preserves the review workflow staff already know and
avoids the `draft`-overloading trap the brief warns about.

**RLS blast radius — five policies, all in migration 033:**
- `schedule_groups_public_read_published` → add `AND visibility = 'public'`
- `sessions_public_read_active` → add `AND sg.visibility = 'public'` inside the EXISTS
- `exceptions_public_read` → same, inside its `sessions`→`schedule_groups` join
- `session_spaces_public_read` → same
- `session_features_public_read` → same

All four dependents already join to `schedule_groups`, so the added predicate
costs nothing structurally. `idx_schedule_groups_facility_status_dates` should
gain `visibility`.

Wrong implementation = an anon caller enumerates every rental, club and closure
at the facility, including renter names via `session_templates`. That is a
privacy incident with a named third party in it, not just a bug.

**The finding #1 problem:** unsolved. An internal rental on Lane 1 overlapping
the public Lengths block on Lane 1 still 409s. Minimum viable fix: skip
`findSessionConflict` when the candidate's group is internal *and* surface the
overlap as a non-blocking warning instead. That is a deliberate weakening, and
it means `/dashboard/conflicts` (`findOrgConflicts`, which filters only on
`is_active`) will fill with public-vs-internal noise unless it learns to
classify them separately.

**UI:** a visibility toggle on the schedule-group form; an "Internal" badge; the
command centre gains a public/internal/both filter. The public widget's scope
picker (`widget_config_scopes`) must refuse to select internal groups — its
`schedule_group_id` FK has no visibility awareness today.

**Reuses:** every authoring surface, templates (finding #5), conflict detection,
activity log, week reviews. Builds: a toggle, a filter, five policy edits.

**Effort:** 4–6 days including the conflict carve-out.

**Failure mode:** the conflict carve-out is where this goes wrong. Skipping the
check for internal groups silently removes double-booking protection from
exactly the data that most needs it — two rentals on the same lane is the error
a lifeguard sheet exists to catch.

**Leak test:** widget scope picker, `expand`'s `select("*")`, and the public
facility page. Defence should be both RLS *and* an app-layer filter in `expand`
modelled on `filterUnapprovedPublicWeeks` — belt and braces, because RLS is
currently the only thing standing there.

---

### Option 3 — The Deck Sheet

**Thesis:** the data model barely matters; the missing thing is the *view*. Time
rows × **space columns**, one day, printable. Pair with Option 2 for visibility.

**Schema:** none of its own. Depends on Option 2.

**RLS:** none of its own.

**UI:** a sixth view mode alongside `grid|list|map|board|floorplan`
(`ScheduleView.tsx:38-49`). Note `board` is time-rows × **day**-columns — the
PDF replica — so this orientation genuinely doesn't exist. Columns come from
`spaces` ordered by `display_order`; cells from `session_spaces`. Must print
(finding #6): net-new `@media print` work, fixed-width columns, no lazy loading,
a real page-break strategy.

**Reuses:** `WeeklyScheduleBoard.tsx` already derives time bands from the
sessions themselves rather than fixed slots — that band logic ports directly.
`spaces.display_order`, `session_spaces`, `sessionCardColor.ts`, templates'
colours. Builds: the grid, the day navigator, the print stylesheet.

**Effort:** 6–9 days on top of Option 2.

**Failure mode:** print. It is always underestimated, and a sheet that renders
beautifully and prints across three pages with a lane column orphaned on page 2
fails the only test that matters — it has to survive being posted on a wall.

**Leak test:** inherits Option 2's. One addition: this view must never be
reachable on a public route. `src/app/(public)/facility/` and
`src/app/widget/[orgId]` must not be able to select it, even by query param.

**Verdict:** this is the option that actually kills the Excel sheet. 2 without 3
gives them a correct internal schedule they still can't read on deck.

---

### Option 4 — Occupancy Layer

**Thesis:** a swim-club rental is not a session. Sessions carry `cost_cents`,
`age_group`, `skill_level`, `activity_type` — patron-facing offering
attributes a lane rental has none of. Model occupancy as its own thing.

**Schema (migration 046):** `space_allocations` — `org_id`, `facility_id`,
`space_id`, `holder_name`, `rrule`, `dtstart`, `dtend_time`, `valid_from`,
`valid_until`, `kind` (`rental|club|program|lesson|closure|maintenance`), `note`.
**No public-read policy at all** — org-scoped CRUD only.

**RLS blast radius: zero on existing policies.** This is its defining advantage.
The five policies in 033 are untouched.

**UI:** a new authoring surface and the Option 3 grid rendering two overlaid
sources.

**Reuses:** `expandOccurrenceTimes()` (`lib/rrule/expand.ts`) works on any
recurrence-shaped row, so recurrence is genuinely free. Builds: a second editor,
a second exceptions story, a second conflict path.

**Effort:** 12–18 days.

**Failure mode:** two entities that are 90% the same. Every future feature —
exceptions, templates, drag-reschedule, activity logging, week review — must be
built twice or explicitly declined for one side. `session_exceptions`,
`session_templates` and `session_conflict_dismissals` all key on `session_id`.
And it loses the conflict engine outright: detecting a rental-vs-rental
double-booking means reimplementing `findSessionConflict` cross-entity, which is
the most valuable thing on the sheet.

**Leak test:** strongest of any option — **a table with no public-read policy
cannot leak.** Nothing in `expand` would ever see it.

**Verdict:** the cleanest security story and the worst maintenance story. Choose
it only if the answer to open question #2 is "internal bookings are genuinely
different objects" — and I don't currently believe they are, because the drop-in
blocks in the PDF and the club bookings in the Excel sheet occupy the same lanes
in the same way.

---

### Option 5 — Claim Types (the derivation)

**Thesis:** the 409 in finding #1 isn't a bug to route around, it's the schema
telling us something. `session_spaces` treats every claim as exclusive, but the
public Lengths block doesn't exclusively claim Lanes 1–4 — it claims *whatever
is left*. Model that, and availability becomes computable.

**Schema (migration 046):**
```
ALTER TABLE session_spaces
  ADD COLUMN claim_type TEXT NOT NULL DEFAULT 'exclusive'
  CHECK (claim_type IN ('exclusive','residual','shared'));
```
plus `spaces.capacity` (already exists, 012) as the divisor. Combine with
Option 2's `visibility`.

- `exclusive` — a rental or club holds this lane. Blocks.
- `residual` — a drop-in block occupying whatever isn't exclusively claimed.
- `shared` — two activities coexisting.

**This fixes the conflict engine properly** rather than carving a hole in it:
`findSessionConflict` conflicts on exclusive-vs-exclusive, never on
exclusive-vs-residual. Option 2's weakening becomes unnecessary.

And then the prize: available lanes = capacity − exclusive claims, per time
band. Dropin **computes** red/blue/black instead of asking a human to count.
The PDF's colour legend becomes a derived property. That is the thing nobody
else can do, and it is the step where errors currently enter.

**RLS blast radius:** Option 2's five policies. `claim_type` itself is a column
on `session_spaces`, which *is* publicly readable — but exposing claim type to
the public is harmless and arguably correct; what must stay hidden is the
internal session on the other end of the claim.

**UI:** a claim-type control in the space picker; computed availability rendered
on public views; Option 3's grid showing exclusive claims solid and residual
hatched — which is exactly how the Excel sheet reads.

**Reuses:** `session_spaces`, `spaces.capacity`, conflict engine, the band logic
in `WeeklyScheduleBoard`. Builds: the availability calculator and its tests.

**Effort:** 15–25 days.

**Failure mode:** the calculator is subtly wrong in a way nobody notices until a
patron shows up to a full pool. "3 lanes available" published automatically is a
promise; today a human makes that promise and can sanity-check it. This needs a
verification harness (`scripts/verify/`) with real Commonwealth data before it
goes anywhere near a public surface — and probably a staff confirmation step
before computed availability publishes.

**Leak test:** Option 2's, plus one specific to this option: the computed
availability number is *derived from internal data*. Publishing "1 lane
available" at 6am Tuesday tells an observer something about who booked the other
lanes. That is almost certainly acceptable — it is exactly what the PDF already
publishes — but it should be a stated decision, not an accident.

---

### Option 6 — Two-Layer Schedule *(later bet, not now)*

**Thesis:** the internal sheet becomes the source of truth and the public
schedule is *generated* from it. One input, two outputs — the Excel sheet and
the PDF both die.

Option 5 plus: closures and maintenance as first-class records, a generation
step producing public availability blocks from internal occupancy, staff
approval of the generated result (reusing `schedule_week_reviews`, 037), and
publish → widget + print in one action.

**Effort:** 30d+. **Failure mode:** it is a rewrite of the authoring model
wearing a feature's clothes, during a simplify-for-launch phase.

**Verdict:** this is the product in 18 months if the bet is right. Write it down;
don't build it. Options 2+3+5 are the staged path here, and each stands alone.

---

## Part 4 — Recommendation

**Ship Option 2 + Option 3. Design the schema so Option 5 is reachable. Do not
build Option 4.**

Reasoning:

1. **Option 3 is the deliverable.** He described a *printed lane grid*. Option 2
   without 3 is a correct internal schedule he still can't use on deck — we'd
   have solved our modelling problem and not his workload problem. The criterion
   that matters is "does it kill the Excel sheet," and only 3 does.
2. **Option 2 is the right mechanism** because it costs five predicate edits on
   policies that already join to `schedule_groups`, and it reuses every
   authoring surface via templates (finding #5). Commonwealth's 12 existing
   templates become renter labels almost for free.
3. **Reject Option 4** on maintenance grounds. Its security story is genuinely
   better, but `session_exceptions`, `session_templates` and
   `session_conflict_dismissals` all key on `session_id`, so it forks the
   product permanently to avoid a predicate we have to write anyway.
4. **Take the smallest honest slice of Option 5 immediately.** Do *not* ship
   Option 2's conflict carve-out. Add `claim_type` in the same migration and let
   the conflict engine reason about it. It is perhaps two extra days over the
   carve-out, it keeps double-booking protection intact where it matters, and it
   is the difference between a fix and a hole. Defer only the availability
   *calculator* and anything that publishes computed numbers.
5. **Print is a first-class requirement**, not a stretch goal (finding #6). Zero
   print infrastructure exists. Budget it explicitly or the sheet doesn't get
   used.

**Sequence:** seed Commonwealth's real schedule (prerequisite, finding #7) →
migration 046 (`visibility` + `claim_type`, five policies) → internal groups in
the command centre → the deck sheet view → print → verification harness →
demo it back to him before building the calculator.

**What would change my mind:** if his Excel sheet contains things that aren't
time-blocks-on-spaces — staffing assignments, equipment, chemical readings,
incident notes. Options 2/3/5 all assume the sheet is occupancy. If it's a
general operations log, the right answer is closer to Option 4 with a much wider
`kind` vocabulary, and I'd want to see a photo of the actual sheet before
committing. **Ask him for one.**

---

## Part 5 — Questions to send him

Short enough to answer in a reply. These block real decisions:

> 1. **Could you send a photo or copy of the Excel sheet?** Even a redacted one.
>    I want to build against the real thing rather than my sketch of it.
> 2. **Is it one page per day, or one page per week?** And is it printed and
>    posted, or read on a screen at the desk?
> 3. **When the drop-in schedule says "3 lanes available" — who works that
>    number out, and how long does it take?** If Dropin could calculate it from
>    the bookings you've already entered, would you trust it, or would you want
>    to confirm it before it goes public?

Question 1 unblocks the choice between 2/3/5 and 4 (it's the mind-changer
above). Question 2 decides the primary view orientation in Option 3 and whether
print is mandatory. Question 3 decides whether Option 5 is a product or an
unwanted liability — and his answer to the second half tells us whether computed
availability needs a staff approval gate.

Deliberately **not** asked yet: who may see internal sessions (open question #4).
Every option currently assumes all org members, which matches `member` = "read +
schedule editing". Revisit only if he raises it.

---

## Part 6 — What to ask two other centres

The large options are only worth their cost if this workflow is the norm. Three
questions, answerable in a ten-minute call:

1. **"How does your team know which lanes/courts/rinks are free right now?"**
   Open-ended on purpose. If they describe a hand-built sheet without being
   prompted, that's the signal.
2. **"Where do rentals and club bookings live, and is that the same place as
   your public schedule?"** Tests whether the occupancy/availability split is
   universal or a Commonwealth habit.
3. **"Who produces your public schedule, and what do they work from?"** Tests
   the derivation specifically — the thing Option 5 automates.

If two of two describe the same three-artifact pattern, Options 5 and 6 move
from speculative to roadmap, and the pitch changes from "publish your schedule"
to "run your facility." If they don't, ship 2+3 for Commonwealth as a solid
feature and stop there.
