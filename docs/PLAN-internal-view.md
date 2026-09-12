# Plan: The Internal View, Occupancy Kinds, and Derived Availability

Supersedes the recommendation in `docs/OPTIONS-internal-view.md` (which proposed
Option 2 + 3 — visibility on the *schedule group* plus a deck sheet). The
customer conversation on 2026-09-11 moved the design: visibility belongs on the
**session**, the public schedule should be **derived** rather than retyped, and
the pool's physical configuration is **declared by staff**, not computed.

Background: `docs/DISCOVERY-internal-view.md` (the customer conversation).

Every schema and policy claim below was read from the migrations this session.
Two claims in the OPTIONS doc are stale and corrected here — see section 6.

---

## 1. The model

Two orthogonal axes. Conflating them was the mistake in every earlier sketch.

### Axis 1 — `sessions.occupancy_kind`: what this booking does to the space

| Kind | Space math | Default disclosure |
|---|---|---|
| `drop_in` | **residual** — takes whatever is not exclusively claimed | public name |
| `program` | **exclusive** | public name — patrons want to know lessons are on |
| `rental` | **exclusive** | **redacted** — "Reserved" publicly |
| `closure` | **exclusive** | public name — "closed for maintenance" is worth publishing |

Residual/exclusive is **derived from the kind**, not stored as a second column.
`drop_in` is residual; everything else is exclusive. A per-session override
("Family Swim gets exactly lanes 5–6 and no more") is a plausible future case but
is not built speculatively — widen this when a customer produces one.

Naming note: `schedule_groups.activity_type` already exists with
`drop_in | registered | open_gym` (migration 011). That is a **patron**
descriptor — "can I just show up?" — it lives on the group, and it has no rental
value. `occupancy_kind` is a *space* descriptor and lives on the session. The two
must not be merged, and the column comment must say so, or a later reader will
assume they are interchangeable.

### Axis 2 — `sessions.disclosure`: who may know the name

| Value | Public sees | Staff see |
|---|---|---|
| `public` | full name, cost, age group — today's behaviour | same |
| `reserved` | the block: time + lanes, labelled "Reserved" | real holder name + setup notes |
| `internal` | nothing at all | everything |

Default is `public`, so nothing about existing authoring changes. Each
`occupancy_kind` supplies a *default* disclosure per the table above; staff
override per booking.

`internal` exists for the cases with no public consequence at all — a tentative
hold, guard training in a room patrons do not use, maintenance not yet announced.
Nearly free once the enum exists.

### Why redaction rather than hiding

The public needs to know the water is gone; it must not learn who has it. If
internal bookings were merely *hidden*, the public drop-in block would still
claim all six lanes — false — and staff would have to shrink the public block by
hand as a second edit. That is the duplicated labour this feature exists to kill.
The customer's own PDF already works by redaction: `RED = Reduced Lanes` is the
swim club, with the club's name removed.

---

## 2. Where the secret lives

The identity must be somewhere the anonymous role **cannot read**, not merely
somewhere the API remembers to strip.

`/api/sessions/expand` is the single endpoint serving patrons, the widget, the
public facility page and the dashboard, separated by RLS alone. It does
`select("*")` plus joins to `schedule_groups (name, …)` and
`session_templates (id, name, color)` (`route.ts:148-160`). Three routes for a
named third party's booking to reach the public, and a fourth every time someone
adds a field.

So: a **`session_internal` sidecar** — `session_id` PK, `holder_name`,
`setup_notes` — with **no public-read policy at all**. Org-scoped CRUD only. The
public label is a constant derived from `disclosure`, never a row value. RLS then
*guarantees* the redaction; there is no code path that can leak it, because the
table is not readable.

`expand` additionally substitutes the public payload for `reserved` rows —
`scheduleGroupName` → the org's reserved label, `templateName` → null,
`templateColor` → neutral, `costCents`/`ageGroup`/`skillLevel` → null (each hints
at the renter). `start`, `end`, `spaceIds`, `spaceNames` are kept: that is the
availability the patron needs. This app-layer substitution is defence in depth,
not the defence — the sidecar is.

Precedent to follow exactly: `filterUnapprovedPublicWeeks()`
(`expand/route.ts:261`) resolves the caller's org memberships app-side and reads
`user.app_metadata`, never `user_metadata`, because the latter is user-writable
(migration 022). Any new filter copies that discipline.

Setup notes are **free text** in v1, one field per booking — it replaces an Excel
cell ("soft lane ropes, wave breakers, polo nets"), not an inventory system.
Structured equipment lists and per-occurrence variation (this Tuesday needs polo
nets, next Tuesday does not — `session_exceptions` territory) are deliberately
deferred until asked for.

---

## 3. Facility configuration (the bulkhead)

Decided with the customer 2026-09-11: **the configuration is declared, not
derived, and transitions are not modelled.** Staff enter a long-course block and a
short-course block as two separate sessions. Nothing needs to react to a bulkhead
moving at a set time.

But the calculator needs a real denominator — "how many lanes exist" — so a
per-session text label is not enough. 8 long-course lanes and 16 short-course
lanes are different lane *sets*.

`facility_configurations`: `id`, `org_id`, `facility_id`, `name`
("Long Course (50m)", "Short Course (25m)"), `display_order`. `spaces` gains
`configuration_id UUID NULL REFERENCES facility_configurations(id)`. **NULL means
"present in every configuration"** — the hot tub, the tennis court, everything at
a facility with no reconfigurable space. Every existing space row stays NULL, so
this migration changes nothing for current customers.

A session's configuration is then *implied* by the spaces it claims, and rendered
as a label on the block and in the day header — which is the "way for the admin to
explain what state the pool is in" that was asked for.

**Deliberately not modelled: physical overlap.** 50m Lane 3 and 25m Lane 5 may be
the same water; nothing in the schema knows that, so the conflict engine will not
catch a collision across configurations. Instead, one cheap rule catches the real
mistake: a facility is in exactly one configuration at a time, so two overlapping
sessions claiming spaces from *different* configurations is an **advisory
warning**, not a hard block. That replaces a geometry model with a predicate.

Do **not** hard-constrain configuration to the day. A pool can be long course in
the morning and short course in the afternoon, and the customer expects to enter
that as two sessions. A per-day default that pre-filters the lane picker is good
UX; a per-day constraint would block a real case.

---

## 4. The calculator

Per facility, per configuration, per day:

1. Cut the day into bands at every point where any exclusive claim starts or ends.
2. Per band: `available = spaces in this configuration − exclusive claims
   overlapping this band`.
3. Bands where `available = 0` do not exist for the residual block. A 6–8am
   drop-in block with a rental holding everything 6–7am therefore publishes as
   **7–8am**. Time displacement and lane reduction are the same arithmetic; there
   is no second mechanism.
4. Merge adjacent bands that publish the **same label**, not the same number. If 1
   lane and 2 lanes both read RED on the org's legend, they merge into one row.
   Without this the public schedule fragments into several rows an hour; the
   customer's PDF already merges this way implicitly.

Label thresholds are per-org configuration, defaulting to Commonwealth's legend:
1–2 = "Reduced Lanes", 3–4 = "3 or 4 Lanes Available", 5+ = "More than 4 Lanes".

### Shadow mode is how this ships

A published availability number is a **promise**; if the calculator is subtly
wrong, a patron arrives to a full pool. So the calculator first runs advisory
only: the dashboard shows both numbers — *"you published 4 lanes available; from
the bookings entered we calculate 3"* — and publishes nothing. The customer's
existing PDF is the test set. It becomes authoritative only after staff have
watched it agree for several weeks, and they will believe it because they watched.

The safety gate already exists and does not need building:
`schedule_week_reviews` (migration 037) is per-week staff approval, and **an
un-approved week of a published schedule is already hidden from the public
schedule and the widget** — filtered app-side in `expand`, because a session is a
recurring template with nothing week-shaped for RLS to gate. Computed availability
therefore cannot reach patrons until a human approves that week.

### The 409

`POST /api/sessions` calls `findSessionConflict()` and returns **409** when the
candidate shares any space with an overlapping active session
(`src/app/api/sessions/route.ts:86-95`, `src/lib/sessions/conflicts.ts`). Today
that hard-blocks the entire feature: a rental on Lanes 1–3 during the drop-in
block that also claims Lanes 1–3 cannot be saved.

`occupancy_kind` fixes this properly rather than carving a hole in it:

- exclusive vs **residual** — not a conflict. Never was. The residual block claims
  what is left, so there is nothing to double-book.
- exclusive vs exclusive — still a hard 409. Two clubs in one lane is precisely the
  error the lifeguard sheet exists to catch, and it must keep blocking.
- different configurations, overlapping — advisory (section 3).

`findOrgConflicts` (`/dashboard/conflicts`) applies the same
`claimsCanCollide()` predicate, so the page does not fill with public-vs-rental
noise. What it does **not** yet do is *label* the pairs it still reports by kind
— that is stage 2's half of this.

**Moved from stage 2 into stage 1 during implementation.** The staging table
originally deferred the conflict fix, which was wrong: without it, stage 1 could
not save the one booking it exists to record — a rental on a lane a drop-in block
already lists — so stage 1 would have shipped 409ing on its own main use case.
The fix is one predicate (`src/lib/sessions/occupancy.ts`) read in three places:
`findSessionConflict`, `findOrgConflicts`, and the PATCH reschedule route, which
has to pass the stored kind through or moving a rental would 409 against the very
block it is allowed to overlap.

---

## 5. Views

**The staff toggle** on `/dashboard/schedule` is not "show internal sessions" — it
is **staff view vs what a patron sees**:

- **Off** — the page renders the public payload exactly. Reserved blocks read
  "Reserved". This is a preview-as-patron mode the product does not have today and
  wants anyway.
- **On** — real holder names, `internal` sessions visible, setup notes shown,
  computed-vs-published availability surfaced.

Nothing about existing scheduling changes when it is off. That is the "don't
disturb how it works now" requirement, discharged.

**The deck sheet** — spaces as columns, time as rows, one day, printable. The
artifact being replaced is printed and posted on deck. `board` is time rows ×
**day** columns (the PDF replica), so this orientation genuinely does not exist;
the time-band derivation in `WeeklyScheduleBoard.tsx` ports directly. Columns come
from `spaces` in `display_order`, filtered to the day's configuration.

There is **zero print capability in the codebase** — no `@media print`, no
`window.print`, no print route (the brochure print path went out with migration
036). Print is net-new work in every stage that needs it, and a sheet that renders
beautifully but breaks across three pages with a lane column orphaned fails the
only test that matters.

---

## 6. Schema summary (migration 046)

```sql
ALTER TABLE sessions
  ADD COLUMN occupancy_kind TEXT NOT NULL DEFAULT 'drop_in'
    CHECK (occupancy_kind IN ('drop_in','program','rental','closure')),
  ADD COLUMN disclosure TEXT NOT NULL DEFAULT 'public'
    CHECK (disclosure IN ('public','reserved','internal'));

CREATE TABLE session_internal (        -- no public-read policy, ever
  session_id  UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  holder_name TEXT,
  setup_notes TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE facility_configurations (...);
ALTER TABLE spaces ADD COLUMN configuration_id UUID NULL
  REFERENCES facility_configurations(id) ON DELETE SET NULL;
```

Defaults are chosen so **every existing row keeps today's behaviour**:
`occupancy_kind = 'drop_in'`, `disclosure = 'public'`, `configuration_id = NULL`.
No backfill decisions, nothing to get wrong retroactively.

### RLS — four policies, not five

`sessions_public_read_active` gains `AND disclosure <> 'internal'`, and the three
dependents that join back to it — `exceptions_public_read`,
`session_spaces_public_read`, `schedule_groups_public_read_published` — are
reviewed against the same predicate (migration 033 owns all four).

**Correction to the OPTIONS doc (1):** it names five policies, including
`session_features_public_read`. `session_features` **was dropped by migration
036** (line 82), along with `sessions.is_event` and `sessions.in_brochure`. There
are four. Its Option 1 ("`session_features` already exists (028)") is stale for
the same reason.

**Correction to the OPTIONS doc (2):** it is right that `sessions.is_active` is
already a per-session public gate — and right that the slot is taken.
`DELETE /api/sessions` sets `is_active: false` (`route.ts:157`) as the soft-delete,
and every staff read path filters `.eq("is_active", true)`. It must not be reused
for visibility.

Wrong implementation of any of this = an anonymous caller enumerates every rental,
club and closure at the facility, with renter names. That is a privacy incident
involving a named third party, not a bug.

---

## 7. Staging

Each stage stands alone and is demoable. Ship, show the customer, then decide.

| # | Stage | Delivers | Est. |
|---|---|---|---|
| 1 | ✅ **Built** — `occupancy_kind` + `disclosure` + `session_internal` + RLS + session-form control + the write-time conflict fix | Staff record who is in which lane; patrons see "Reserved · Lanes 1–3"; public schedule otherwise unchanged | 3–4d |
| 2 | ✅ **Built** — audience toggle; `/dashboard/conflicts` occupancy labels | Preview-as-patron; the conflicts page stays readable now that public-vs-rental pairs exist | 2–3d |
| 2b | ✅ **Built** — occupancy defaults on `session_templates` (migration 047) | A rental placed by dragging a template *is* a rental; the fast path stops silently publishing withheld bookings | 1d |
| 3 | ✅ **Built** — `facility_configurations` + `spaces.configuration_id` (migration 048); configuration label, lane-picker grouping, map-column filter, cross-configuration advisory | "The pool is in 50m state" becomes expressible | 2d |
| 4 | Deck sheet view + print | Kills the Excel sheet — the actual deliverable | 4–6d |
| 5 | Calculator in **shadow mode** | Dashboard shows computed vs published; publishes nothing | 3–4d |
| 6 | Computed availability authoritative, behind week review | The public schedule derives itself | 2–3d |

Stages 1–3 are the model. Stage 4 is the thing the customer described wanting.
Stages 5–6 are the bet only this product can make.

This lands during an explicit **simplify-for-launch** phase. Stages 1–4 are a
coherent stopping point; 5–6 should be a deliberate second decision, not momentum.

---

## 8. Verification

`scripts/verify/verify-v.mjs`, per the harness pattern in
`scripts/verify/README.md`: service-role fixtures, but assertions made **as a
signed-in user and as anon**, always with a positive control, asserting the
mechanism rather than the outcome.

The leak tests are the point of it:

1. anon `GET /api/sessions/expand` over a week containing a `reserved` session →
   the block is present; `holder_name` and `setup_notes` appear nowhere in the
   response body; the label is the generic one.
2. anon direct `select` on `session_internal` → zero rows (RLS, not filtering).
3. anon expand over a week containing an `internal` session → absent entirely.
4. Positive control: an org member gets the holder name on the same fixtures —
   proving the assertions above test the gate and not a broken fixture.
5. `widget_config_scopes` cannot select an internal session's schedule group;
   `/widget/[orgId]` and `(public)/facility/` cannot select the deck-sheet view,
   even by query param.
6. Calculator: assert band arithmetic against the transcribed real PDF in
   `scripts/seed-saanich-pool.mjs` — the customer's own published numbers are the
   fixture.

---

## 9. Prerequisite

Commonwealth exists in the database with 6 spaces, 12 session templates, and a
*published* "Lengths Swimming" schedule group containing **zero sessions**.
`scripts/seed-saanich-pool.mjs` has the real PDF transcribed but collides with the
existing facility. A sessions-only seed is prerequisite work for demoing any stage.

---

## 10. Still open

- The public label wording: "Reserved" / "Private booking" / "Unavailable" /
  "Reduced lanes". One org setting; the customer picks.
- Availability hitting zero: does the drop-in block vanish from the public
  schedule, or publish as "no lanes available"? Different message to someone
  deciding whether to drive over.
- Whether guards get their own logins. Decided for now: **any signed-in org
  member** sees the staff view, matching what `member` already means. There is no
  invite UI in the product at all — `org_memberships` is written only by
  `/api/auth/onboard-org` — so in practice staff share a login until that is
  built. It is its own piece of work.

---

## 11. What stage 1 actually touched

Migration `046_session_occupancy_and_disclosure.sql` (+ rollback), and:

| File | Change |
|---|---|
| `src/lib/sessions/occupancy.ts` | **New.** The whole vocabulary: kinds, disclosure options, `isExclusiveKind`, `claimsCanCollide`, `RESERVED_PUBLIC_LABEL`, `sessionDisplayLabel` |
| `src/lib/sessions/conflicts.ts` | Both scans skip pairs that cannot collide |
| `src/app/api/sessions/route.ts` | Accepts the four new fields; writes/clears `session_internal`; keeps them out of the `sessions` payload |
| `src/app/api/sessions/[sessionId]/route.ts` | Passes the stored kind into the conflict check |
| `src/app/api/sessions/expand/route.ts` | `resolveCallerOrgs()` shared by both passes; `applyDisclosure()` attaches for insiders and redacts for everyone else |
| `src/lib/rrule/expand.ts`, `src/types/schedule.types.ts` | `occupancyKind`, `disclosure`, `holderName`, `setupNotes` on `ExpandedSession` |
| `src/components/schedule-editor/SessionForm.tsx` | The "What is this? / Patrons see / Staff only" section |
| `.../schedule/sessions/[sessionId]/edit/page.tsx` | Loads the sidecar and both columns |
| 12 view + dialog components | `templateName ?? scheduleGroupName` → `sessionDisplayLabel()` |
| `ScheduleCommandCentre.tsx` | Duplicate and "add another time" inherit kind + disclosure |
| `scripts/verify/verify-v.mjs` | **New.** 34 assertions |

Three traps found while building it, all now covered by `verify-v`:

1. **A zod `.default()` on the new fields would have been a leak.** Several
   callers POST partial payloads (the conflict manager's space move, duplicate,
   add-another-time), and `POST /api/sessions` updates with whatever is in the
   payload. A default would put `occupancy_kind: 'drop_in'` and
   `disclosure: 'public'` in *every* request, silently republishing a withheld
   rental on an unrelated edit. The fields are `.optional()` with no default, and
   absence means "leave the stored value alone".
2. **Duplicate and "add another time" had to inherit explicitly.** Both create a
   *new* session from an existing occurrence, so the column defaults would have
   applied — a copy of a rental coming back as a public drop-in. The holder name
   is deliberately *not* copied: the sidecar belongs to the original booking.
3. **`session_spaces` needed the predicate too.** Patching only
   `sessions_public_read_active` leaves an internal session's lane claims
   publicly readable — the row says "some session holds Lane 2 at 6am" for a
   session anon cannot see. Same for `session_exceptions`.

---

## 12. What stage 2 touched

| File | Change |
|---|---|
| `src/app/api/sessions/expand/route.ts` | `audience=public` collapses the caller to an outsider; `applyDisclosure` now also drops internal occurrences app-side |
| `src/hooks/useScheduleRange.ts` | `ScheduleAudience`, threaded into the request **and the query key** |
| `src/components/schedule-command/AudienceToggle.tsx` | **New.** Staff view ↔ Patron view |
| `ScheduleCommandCentre.tsx` | The toggle, its per-browser memory, the explanatory strip, and `null` editing context in Patron view |
| `src/lib/sessions/conflicts.ts` | `findOrgConflicts` skips non-colliding pairs; participants carry kind + disclosure |
| `src/components/conflicts/{types.ts,ConflictManagerView.tsx}` | Kind and "Name withheld"/"Staff only" badges |
| `src/components/schedule/SessionModal.tsx` | Setup notes, which were write-only after stage 1 |
| `scripts/verify/verify-w.mjs` | **New.** 20 assertions |

Two things learned here:

1. **The preview had to be a fetch, not a filter.** Simulating the public payload
   client-side would be a second implementation of the redaction rules, free to
   drift from the one patrons get — worthless exactly when it matters.
   `verify-w` section 4 pins the two together by diffing the preview against a
   genuinely anonymous fetch of the same week.
2. **RLS cannot carry the preview.** The toggle's caller *is* an org member, so
   their internal rows come back through RLS by right; only the app-layer filter
   removes them. Stage 1's comment claiming those rows "never arrive" was true
   until this stage existed, and is now wrong in exactly one case — which is why
   `applyDisclosure` filters as well as redacts.

---

## 13. Stage 2b — the control was in the wrong place

Stages 1–2 put the occupancy controls on the full session form
(`/dashboard/schedule/sessions/new`). That was a literal reading of "the session
form" and it missed how staff actually work: the command centre is where they
live, and `CreateSessionDialog` — the "+" and the drag-from-the-rail path —
didn't ask at all. A rental entered the fast way took the column defaults and
came out a **public drop-in**, to be corrected afterwards on a form nobody was
going to open.

Adding a picker to the dialog would have fixed the symptom. Migration 047 puts
the answer on the template instead: `session_templates.occupancy_kind` +
`disclosure`, seeding each placement. "Island Swimming" is a rental with its name
withheld on every booking it will ever have, so the template is the right place
for that fact to live — and the repetitive case becomes one drag with nothing to
re-pick, and nothing to *forget* to re-pick.

**Defaults, not links.** A session copies the values at placement and never reads
back. The alternative — resolving through to the template at render time — looks
identical in normal use and would retroactively republish a withheld booking the
first time someone tidied a template. `verify-x` §6 is the assertion that rules
it out, and §4 preserves the complementary fact as a test: the API deliberately
does *not* consult the template, which is why the client must send the values.

| File | Change |
|---|---|
| `047_template_occupancy_defaults.sql` (+ rollback) | Two defaulted columns; no backfill |
| `api/session-templates/route.ts`, `[id]/route.ts` | Accept both; PATCH leaves unmentioned fields alone |
| `SessionTemplateForm.tsx` | "Usually a…" + "Patrons usually see" |
| `CreateSessionDialog.tsx` | States what it inherited; holder-name field when withheld; collapsed per-placement override |
| `ScheduleCommandCentre.tsx` | Sends the dialog's values on create |
| `ScheduleEditingContext.tsx` | `EditorTemplate` carries the seeds |
| `dashboard/schedule/page.tsx`, `sessions/page.tsx`, `sessions/[templateId]/edit/page.tsx` | Load them; the templates list shows kind + withheld state |
| `scripts/verify/verify-x.mjs` | **New.** 16 assertions |

---

## 14. Stage 3 — the configuration is a label on a lane, not a container for one

Migration `048_facility_configurations.sql` (+ rollback). `facility_configurations`
is per **facility** (a bulkhead is a property of a building), and `spaces` gains
`configuration_id UUID NULL`. **NULL means "in every configuration"** — the hot
tub, the tennis court, and every space at every facility that never describes
one — so the migration is a no-op for existing customers and stays one.

A session's configuration is **derived from the lanes it claims**, not stored:
there is no `sessions.configuration_id`, because the lanes already say it and a
second copy could disagree with them. `expandSessions` therefore returns
`configurationIds` / `configurationNames` (distinct, and *empty* in the normal
case), read through a second-level PostgREST embed —
`session_spaces → spaces → facility_configurations`.

### The advisory is the whole design decision

Section 3 above promised a predicate instead of a geometry model, and this is it.
50m Lane 3 and 25m Lane 5 may be the same water; nothing in the schema knows
that, so two sessions in different configurations **share no space** and the
conflict engine is structurally blind to them. The options were a hand-maintained
lane-containment map per facility, or one rule: a facility is in exactly one
configuration at a time.

That rule ships as an **advisory and never a 409**, for a reason worth stating
plainly: a 409 would be refusing a booking on the strength of an inference about
the building, and the customer was explicit that a long-course morning and a
short-course afternoon are two sessions rather than an error. So
`findOrgConflicts` runs a second pass — bucketed by facility, gated on
`configurationsDisagree()` **before** any RRULE expansion, which is what keeps it
from being an O(n²) scan: at a facility with no configurations the predicate is
false for every pair and the pass costs one loop and no expansions. A real
double-booking on the same pair outranks the advisory, and
`/dashboard/conflicts` gives advisories their own "Worth a look" section with
"Move space" suppressed — there is no shared space to move out of. The Overview's
"Conflicts" card counts `severity === "conflict"` only; the card says Conflicts,
and nothing in an advisory is double-booked.

| File | Change |
|---|---|
| `048_facility_configurations.sql` (+ rollback) | The table, the column, RLS. Six documented decisions, including why there is no cross-table CHECK and no per-day constraint |
| `src/lib/spaces/configurations.ts` | **New.** `groupSpacesByConfiguration`, `configurationLabel`, `configurationsDisagree`, `EVERY_CONFIGURATION_LABEL` |
| `api/facility-configurations/route.ts`, `[id]/route.ts` | **New.** Owner/admin CRUD — configurations decide which lanes exist, so this is facility setup, not schedule editing |
| `api/spaces/route.ts`, `[id]/route.ts` | Accept `configuration_id`, and verify it belongs to the space's own facility (the boundary the schema leaves open) |
| `api/sessions/expand/route.ts`, `lib/rrule/expand.ts`, `types/schedule.types.ts` | The embed, and `configurationIds`/`configurationNames` on `ExpandedSession` |
| `lib/sessions/conflicts.ts` | `severity` on `OrgConflict`; the advisory pass; `firstOverlapStart()` extracted so both passes share the overlap arithmetic |
| `components/space/ConfigurationsPanel.tsx` | **New.** Add/rename/delete on the Spaces page, quiet when empty |
| `SpacesPanel.tsx`, `SpaceForm.tsx` | Grouped list; a Configuration select that does not render where none exist |
| `SessionForm.tsx`, `CreateSessionDialog.tsx`, `DuplicateSessionDialog.tsx` | Space pills grouped by configuration; the full form warns when one session spans two |
| `WeeklyScheduleMap.tsx` | Staff chips filtering the columns, defaulting to the configuration the day implies, never hiding a session silently; day-header label for patrons too |
| `SessionModal.tsx` | The configuration beside the spaces it qualifies |
| `dashboard/page.tsx` | The stat card counts hard conflicts only |
| `scripts/verify/verify-y.mjs` | **New.** 35 assertions |

Two things learned here:

1. **The public/staff split runs the *opposite* way from stage 1.** The renter's
   name is hidden; the configuration is published. "Long Course (50m)" is the
   answer to "can I swim 50s tonight" — availability, not identity — so
   `facility_configurations` has a public-read policy gated on the facility being
   published, and `verify-y` asserts a *reserved* rental publishes its
   configuration while its holder name stays absent from the whole body.
2. **The map view is already the deck sheet's orientation.** Section 5 above says
   spaces-as-columns "genuinely does not exist"; `WeeklyScheduleMap` is exactly
   that, one day at a time, and stage 4 should extend it (print + all-spaces
   columns) rather than build a second one. The configuration filter added here
   is what makes that viable at all: a tank with 8 long-course and 16
   short-course lanes is otherwise 24 columns wide.
