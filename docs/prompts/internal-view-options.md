# Prompt: Options for the Internal (Staff-Only) View

Paste the block below into a fresh Dropin session. It is written to produce
**options with trade-offs**, not an implementation. Do not let it start coding.

---

Read `docs/DISCOVERY-internal-view.md` first — it is the customer conversation
this brief comes from, and it is current. Then read `docs/RESUME.md` for
project state. Do not write any code in this session.

## The problem

Commonwealth Rec runs their pool on three artifacts. ActiveNet holds the money.
A public PDF (`SCP Lengths Schedule Aug 10-16.pdf`, in the repo root — open it)
tells patrons how much water is open, expressed only as lane counts and colour:
red = 1–2 lanes, blue = 3–4, black = more than 4. It deliberately never names
who occupies the water.

The third artifact is the one we did not know about and the one that matters: a
hand-built Excel sheet, printed, with **lanes as columns and time as rows**,
showing every group that holds space — swim club, lessons, camps, rentals,
closures — alongside the drop-in blocks that must be protected. It is the
lifeguard's cheat sheet. It is rebuilt by hand and it is a large amount of
recurring work.

The public PDF is **derived** from that sheet: staff allocate every lane, then
subtract to get remaining capacity, then retype the result. Dropin currently
models only the derived output. We ask customers to re-enter an answer they
computed elsewhere.

The customer asked for an **internal view**: sessions enterable purely for staff
context, never visible to the public, so staff can confirm programs and rentals
are getting their space while honouring the drop-in schedule.

## What I want from you

Produce **4–6 genuinely distinct options**, ordered smallest to largest, for how
Dropin should solve this. Distinct means a different bet about what the product
is — not the same idea at three sizes. Span at least this range:

- a minimal option that changes almost nothing structurally and could ship this
  week
- at least one option that treats the internal sheet as a *view* problem
- at least one that treats it as a *data model* problem
- at least one that closes the loop and **computes** public availability from
  internal occupancy (the derivation the customer does by hand)
- one deliberately ambitious option, clearly labelled as a later bet

For **each** option, give me:

1. **Name and one-sentence thesis** — the bet it makes.
2. **Schema changes**, named concretely: tables, columns, constraints, migration
   number. State explicitly where the visibility boundary lands and why there.
3. **RLS blast radius.** Publication today is gated at the schedule-group level
   (`schedule_groups.status`), and the public read policies for `sessions`,
   `session_spaces`, `session_exceptions` and `session_features` all
   `EXISTS`-join back to it. There is no per-session visibility. Name every
   policy this option forces you to touch, and say what an unauthenticated
   caller could enumerate if the option were implemented wrong.
4. **UI surface**: which existing route and which view mode, or what new one.
   Note that `board` is time-rows × day-columns (the PDF replica); the Excel
   sheet is time-rows × **space**-columns for a single day, which does not exist
   yet. Say whether it must print.
5. **What it reuses** from `session_spaces`, conflict detection (039), `spaces`,
   facility maps, widget scopes, activity log — and what it genuinely has to
   build new.
6. **Effort**, as a rough band (days), and **what could go wrong** — the failure
   mode a reviewer would catch, not a generic risk.
7. **The leak test**: how a staff-only session could accidentally reach the
   public widget, the public facility page, the embed, or an expand API
   response — and what stops it.

## Evaluate every option against these criteria

- **Does it keep the public schedule availability-descriptive?** Occupancy must
  never leak into patron-facing output unless explicitly opted in.
- **Does it kill the Excel sheet, or just add a fourth tool?** Adding a fourth
  place to type things is a failure, however elegant.
- **Can it ship during simplify-for-launch?** We are cutting scope, not adding
  phases. Weigh this heavily.
- **Does it generalise past a swimming pool?** Lanes are the example; arenas,
  courts, studios and rinks are the same shape. An option that hard-codes pool
  semantics is worse than one that does not.
- **Does it stay out of ActiveNet's lane?** No payments, no registration, no
  rental transactions, no staff shift scheduling. Rendering allocation is in
  scope; transacting it is not.

## Hard constraints

- Dropin is **not a marketplace** and not a discovery product (settled
  2026-08-12). Do not propose anything consumer-facing or cross-org.
- Do not propose reviving scraping, events/brochures, or timezone support — all
  three are removed and closed.
- Do not overload `schedule_groups.status = 'draft'` to mean "internal" without
  arguing the case directly: `draft` already means *not finished yet*, and draft
  groups fall out of the published views and conflict checks an internal view
  needs to see at the same time as public ones. If an option does this anyway,
  say why the conflation is acceptable.
- Verify claims against the actual schema and code before asserting them. If you
  say a policy or column exists, you have read it.

## Also tell me

- **Which open questions from §8 of the discovery doc block which options.**
  Some options cannot be chosen until the customer answers. Say which, and draft
  the three questions I should send him — short enough to answer in a reply.
- **Your recommendation**, with reasoning, and the one thing that would change
  your mind.
- **What we should ask two other rec centres** to learn whether this workflow is
  industry-standard or specific to Commonwealth. If it is standard, the large
  options get much more attractive.

## Output

A written comparison — a table of options against the criteria, then a section
per option. End with the recommendation and the customer questions. No code, no
migrations written, no files changed other than a new doc if you want one.
