# Fix schedule input: conflict detection, recurrence, timezone, lane-status

## Where this comes from

A dogfooding pass built a real multi-pool weekly schedule (Saanich Commonwealth
Pool's public "SCP Lengths Swimming" PDF, Aug 10–16) inside Dropin via the
browser — not by reading code. Facility → Spaces (Competition Pool, Teach
Pool, Dive Tank) → Schedule groups → Sessions, entered by hand through
`/dashboard/sessions/new`. Two real bugs and a handful of friction points
surfaced this way, all reproducible. This doc is the fix list, in priority
order. Read the whole thing before starting — the constraints section at the
bottom is not optional.

Reproduce fresh with the existing harness pattern: `node
scripts/verify/seed-demo.mjs` gives a signed-in cookie and a demo org/facility
in under a minute (see `scripts/verify/README.md`). Add a facility, a couple
of spaces, and a schedule group, then use `/dashboard/sessions/new` — the
repro steps below assume that starting point.

## P0 — Bugs — **FIXED 2026-08-15**, see below

Both bugs turned out to share one root cause, in `expandOccurrenceTimes()`
(`src/lib/rrule/expand.ts`), the shared occurrence-expansion core that both
the conflict checker and every schedule-rendering surface build on — see
`src/lib/rrule/README.md` for the full explanation. Summary: rrule advances
DTSTART by fixed calendar increments and has no notion of "local time"; it
was being handed the *stored* dtstart (a real UTC instant), which breaks
whenever that instant's UTC calendar day/offset differs from the session's
intended local one.

**Fixed** by building a *floating* (no `"Z"`) DTSTART from the session's
local wall-clock components, so rrule's calendar arithmetic matches the day
a human actually picked, and re-anchoring every generated occurrence to a
real UTC instant afterward — the same re-derivation `buildEndTime()` already
did for the end, now applied to the start too. Also fixed `buildRRuleSet()`
(same file), which shared the identical construction bug, though it
currently has no callers.

Verified end-to-end against the live app + real DB via
`node scripts/verify/verify-f.mjs` (new — 8/8 assertions passing), which
drives the actual `POST /api/sessions` and `GET /api/sessions/expand`
routes as a genuinely signed-in user, not a unit test of the function in
isolation.

### Bug 1 (original framing): "False conflict" on same-space sessions

**What it looked like during dogfooding:** two same-space sessions with
non-overlapping wall-clock times (9:15am–12:00pm and 12:15pm–12:45pm)
rejected as conflicting, citing an unrelated time.

**What it actually was, confirmed by reading the live stored rows and
re-running the real algorithm against them:** the conflict math itself
(`c.start < o.end && o.start < c.end` in `src/lib/sessions/conflicts.ts`) is
correct and was **not** changed. The false positives had two distinct real
causes, both upstream in occurrence expansion:
- **DST drift.** Both sessions recur weekly with no end date, so the
  conflict checker's 2-year lookahead walks straight through the Nov 2026
  fall-back. Past that boundary, the old code's raw rrule-generated *start*
  kept its original UTC offset baked in while `buildEndTime()` correctly
  re-derived the *end* for each occurrence's real local date — start and end
  drifted an hour out of sync with each other, manufacturing genuine
  time-range overlaps with neighbouring sessions that were never supposed to
  touch. Confirmed directly: a scripted repro of the exact touching-boundary
  case showed zero conflicts for the first ~12 weeks, then real conflicts
  appearing every week from 2026-11-02 (the DST transition) through the
  following spring, and stopping again after the March forward-transition.
- **A form bug, not this bug:** one specific repro during dogfooding also
  involved the "Advanced options" timezone selector reverting from
  `America/Vancouver` to the default `America/Edmonton` between edits of the
  same open form — which made two wall-clock times that looked
  non-overlapping (9:15am–12:00pm Vancouver vs. 12:15pm–12:45pm Edmonton)
  genuinely overlap in real UTC terms (12:15pm Edmonton is 11:15am
  Vancouver-equivalent, inside the first session's range). The conflict
  checker was correct to reject it. This is really the P1 "timezone
  silently defaults wrong" item below, just with a more confusing symptom —
  worth fixing P1's timezone-default item with extra care given it can
  produce misleading "false" conflicts, not just wrong-zone display.

The error message (`"...both claim the same space on <date> around
<time>..."`) was re-checked against the corrected understanding and is
accurate — it names the real conflicting occurrence's real time. No message
copy change was needed.

### Bug 2 (original framing): Evening sessions land on the day before their configured weekday

Confirmed exactly as originally reported — a Monday session starting ≥6pm
rendered under Sunday, on both the dashboard grid and the live public page.
Root cause: the UTC-day-crossing half of the same `expandOccurrenceTimes()`
defect described above (an evening local time converted to UTC lands on the
*next* UTC calendar day, so `BYDAY=MO` matched the wrong day and rrule
searched forward to the next UTC-Monday — which converts back to the
*Sunday evening before* the intended Monday). Fixed by the same floating-
DTSTART change.

### Bonus find while verifying the fix against the live app: unpublished spaces crashed the public schedule

Not on this list, found only because verification was done against the real
running app rather than trusted from a green build (per the constraints
below). `expandSessions()` (also `src/lib/rrule/expand.ts`) sorted
`session_spaces` by `.display_order` without checking whether the embedded
`spaces` object was null — which it silently is, for an anonymous/public
read, whenever an attached space is still in Draft (RLS on `spaces` nulls
the embed rather than omitting the row). Result: any facility with even one
session attached to an unpublished space 500'd on its *entire* public
schedule page and widget. Fixed by filtering nulled spaces out before the
sort. Covered by `verify-f.mjs` section 4 (confirmed it fails without the
fix, not just that it passes with it).

## P1 — Input experience — **FIXED 2026-08-15**, see below

All five items shipped. Verified against the live app + real DB via
`node scripts/verify/verify-g.mjs` (new, schedule-group publish gate) and a
live browser check of the two purely client-side items (timezone
auto-derivation, the new "Add another time…" dialog) — both confirmed
end-to-end by reading the resulting row back from the database, not just
trusting the UI. `verify-b`, `verify-d`, `verify-e`, `verify-f` re-run clean.

- **Timezone default.** Was hardcoded to `America/Edmonton` in more places
  than the original dogfooding found: the standalone session form
  (`SessionForm.tsx`), *and* three separate handlers inside
  `ScheduleCommandCentre.tsx` (`handleConfirmCreate`, `handleConfirmDuplicate`,
  `handleConfirmReschedule`) that don't even expose a timezone field — those
  three were silently writing the wrong real-world time on every "+"-button
  create, duplicate, and **drag-to-reschedule** (the primary interaction
  path), not just displaying a wrong default a user could catch. Fixed with
  `provinceToTimezone()` (`src/lib/utils/timezone.ts`) for brand-new sessions
  with no prior timezone to inherit, and by using the *source session's own*
  `timezone` (already known and correct) for duplicate/reschedule instead of
  any default at all. A related bug found in the same sweep:
  `ScheduleCommandCentre.tsx`'s local `timeOfDay()` helper read
  `.getHours()`/`.getMinutes()` — the *viewing browser's* local clock, not
  the session's configured zone — used to seed a duplicate's time. Replaced
  with `zonedTimeString()`.
- **"Season Starts" now reads "Starts \*"** in `RRuleBuilder.tsx`, matching
  every other required field on the form.
- **Schedule groups now only require a start date to publish**, not an end
  date too — `POST /api/schedule-groups`, `PATCH
  /api/schedule-groups/[id]`, and `findPublishOverlap()`
  (`src/lib/schedule/publishOverlap.ts`) all updated so a null `ends_on` is
  treated as "runs forever" symmetrically on both sides of the overlap
  comparison, not just on the *other* schedule being compared against (which
  is all the pre-existing code handled).
- **The "Add session" schedule dropdown remembers the last one used**, via
  `localStorage` (`SessionForm.tsx`) — read on mount, written on every
  successful save, and only applied when nobody asked for a specific schedule
  (a deep link from "Add a session to X" still wins) and only while creating.
- **A new "Add another time…" action** on the session card's `⋯` menu
  (`AddAnotherTimeDialog.tsx`), the complement to the pre-existing
  "Duplicate to…" (which keeps the time fixed and varies day/space —
  discovered this already existed mid-implementation; the two are genuinely
  different tools). Asks only for start/end time; everything else — schedule,
  the day the clicked occurrence falls on, spaces, timezone, season — is
  copied from the source. Defaults the new start to the source's own end
  time, so stacking a contiguous next block (the PDF's dominant pattern) is
  the zero-typing case.

## P2 — Missing functionality (narrow, don't expand beyond this)

- **Lane/capacity status on a session.** The PDF's entire legend
  (red/1–2 lanes, blue/3–4 lanes, black/5+ lanes) has no home anywhere in the
  product today — not as a structured field, and not even as a rendered
  free-text note (tested: text typed into "Additional location detail" does
  not surface anywhere on the public schedule card). Add a small optional
  enum on Session — something like `availability: 'reduced' | 'limited' |
  'open'` — rendered as a colored pill on both the dashboard grid and the
  public schedule card. Keep the field optional and the enum short; this is
  explicitly the one piece of information the PDF's own legend calls
  load-bearing for real swimmers, not decoration.
- **A non-bookable day note.** "Camps In Pool, 12–1pm" in the PDF isn't a
  swim session — it's a caveat that reduces availability elsewhere. There's
  currently no way to represent it without misusing a Session (which would
  then wrongly render as something joinable) or the Events tab (built for
  titled, one-off public events, not a lightweight recurring caveat). Add a
  minimal way to attach a short text note to a day (optionally a time range)
  that renders visibly differently from a session — greyed out, no cost/age
  info, clearly not clickable/joinable.

## Constraints — read before writing any code

- **This list is the scope. Don't add anything beyond it** — no
  room-booking system, no waitlists, no cross-facility concepts. Check
  memory for `project_scope_not_a_marketplace` and
  `project_simplify_for_launch` before proposing anything not explicitly
  listed above: Dropin is a single-centre publishing tool and the current
  mandate is cutting scope for launch, not adding surface area.
- **Follow the existing verification-harness pattern**
  (`dropin/scripts/verify/*.mjs`, see its README) for every bug fix in the
  P0 section — a service-role-built fixture, a genuinely-signed-in user
  doing the acting, a positive control, teardown in a `finally`. A green
  `tsc`/`eslint`/`next build` is not proof anything here works — none of
  these bugs threw, and none would be caught by the type checker.
- **Don't trust a redirect or a toast as proof a save succeeded.** Verify by
  reading the row back (list view, or a DB query in the harness), the same
  way these bugs were originally found.
- **Add or update a README** on whatever module owns conflict detection and
  recurrence/timezone expansion once you've found it — neither currently
  has one, and both are non-obvious enough to have shipped two silent bugs.
- **`git status` first.** Don't assume the tree is clean. Only commit when
  asked.
