# Discovery: The Internal View (Commonwealth Rec, 2026-09-11)

Source: conversation with a recreation professional at Commonwealth Rec — a
prospective customer and an experienced practitioner. This document records
what was learned, why it matters, and the constraints any solution has to
respect. It is discovery, **not** authorization to build. See
`docs/prompts/internal-view-options.md` for the brief that turns it into options.

---

## 1. What we thought we knew

Commonwealth manages its schedule with two tools:

| Tool | Purpose we assumed |
|---|---|
| **ActiveNet** | Club payments, lane rentals, registered programs — the money system |
| **The public PDF** (`SCP Lengths Schedule Aug 10-16.pdf`) | The drop-in schedule patrons read |

Our pitch was implicitly: *replace the PDF*.

## 2. What is actually true — there is a third tool, and it is the important one

They maintain a **hand-built Excel sheet, printed**: lanes as columns, time as
rows, every cell filled with whoever holds that water — swim club, lessons,
camps, rentals, maintenance closures, and the drop-in blocks that must be
protected. Neither ActiveNet nor the PDF is used for this. It is rebuilt by
hand, and it is a ton of extra work.

This is the artifact staff actually work from. The lifeguard on deck consults
the Excel sheet, not the PDF and not ActiveNet.

### The three tools answer three genuinely different questions

| Artifact | Question it answers | Audience | Granularity |
|---|---|---|---|
| ActiveNet | *Who paid for what?* | Finance / registration | Transaction |
| Excel sheet | *Who is in which lane right now?* | Staff, on deck | **Occupancy** — per lane |
| Public PDF | *How much water can I swim in?* | Patrons | **Availability** — lane counts only |

### The critical structural insight

**The PDF is derived from the Excel sheet.** Staff allocate every lane first,
then subtract to get leftover capacity, then retype that as the public
schedule. The PDF's entire colour system is the output of that subtraction:

> RED = Reduced Lanes (1 or 2) · BLUE = 3 or 4 Lanes Available · BLACK = more than 4

Note what the PDF deliberately does **not** say: it never names the swim club or
the camp. "Camps In Pool 12-1pm" is the one leak, and it is a note, not a
booking. The public schedule is *descriptive of available space*, not of who
occupies it. That editorial choice is deliberate and must stay possible.

**Dropin today models only the output.** We ask the customer to type in the
already-computed answer. The work that produces that answer — the allocation —
happens somewhere we cannot see, so we save them nothing on the expensive step
and we cannot vouch for the number they typed.

## 3. What was asked for, precisely

- Sessions that exist **for staff context only** and are never public.
- An **internal view**: "the lifeguard's cheat sheet" — confirm the programs,
  rentals and clubs are getting their space *while honouring the drop-in
  schedule*, which reflects available space.
- The public drop-in schedule stays availability-descriptive. Adding internal
  bookings must not change what patrons see.

He loved the application as it stands. This is an addition, not a correction.

## 4. Why this is strategically large, not a feature request

1. **It changes the category.** "A nicer way to publish your PDF" is a
   marketing tool — occasional use, competes with a free PDF, easy to cancel.
   "The sheet you run the pool deck from" is an operations tool — daily use by
   every guard on every shift. Daily staff usage is the retention moat.
2. **It is the wedge against ActiveNet without fighting it.** We never touch
   payments. We own the space allocation ActiveNet does not render.
3. **Only we can close the loop.** If staff enter occupancy, Dropin can
   *compute* "3 lanes available → blue" instead of asking a human to count and
   retype. That is the step where errors currently enter.
4. **It makes the public data trustworthy**, instead of as accurate as one
   person's weekly mental subtraction.
5. **It replaces a whole tool, not a document.** The Excel sheet is duplicated
   labour. Killing it is a concrete, quantifiable ROI story for the sales
   conversation.

## 5. Guardrails — what this is *not*

Ranked by how tempting each trap is:

- **Not a booking/reservation system.** ActiveNet keeps payments, registration
  and rental agreements. We render allocation; we do not transact it.
- **Not staff scheduling.** Lifeguard shifts, breaks and certifications are the
  obvious adjacent ask. Out of scope.
- **Not discovery or a marketplace.** Settled 2026-08-12; unchanged here.
- **Not an ActiveNet replacement, and not a two-way sync commitment.** Import
  already exists; deepening it is a separate decision.

This lands during an explicit **simplify-for-launch** phase. Any option must be
judged on whether it can ship small.

## 6. The architectural collision

Publication in Dropin is a **schedule-group-level** concept, not a session-level
one. Migration 033 replaced `schedule_groups.is_published` with
`status TEXT CHECK (status IN ('draft','published'))`, and the public RLS
policies for `sessions`, `session_spaces`, `session_exceptions` and
`session_features` each `EXISTS`-join back to `sg.status = 'published'`.
`facilities.is_published`, `departments.is_published` and `spaces.is_published`
gate their own levels above it.

**There is no per-session visibility anywhere in the schema.** So "internal-only
sessions" is not a UI checkbox — it is a decision about where the visibility
boundary lives, and each placement has a different RLS blast radius.

Known trap: putting internal sessions in a `draft` schedule group hides them
from the public correctly, but `draft` already means *not finished yet*.
Overloading it conflates two states, and draft groups drop out of the published
views, conflict checks and widget scopes that an internal view needs to see
*simultaneously* with the public ones.

## 7. Machinery that already exists — reuse, do not rebuild

- **`session_spaces`** (020): a session already spans N lanes as one row.
  Per-lane occupancy is *already modeled*. This is the single biggest asset.
- **Conflict detection + dismissals** (039): already finds two sessions on the
  same space at the same time. That is the engine for "is this lane
  double-booked" and for "does this rental collide with drop-in."
- **`spaces`** (012): `capacity`, `display_order`, department scoping — the
  lane columns already exist as records.
- **Facility maps / floorplan / hotspots / shape lane groups** (016–019): a
  visual lane layout already exists and renders.
- **Widget config scopes** (043/045): the existing mechanism for deciding what
  is publicly exposed.
- **Activity log** (038) and **week reviews** (037): change tracking for a
  document staff will argue about.
- **View modes**: `grid`, `list`, `map`, `board`, `floorplan`. `board` is time
  rows × **day** columns — the PDF replica. The Excel sheet is time rows ×
  **space** columns for **one day**. That orientation does not exist yet.

## 8. Open questions to resolve before designing

1. Is the internal sheet per-day or per-week? The PDF is a week; the printed
   Excel appears to be a day. This decides the primary view.
2. Does an internal session *consume capacity* that public availability is
   computed from, or is it purely annotation? This is the difference between a
   notes feature and a capacity engine.
3. Should we compute availability (red/blue/black), or does the customer want
   to keep stating it by hand? Computing it is the bigger prize and the bigger
   risk.
4. Who may see internal sessions — every org member, or a role? `member` today
   means "read + schedule editing."
5. Do closures and maintenance need to be first-class, distinct from bookings?
6. Must the internal view print? The current artifact is printed. Print
   fidelity may be a hard requirement rather than a nicety.
7. Is this one centre's workflow or the industry norm? Worth asking two more
   operators before building the large version.
