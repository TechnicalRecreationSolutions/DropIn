# Learning: How Crystal Pool Runs Its Deck (2026-09-15)

**This is discovery, not authorisation to build.** It records what three real
internal documents from Crystal Pool (Victoria BC) show about how their staff
allocate water, and what that means for the deck sheet and the internal views.
Nothing here is a decision. Section 8 proposes the prompts that would turn parts
of it into decisions.

Source documents, all in `dropin/`:

| File | Size |
|---|---|
| `Pool Layout Map with depths.pdf` | 1 page, scale plan |
| `Lane Set-Up - September 2026.xlsx` | 80 sheets |
| `At-a-Glance 2026.xlsx` | 15 sheets, 4,480–7,341 styled cells each |

Everything below was extracted from the files (unzip + XML parse; fills resolved
through `cellXfs → fillId`, comments through `worksheets/_rels`). Claims carry
cell references so they can be checked. Staff are referred to by role; the
files contain real names.

Companion documents: `docs/DISCOVERY-internal-view.md` (Commonwealth Rec, the
first operator) and `docs/PLAN-internal-view.md` (what was built against it).

---

## 1. The three-layer spine

These are not three documents. They are one system described at three levels,
and almost every interesting problem lives at a seam between two of them.

| Layer | Document | Answers | Kept where | Read by |
|---|---|---|---|---|
| **Vocabulary** | Pool Layout Map | *What are the parts of this pool called, and how deep are they?* | Reference; the only place the naming system is defined | Whoever has to decode the other two |
| **Grammar** | Lane Set-Up book | *Which physical states are legal, and how do I build this one?* | Printed twice — `Cover Sheet` says "Deep End Copy", `Cover Sheet (LGO)` says "Lifeguard Office Copy" | The guard doing the work, at the moment of doing it |
| **Sentences** | At-a-Glance | *Who holds which water, when?* | One sheet per date range, printed | The scheduler, and the guard checking a claim |

The layering is explicit in the files, not inferred. The At-a-Glance legend
(`Sept 14-20!AP70`) includes an entry whose meaning is literally *"go read the
other workbook"*: a coloured swatch labelled **"20m Lane Set-Up Guide"**. One
document's legend cross-references another document by colour.

The vocabulary layer is the one with no owner. The Layout Map defines names that
both other documents depend on, and neither of them restates it.

---

## 2. Concepts

### C1 — One tank, addressed by six overlapping name families

The Layout Map defines, over a single body of water: `CP50M 1-8`, `CP25M 1-8`,
`CP20M 1-6`, `Shallow 20M 1-4`, lettered lesson squares `"A"`–`"H"`, and
`"Deep A"`–`"Deep D"` — plus zone names that cut across all of them
(`Shallow Pool Third`, `Mid Pool Third`, `Deep Third`, `Deep Quarter 1`,
`Deep Quarter 2`, `"Mid Pool Double"`). Depths run 1.07 m to 3.05 m. Fixed
features are named as landmarks: `Lifeguard Station`, `B-Ball Net`,
`Stairs into shallow end`, `Flex Line on bottom of pool`.

The 50 m lanes run the length of the tank; the 20 m and 25 m lanes run across
it. They are **perpendicular** — the same water is simultaneously `CP50M 3`,
square `"B"`, and `Shallow 20M 3`.

*Why it matters:* a "space" at Crystal is not a stable unit. It is one cell of
one of several partitions, and the partitions physically intersect. Name
equality cannot detect a collision here.

### C2 — The At-a-Glance sheet carries two occupancy grids side by side

`A2 = "25M LANES"` heads a grid in columns A–BL: seven days, each a time column
plus eight lane columns. `BN2 = "20M LANES"` heads a **second grid** starting at
column BN: five days (Mon–Fri only), each with columns `1`–`6` plus `S1`–`S4` —
exactly `CP20M 1-6` and `Shallow 20M 1-4` from the Layout Map.

Same week. Same tank. Same clock. Two lane families, both live.

The second grid is really used: `Aug 31-Sept 6!BU13 = "Aqualite"`,
`!BS33 = "Island"`, `!BQ37 = "PCS"`, `!BO45 = "Oak Bay Orcas"`. Several of those
clubs also hold 25 m lanes at overlapping times in the left-hand grid.

It is present on **9 of 15 sheets** (absent from April, May, June, `Aug 1-13`,
`Sept 7-13`, `Sept 14-20`, `Sept 21-27`). Either the 20 m lanes are unused in
those periods, or the grid was dropped and the information went somewhere else.

*Why it matters:* this is the clearest available evidence against "a facility is
in exactly one configuration at a time."

### C3 — The two grids do not share a time axis

The left grid's row 5 is 05:30 and steps 15 minutes per row. The right grid's
row 5 is **09:00**.

| Sheet row | 25 M grid (col A) | 20 M grid (col BN) |
|---|---|---|
| 33 | `0.5208…` = **12:30** | `0.6667` = **16:00** |
| 45 | `0.6458…` = **15:30** | `0.7917` = **19:00** |

A 3½-hour offset between two grids printed on the same physical row of the same
sheet. Read across row 33 and you are reading two different times.

*Why it matters:* it is the sharpest failure in the whole artifact, it is
invisible, and it is exactly the class of error a product removes for free by
having one time axis.

### C4 — Tank configuration is a property of the timeline, encoded as colour

The **time column's fill** is the configuration. The legend is the sheet's last
row (`Sept 14-20!A70`, `Sept 21-27!A71`), and the swatch sits to the **left** of
its label:

| Fill | Legend label | Meaning |
|---|---|---|
| `FF00C2F0` | "PUBLIC" → "Public Lane Swimming" | block type |
| `FFFF9999` | → "50m Lanes" | **long course** |
| no fill / white | → "25m Lanes" | **short course** |
| `theme 7`, light | → "FACILITY CLOSED" | closed |
| `theme 5`, light | → "20m Lane Set-Up Guide" | *see the other workbook* |

So the sheet answers "what state is the pool in at 14:00 on Thursday?" — but
only in a channel that survives neither photocopying in greyscale nor being
described out loud.

### C5 — The configuration timetable is seasonal, and it moves

Derived by reading the time-column fill runs across all 15 sheets:

| Period | Mon/Wed/Fri | Tue/Thu | Saturday | Sunday |
|---|---|---|---|---|
| Dec–Jun | 50 m → 25 m at **09:00** | at **15:15** | 50 m 05:45–08:30 | 50 m 08:30–12:45 |
| **Jul–Aug 30** | at **09:00** | at **09:00** | 50 m 05:45–08:30 **and 15:30–18:15** | 50 m 08:30–12:45 |
| Sept 7 → | at **09:00** | back to **15:15** | 50 m 05:45–08:30 | 50 m 08:30–12:45 |

Summer collapses Tue/Thu onto the weekday pattern (school out) and adds a second
long-course window on Saturday afternoons. The associated rope-change task also
shifts, from 09:00 to **08:45**, across the same boundary.

*Why it matters:* the configuration schedule is not facility metadata. It is
seasonal operating policy that changes several times a year and differs per
weekday.

### C6 — Reconfiguration is scheduled work with a lead time

`LANE ROPE CHANGE` is a first-class, full-width row in the grid — not a note.
It appears 2–3 times per day per sheet.

Most rope changes sit exactly on a configuration flip. **Saturday's does not:**
the task is at **08:15**, the flip at **08:30** (`Sept 14-20!AV16`, shading
changes at row 17). The work starts before the state changes.

Other rope changes are not flips at all — 18:00 and 21:00 entries that
re-lane within a configuration.

The same lead-time logic appears in prose for staffing:
`Sept 14-20!AV6` — *"Vic Masters 7-8:15 (Guards start at 6:45 to open pool
before they arrive)"*. A 07:00 booking implies a 06:45 staff call.

*Why it matters:* transitions are not instantaneous and are not free. They
occupy the tank, they occupy staff, and Crystal schedules them explicitly.

### C7 — The Lane Set-Up book is a library of ~66 named presets

Not a document — a **catalogue**. One printable page per (day × time block),
plus variants. Every page ends with a footer naming the set-up, and the name is
a **composite of the concurrent programmes**, not a single mode:

- `Mon 730-900` → "50M Lengths, Adult Leisure"
- `Mon 1100-1300` → "25M Lengths, Adult Leisure, Parent & Tot, Aquafit"
- `Mon 1300-1530` → "25M Lengths, Adult Leisure *Quiet Swim - No Music or noisy features*"
- `Tues 1730-1900` → "25M Lengths, Lessons, Family Swim"
- `Kayak Polo` → "After-Hours Booking"

Variant axes visible in the tab names: `(No Lessons)` (4 pages), `(WIBIT)`,
`(fun swim)`, `STAT` holiday pages (3), and dated one-offs
(`Jan 13, Feb 15 Pro Aviation`, `Feb 16 Pro Aviation`, `Jan 22 Freedivers`).
`Lane Set Up All Lanes` is the master showing every family at once.

*Why it matters:* this is a session-template library that already exists, keyed
by time block rather than by programme. Migration 047 (`template_occupancy_defaults`)
is aimed at the same target from a different angle.

### C8 — Set-up instructions are landmark-relative, and rope type is a three-value legend

Every page of the book carries the same legend:

> **"Keifer Line"** · **"Rope Line"** · **"Designated space but no rope used"**

Three physically different kinds of divider, distinguished by cell border style.
The third is a boundary that exists only in the guard's head.

Alignment is by **landmark, never by measurement**: `Lane Set up` uses
`"Focal Pt 1"`, `"Focal Pt 2"`, `"In line with cubbies"`, `"On Black Line"`,
`"Across Focal Pt 2"`, `"Slide Here"`, `"Ladder Here"`. The one measurement in
the entire book is an exception worth noting — `Kayak Polo!E19`: *"The shallow
rope is 10m from the wall."*

*Why it matters:* a lane boundary is not a coordinate. Any visual editor that
asks staff to drag a rope to a pixel position is modelling the wrong thing.

### C9 — Set-up pages carry operating procedure that is not about lanes at all

The special-event pages are where the book stops being a diagram:

- `BCMA` (women-only swim, 1845–2015): *"Cover windows with curtains"*;
  *"Put table & 2 chairs + Under 7 wristbands outside universal changeroom at
  1820 (bring them back inside at 1915-1930)"*; *"Close male changeroom gates.
  Reopen if needed at 1945 - radio Maintenance FIRST to ensure they are not in
  not there"*.
- `Kayak Polo`: *"Kayakers must fully leave the facility during close…"*;
  *"The blue Xs mark L-blocks or deck screws for the kayakers to attach their
  goals"*; *"Remove flags as requested, including the 50m flags"*.
- `Kayakers`: *"Remove all ropes."*
- `Thurs 1000-1130!H16`: *"Pain-Free Community Therapy 1030-1130 *Please put up
  Reserved Sign"*.
- `Sat 830-1100!C46`: *"RESERVED - GV Rowing Club Swim Test (900-1400) *[a named
  staff member] to conduct swim tests"*.
- `Sat 1530-1800!I45`: *"RESERVED - Frank Whites (1530-1600) (Check logbook for
  dates)"*.

These are timed, ordered, sometimes person-assigned tasks attached to a booking.

*Why it matters:* this is precisely what `session_internal` setup notes and the
deck sheet's footnote mechanism were built for, and it confirms that decision
hard. It also shows the notes are **timed** (18:20, 19:15–19:30, 19:45), which
a footnote does not currently express.

### C10 — Colour is overloaded and is no longer a key

Roughly 30 distinct fills are in use across the workbook, against a legend that
defines six. The collisions are not edge cases:

| Fill | Wears it |
|---|---|
| `FFFFFF00` yellow | `LANE ROPE CHANGE` **and** `Spirit Orcas` **and** `Important Dates:` |
| `FFFF9999` pink | the legend's **50 m configuration** **and** `Breakwater` / `Breakwater Masters` |
| `FFFF0000` red | `Vikes` **and** `SO` |
| `FF00C2F0` | the legend's `PUBLIC` **and** `Leisure` |

And the inverse — one thing, several colours: `PUBLIC` is both `FF00C2F0` and
`FF25C6FF`; `Leisure` appears in three fills; `Island` in two greens, one of
which (`FF92D050`) is a near-neighbour of `Island C&T`'s `FF00B050`.

A grey (`theme 0`, tint −0.35) carries `Spirit Orcas`, `FD`, `Breakwater`,
`Fun & Features` and `LANE ROPE CHANGE` — plausibly meaning "struck out / not
running this period", but the legend does not say so. **This is a hypothesis,
not a finding**, and it is a good question for the human conversation.

Naming is equally unstable, because the cell is narrower than the name:
`Island C&T` / `Isl'd C&T` / `C&T`; `SO` / `Special O`; `Orcas` / `Oak Bay
Orcas`; `Eilijah` / `EA`; `TWC`.

### C11 — Public swimming is allocated by lane and by speed, *inside* the grid

This one cuts against an existing Dropin decision, so it is stated carefully.

At Crystal, drop-in swimming is **not** residual. It is drawn in lane cells like
any other claim, with speed designations. `Sept 14-20`, Monday 05:30–06:00
(merge ranges from the sheet):

| Lanes | Merge | Label |
|---|---|---|
| 1–2 | `B5:C7` | `Cont` (continuous) |
| 3–4 | `D5:E7` | `Fast` |
| 5–6 | `F5:G7` | `Slow` |
| 8 | `I5:I18` | `Leisure` |

Counts across three sampled sheets: `Cont` 42, `Slow` 40, `Fast` 29,
`Leisure` 20. There is a further aquafit taxonomy in the same cells —
`Shallow AF`, `Deep AF`, `Deep AF Pain-Free Leisure`, `Aqualite`.

*Why it matters:* `deckSheet.ts` deliberately draws **only exclusive claims**,
on the reasoning that drop-in is residual and empty cells are the open water.
For Crystal, the empty cells would lose the speed-lane plan, which is the part
the guard enforces.

### C12 — Lifecycle and contingency have three homes, and none of them print

Information the grid has no column for is pushed into three places:

1. **Cell-text suffixes** — `K9 = "TWC st Sept 1"`, `K45 = "PCS - confirmed"`,
   `AP45 = "Island (+20m #1-2)"`, `"Mercury Rising Start Aug 31"`,
   `"PCS Last Day July 23"`.
2. **Hover comments** — 32 across 12 of the 15 sheets. Sub-range scoping
   (*"Aug 31-Sept 25"*, *"Sept 8-24 T/Th"*), lifecycle (*"Starts Oct 7"*,
   *"Last day Jan 13"*, *"End May 31"*, *"Aug 5 last day"*), **contingency
   rules** (*"If upper level registration is low, move Breakwater over to 25m
   #1-3"*), and **external dependencies** (*"Will switch to the lake towards the
   end of May; check in with [a colleague] mid-May"*).
3. **An "Important Dates:" block** on the sheet itself (`July 2026`):
   *"M-Th AM Lessons run July 6-Aug 13"*, *"M-F PM Lessons run July 6-Aug 21"*,
   *"Orcas Last Day Aug 13"*.

Note `AP45 = "Island (+20m #1-2)"` specifically: a booking that spans two lane
families, expressed as free text because the grid can only address one.

The redundancy is measurable. *"Aug 31-Sept 25"* is attached to three separate
cells on each of four sheets — **twelve copies of one fact**. *"If upper level
registration is low…"* is copied across five sheets.

And comments are hover-only. **The artifact is printed and posted.** The
qualifications that most change what a guard should do are invisible in the
medium the document is actually consumed in.

### C13 — Slice length tracks the rate of change

The 15 At-a-Glance sheets are date ranges, not weeks, and the granularity
tightens as the schedule becomes volatile:

`Dec 29-Jan 4` · `Jan 5-13` · **`Jan 14-Mar 14`** (two months) ·
`SB (Mar 15-29)` (spring break) · `April` · `May` · `June` · `July` ·
then weekly: `Aug 1-13`, `Aug 14-20`, `Aug 21-30`, `Aug 31-Sept 6`,
`Sept 7-13`, `Sept 14-20`, `Sept 21-27`.

This matches Dropin's schedule-group timeline-slice model closely (see
`project_schedule_group_status`) — a slice is a period over which the plan is
stable, and its length is an editorial judgement.

The final sheet, `Sept 21-27`, has an extra row the others lack —
`A4 = "Kids Day"`, `J4 = "Staff Day"`, `S4 = "Legacy Day"`,
`AB4 = "Throwback Day"`, `AK4 = "Final Day"`. See §7; this needs asking about
before anything is assumed.

### C14 — The set drifts, and nothing in it can notice

- **9 of 65** day/time set-up pages disagree with their own tab. Some are
  cosmetic (`Sat 7-815` → "Saturday 700-815"); several are not:
  `Thurs 1100-1515` is titled *"Thursday 1300-1515"*; `Sat 830-1100` is titled
  *"Saturday 830-1300"*; `Sun 1530-1800 (No Lessons)` is titled
  *"Sunday 1700-1800"*; `Tues 1300-1515 (fun swim)` is titled **"Thursday**
  1300-1515". A guard who finds the page by tab and a guard who reads the title
  get different answers.
- `BCMA` lists `25M #3` three times (rows 42, 44, 46) and omits `25M #2`.
- `Wed 1530-19000` — a typo in a tab; `615-730` is missing its day; `Sheet3` is
  an empty orphan.
- **Internal contradiction:** on `SB (Mar 15-29)`, Tuesday's only daytime
  `LANE ROPE CHANGE` is at row 34 = **12:45**, while the time-column shading
  flips 50 m → 25 m at **15:15**. The same sheet states the same fact twice and
  disagrees with itself. Which is correct cannot be determined from the file.
- Freshness is one manual stamp per sheet (`"Last Updated: Aug 30, 2026"`,
  `"Last Updated: July 9, 2026"`) covering 4,480–7,341 cells. It cannot say
  which cell moved.
- And there are **two printed copies** (Deep End, Lifeguard Office) with no
  mechanism to keep them in step.

---

## 3. The seams

**Vocabulary ↔ sentences: the grid can only address one family at a time.**
The At-a-Glance grid has eight lane columns. The pool has at least six name
families (C1). So the second family gets a second grid with its own broken time
axis (C2, C3), and the third gets smuggled into cell text — `"Island (+20m
#1-2)"`, `"Deep AF"`, `"Shallow AF Leisure"`, `"PCS - Deep half of Tots"`. The
Layout Map's vocabulary is richer than either consuming document can express,
so the richness leaks into prose, where nothing can check it.

**Grammar ↔ sentences: two files, coupled by colour, maintained separately.**
At-a-Glance says *when* the pool is long course; the Lane Set-Up book says *what
that physically looks like*. The link is a colour swatch pointing at a filename
(`"20m Lane Set-Up Guide"`), and the pages are keyed by time block while the
grid is keyed by date range. Nothing enforces that `Mon 915-1000`'s footer
("25M Lengths, Adult Leisure, Parent & Tot and Aquafit") still matches what the
Monday column actually says. When they drift, no one finds out until a guard is
standing on deck holding the wrong page.

There is one place the coupling is expressed rather than implied, and it is
instructive: `Aug 31-Sept 6!BZ5 = "50m Lanes"` — a cell **in the 20 m grid**, on
Tuesday at 09:00, whose content is an explanation that the 20 m lanes do not
exist right now because the tank is still long course. The sheet is manually
writing down a derivation it cannot compute.

**Everywhere ↔ nowhere: the third bucket.** Timed procedure (C9), contingency
rules, sub-date ranges, external dependencies and confirmation status (C12) have
no home. They land in hover comments that do not print, in an "Important Dates"
block, in cell-text suffixes, or in a Logbook the sheet merely points at
(`"See Logbook / After-Hours Booking Email"`, `"Check logbook for dates"`). Four
overflow destinations, one of which is a different system entirely.

---

## 4. Crystal vs. Commonwealth

| | Commonwealth Rec | Crystal Pool |
|---|---|---|
| Internal artifact | One hand-built Excel sheet, printed | **Two** workbooks (95 sheets) plus a layout map |
| Orientation | Lanes as columns, time as rows, one day | Same, but **7 days abreast**, ×2 grids |
| Lane families | One | **Six**, overlapping, some concurrent |
| Configuration | Long/short course | Long/short **plus** a concurrent 20 m family and lesson squares |
| Transitions | Not discussed | First-class scheduled rows, with lead time |
| Physical set-up | Not discussed | A ~66-page preset book, printed in duplicate |
| Drop-in | Residual — subtracted to get the public PDF | **Allocated explicitly**, by lane and by speed |
| Public output | A derived PDF (red/blue/black lane counts) | Not in the document set provided |
| Slices | A week | Irregular, 1 week – 2 months |

**Likely general to aquatic operations** (two-for-two, or structurally forced):

- Lanes × time is the working artifact, and it is printed and posted.
- Bookings span multiple lanes; occupancy is per-lane.
- The document is maintained by one scheduler and read by many guards.
- Booking status, start/end dates and contingencies have no home in a grid.
- Long course / short course reconfiguration exists.
- Staff-only holder names sit beside public-facing blocks.

**Crystal-specific, or at least unconfirmed elsewhere:**

- Six overlapping lane families, and two concurrent occupancy grids.
- A separate physical set-up book with landmark-relative instructions.
- Speed-lane allocation of drop-in (`Cont`/`Fast`/`Slow`/`Leisure`).
- A seasonal configuration timetable that varies per weekday.
- Rope-change tasks scheduled with lead time.

The honest reading: **Crystal is Commonwealth plus a physical-configuration
problem.** Everything Commonwealth needs, Crystal also needs. The additions are
real but they sit on top; they do not invalidate the built model. That matters
for sequencing — it means the existing deck sheet is not wasted work.

---

## 5. What this confirms, and what it contradicts

| # | Concept | Decision in `PLAN-internal-view.md` | Verdict | Consequence |
|---|---|---|---|---|
| 1 | C1, C2, C3 | §3: *"Deliberately not modelled: physical overlap… a facility is in exactly one configuration at a time, so two overlapping sessions claiming spaces from different configurations is an advisory warning."* | **Challenges** | Crystal runs 25 m and 20 m families **concurrently and deliberately**. The advisory would fire constantly on correct data and be trained away within a week. The premise, not the mechanism, is what breaks. |
| 2 | C1 | §3: physical overlap unmodelled | **Challenges (softly)** | With perpendicular families, `CP50M 3` and `Shallow 20M 3` genuinely are the same water. Name equality cannot see it. But note Crystal never runs 50 m *and* 25 m at once — the overlap that matters is 25 m ↔ 20 m, which is *intentional*, not a collision. |
| 3 | C4, C5, C6 | §3: *"the configuration is declared, not derived, and transitions are not modelled."* | **Partly confirms, partly challenges** | Declared-not-derived is right: Crystal declares it too, in a colour. But transitions are modelled by Crystal — as scheduled rows with lead times. |
| 4 | C11 | §15: *"It draws only the exclusive claims… empty cells are the open water they run in."* | **Challenges** | For Crystal the empty cells would discard the speed-lane plan (`Cont`/`Fast`/`Slow`/`Leisure` per lane), which is the operative instruction. Needs either a per-session override or a residual-with-lanes case. |
| 5 | C9 | §15: setup notes as numbered footnotes under the sheet | **Confirms strongly** | Crystal's notes are exactly this shape and this length. One gap: several are **timed** (18:20, 19:45), and a footnote has no time. |
| 6 | C7 | Migration 047, `template_occupancy_defaults` | **Confirms** | Crystal already maintains ~66 presets by hand. Templates are aimed at the right thing; the keying differs (time block, not programme). |
| 7 | C12 | `session_exceptions`, schedule-group date ranges | **Partly confirms** | Sub-ranges and last-days map onto existing machinery. **Contingency rules** ("if registration is low, move X to lanes 1-3") map onto nothing and probably should not — they may be genuinely human. |
| 8 | C13 | Timeline slices (`project_schedule_group_status`) | **Confirms** | Irregular, editorially chosen slices are exactly the existing model. Encouraging: it was designed without this evidence. |
| 9 | C14 | Migrations 037/038 (week reviews, activity log) | **Confirms** | The drift is real, measurable, and the built change-tracking is the answer to it. A per-cell "last touched" beats one stamp per sheet. |
| 10 | C10 | — | **Silent** | The deck sheet is a monochrome print table with no holder-colour concept. Crystal's staff read colour first. Not a defect; an unexamined difference. |
| 11 | C2, C14 | §15: *"No 'print the week' — seven days is seven sheets, and the customer prints one day at a time."* | **Confirms for the set-up book, challenges for At-a-Glance** | Crystal's *set-up* artifact is finer than a day (per time block). Their *planning* artifact is a full week abreast. Two audiences, two granularities — the same split the plan already draws between deck sheet and board. |

**On the headline collision (row 1), stated plainly:** the "one configuration at
a time" predicate is false at Crystal, and the advisory warning built on it would
be noise rather than signal. That is a real finding and it should not be softened.

But it is not fatal to the built model, for a reason worth being precise about:
Crystal's concurrent families are **25 m and 20 m**, which occupy *different
parts* of the tank (deep third versus mid/shallow). The families that genuinely
contend for the same water — 50 m versus everything else — are never run
concurrently, and the existing advisory would catch that correctly. So the fix
is plausibly narrow: let a facility declare which configurations may coexist,
rather than assuming none may. That is a hypothesis for a later prompt, not a
decision, and it needs the geometry confirmed with a human (§7).

---

## 6. The open questions from `DISCOVERY-internal-view.md` §8

| # | Question | Status | Evidence |
|---|---|---|---|
| 1 | Per-day or per-week? | **Answered — both, for different audiences** | Set-up book is per **time block** (finer than a day); At-a-Glance is a **week abreast**. The deck sheet (day) and board (week) split is right. |
| 2 | Does internal occupancy consume capacity, or is it annotation? | **Answered — consumes** | Clubs hold named lanes; public swim gets what is left, allocated by speed. `BZ5 = "50m Lanes"` is a hand-written capacity derivation. |
| 3 | Compute availability, or let them state it? | **Still open** | Crystal's public output was not supplied. Nothing here shows the subtraction step Commonwealth described. **Ask for their public schedule.** |
| 4 | Who may see internal sessions? | **Still open** | Not visible in documents. The set-up book being printed and left on deck suggests a low secrecy bar for *set-up*; club names are a separate question. |
| 5 | Are closures/maintenance first-class? | **Partly answered** | `STAT - Pool Closed`, `Facility Closes at 4pm`, `FACILITY CLOSED` in the legend — closures are first-class. **Maintenance is absent**, and `LANE ROPE CHANGE` is a new third category: neither booking nor closure, but *work on the space*. |
| 6 | Must the internal view print? | **Answered — yes, emphatically** | Two printed copies at named physical locations, per-page print settings on all 80 sheets, a legend on every page. Print is the medium, not an export. |
| 7 | One centre's workflow, or the norm? | **Partly answered — second data point** | Shared: lanes × time, printed, per-lane occupancy, one scheduler / many readers, no home for booking metadata. Differs: Crystal adds a whole physical-configuration layer Commonwealth never mentioned. Two operators is not a norm; it is enough to separate "core" from "extension". |

---

## 7. What the documents cannot tell us

Questions for a human at Crystal, in the order worth asking:

1. **Is the pool closing?** `Sept 21-27` — the last sheet in the workbook — has
   a row the other fourteen lack: *Kids Day · Staff Day · Legacy Day ·
   Throwback Day · Final Day*. That reads like a closing week. If Crystal is
   being decommissioned or replaced, it changes what "they may buy this in the
   future" means — it may mean the **replacement facility**, with different
   geometry, and a migration story rather than a conversion story. Ask before
   building anything Crystal-shaped.
2. **Which lane families are ever live at the same time?** The 25 m and 20 m
   grids coexist. Do 50 m and 20 m? Do lesson squares A–H coexist with 20 m
   lanes? This single answer determines whether the "one configuration"
   predicate needs replacing or just relaxing.
3. **Why is the 20 m grid missing from six sheets?** Unused in those periods, or
   dropped and tracked elsewhere?
4. **Does the grey fill mean "not running"?** (C10.) If yes, that is a
   cancelled/suspended state with no column anywhere.
5. **Who maintains the Lane Set-Up book, and how does a page get updated when
   At-a-Glance changes?** Is there any process, or is drift simply absorbed?
6. **What does the public see?** No public artifact was supplied. Without it we
   cannot tell whether Crystal does Commonwealth's subtraction at all.
7. **How do the two printed copies stay in sync?** And which one wins when they
   disagree?
8. **Are the timed procedures (C9) reliably done?** Wristband table at 18:20,
   changeroom gates at 19:45 — is a missed step a known failure mode? That
   determines whether a checklist is worth anything.
9. **Is the `SB` sheet's 12:45-vs-15:15 contradiction (C14) a known error or a
   convention we are misreading?**

---

## 8. Candidate follow-on prompts

Ranked by value-to-risk. **[All]** = improves the deck sheet for every customer
regardless of Crystal. **[Crystal]** = only worth doing if they buy (see §7 Q1).

| # | Title | Question it answers | Concepts | Type | Size | Ships in simplify-for-launch? |
|---|---|---|---|---|---|---|
| 1 | **Speed-lane drop-in on the deck sheet** `[All]` | Should a residual block be able to name its lanes and sub-type, and how does the sheet draw it without asserting exclusivity? | C11 | View + small model | S–M | **Yes** |
| 2 | **Timed setup notes** `[All]` | Footnotes have no clock. Should a setup note carry an optional time and sort into the day, as a pre-open / during / close checklist? | C9 | View + small model | S | **Yes** |
| 3 | **What prints, and what is lost when it does** `[All]` | An audit: which staff-critical facts exist only in hover/colour channels that a printout destroys? Crystal's comments are the test case. | C4, C10, C12 | Discovery | S | **Yes** |
| 4 | **Reconfiguration as a schedulable thing** `[All]` | Is a rope change a session with `occupancy_kind = 'changeover'`, a facility-level event, or a derived marker between two configurations? Lead time is the crux. | C4, C5, C6 | Model | M | Probably — as a `closure` subtype first |
| 5 | **Relaxing "one configuration at a time"** `[Crystal]` | Replace the predicate with a declared compatibility rule: which configurations may coexist? Does the advisory survive? | C1, C2 | Model | M–L | No — needs §7 Q2 answered first |
| 6 | **The set-up preset library** `[All]` | Can ~66 hand-maintained set-up pages become templates that render from the schedule, so the book stops drifting from the grid? Strongest ROI story available. | C7, C8, C14 | Model + view | L | No — but it is the biggest prize |
| 7 | **Booking metadata that has no home** `[All]` | Sub-ranges, confirmation status, last-day, contingency rules. Which belong in schema, which in a note field, which stay human? Resist modelling all of it. | C12 | Model | M | Partly — status and dates only |
| 8 | **Two grids, one time axis** `[Crystal]` | Can one deck sheet show two concurrent lane families without the offset-axis failure? Or are they two sheets? | C2, C3 | View | M | No |
| 9 | **Landmark-anchored lane boundaries** `[Crystal]` | Facility maps position shapes by coordinate; Crystal positions ropes by landmark. Does the floorplan need named anchors? | C8 | Model + view | L | No |
| 10 | **A second-operator comparison memo** `[All]` | Merge this document with `DISCOVERY-internal-view.md` into one "what aquatic operators actually do" reference, separating core from extension, before a third centre is visited. | all | Discovery | S | **Yes** |

**Recommended first three:** #1, #2, #3. All are `[All]`, all are small, none
depends on whether Crystal buys, and each removes a real defect in the deck
sheet as it stands today. #10 is nearly free and prevents this document from
being re-derived next time.

**Do not start #5, #6, #8 or #9** until §7 Q1 and Q2 are answered by a person.
Four of the ten prompts here are gated on a phone call, which is the most
useful thing this review found.

---

## Appendix — reproducing the extraction

No Python and no xlsx library on this machine; `unzip` and Node 22 are
available.

```
unzip -q "At-a-Glance 2026.xlsx" -d <dir>
```

- Values: `xl/worksheets/sheetN.xml`, strings via `xl/sharedStrings.xml`.
- Extents: `<mergeCell ref="…"/>` — a booking's lane and time span.
- Colour: cell `s=` → `styles.xml` `cellXfs[s].fillId` → `fills[fillId]`.
- Comments: `xl/comments*.xml`, joined via `xl/worksheets/_rels/sheetN.xml.rels`.
- Times: Excel day fractions (`0.22916…` = 05:30); rows step 15 minutes.
- Sheet order and names: `xl/workbook.xml` + `xl/_rels/workbook.xml.rels`.

**The trap:** scan cells with a *lazy* attribute class —
`/<c ([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g`. A greedy `[^>]*` consumes the `/` of a
self-closing `<c …/>`, silently merging dozens of cells into one match and
producing confident wrong answers. It cost several passes here before being
caught by a cell count that was too low.
