# Remove timezone as a concept

## Why

A session is attended in person, at one facility, by people already local to
it. There is no viewer for whom "6:00 AM Pacific" needs converting — it's
just 6:00 AM. Treating session time as a real UTC instant plus an IANA zone
to reverse it was solving a cross-timezone-audience problem this product
doesn't have, and every schedule-input bug found this cycle traces back to
it: the P0 bugs (`RESUME-schedule-input-fixes.md`) were rrule.js losing the
intended weekday/duration once dtstart's real instant crossed a UTC calendar
boundary or a DST transition, and three of the five P1 items were separate
call sites (`ScheduleCommandCentre.tsx`'s create/duplicate/reschedule
handlers, the bulk CSV importer) each hardcoding or re-deriving "which
timezone" independently, with no way to keep them consistent by
construction. Removing the concept removes the whole bug class at its root
instead of patching each call site as it's found.

Decided 2026-08-16: full removal (storage + app layer), not just hiding the
picker from the UI. See [[project_schedule_input_bugs_2026_08_15]] and
`RESUME-schedule-input-fixes.md` for the bugs this closes out.

## Target model

`dtstart` stays `TIMESTAMPTZ` — no column type change, so every consumer
that already parses it as an ISO string with `new Date(...)` keeps working
unmodified at the type level. What changes is *meaning*: the stored digits
**are** the session's local wall-clock date/time, full stop. Written with a
literal `Z` for whatever wall-clock values were entered, read back via
`getUTCHours()`/`getUTCDate()`/etc., and **never** converted through
`Intl.DateTimeFormat` with a `timeZone` option or any offset math again.

This is not a new trick — it's exactly the "floating DTSTART" detour
`src/lib/rrule/expand.ts` already builds internally before handing a value
to `rrule.js` (see that file's header comment), because rrule's own calendar
arithmetic has no notion of a zone and needs wall-clock digits to get
`BYDAY` right. Today that floating value is *derived* from the real stored
instant on every read, then the result is re-anchored back to a real instant
afterward. This migration promotes the floating representation to be the
actual storage format, so the derive/re-anchor round-trip disappears
entirely rather than being done correctly in more places.

`dtend_time` (a `TIME` column) needs no change — it was already zone-less
wall-clock time.

## Schema migration

`supabase/migrations/034_remove_timezone.sql` (written, **not yet applied**
to the dev database — schema-altering and drops a column, which is why this
stopped at "design" rather than running it):

1. Backfill `sessions.dtstart`: reinterpret each row's current real instant
   as the wall-clock reading in its *own* `timezone` column, then store
   those digits as if they were already UTC — `(dtstart AT TIME ZONE
   timezone) AT TIME ZONE 'UTC'`. Both `AT TIME ZONE` calls are explicit, so
   this doesn't depend on the connection's `TimeZone` GUC.
2. Same backfill for `session_exceptions.modified_start` /
   `modified_end`, joined to the *parent session's* timezone (that table has
   none of its own).
3. `ALTER TABLE sessions DROP COLUMN timezone`.
4. Updated column comment on `dtstart` documenting the new meaning in place.

No rollback script — reversing would require re-picking a timezone for every
row with no source of truth for what it originally was (the column will be
gone). If this needs undoing, restore from a pre-migration backup rather
than trying to invert it.

## Application-layer follow-up (not done yet — this doc is the design half)

Everything below is scoped by `grep -rl timezone src/`. Grouped by what
needs to happen, not file order:

**Delete outright**
- `src/lib/utils/timezone.ts` — `zonedTimeToUtc`, `zonedTimeString`,
  `zonedDateString`, `provinceToTimezone`, `PROVINCE_TIMEZONE`,
  `DEFAULT_APP_TIMEZONE`. Nothing needs a zone conversion anymore.

**Collapse to one formatter family**
- `src/lib/utils/dates.ts` — `formatTimeIn`/`formatDayShortIn`/
  `formatDayFullIn`/`zonedDayOfWeek`/`minutesOfDayIn` currently take a
  `timeZone` param and go through `Intl.DateTimeFormat`. Since a session's
  Date object's *UTC* components are now always the literal wall-clock
  digits, these become direct `getUTCHours()`/`getUTCDay()`/etc. reads with
  no `Intl`/zone involved — same function names, no `timeZone` parameter.
  **Keep them as a distinct family from `formatTime`/`formatDayShort`/
  `formatDayFull`** (which stay viewer-runtime-zone, unchanged) — the
  distinction that matters is no longer "which zone" but "is this Date a
  session occurrence (read via UTC getters) or a viewer-owned construct like
  `created_at` (read via runtime-local getters)." Collapsing that
  distinction away would silently reintroduce the bug this whole migration
  removes, just by a different mechanism (someone reads a session Date with
  local instead of UTC getters and it drifts on any local machine not in
  UTC). Reword the file's header comment accordingly.

**RRULE expansion — real simplification, not just a rename**
- `src/lib/rrule/expand.ts`: `floatingDtstartLine` no longer derives
  anything — dtstart's own UTC getters are already the wall-clock digits, so
  it's a straight format, no `timeZone` argument. The re-anchoring step
  inside `expandOccurrenceTimes` (`zonedTimeToUtc(dateKey, localTime,
  session.timezone)`) is deleted outright — `floating` from `rule.between()`
  *is* the final occurrence start now. `buildEndTime` loses its `timeZone`
  param, becomes a plain `Date.UTC(...)` construction from
  `occurrenceStart`'s UTC date + `dtend_time`. Drop `timezone` from every
  `Pick<SessionRow, ...>` in this file, and from `ExpandedSession` in
  `src/types/schedule.types.ts`. Rewrite this file's header comment and
  `src/lib/rrule/README.md` — they currently describe the exact bug this
  migration closes; that history is worth keeping as a "why this looks
  simple" note, not deleting, but the "here's the subtle re-anchoring you
  must not skip" framing needs to go since there's nothing left to skip.
- `src/lib/sessions/conflicts.ts`: drop `timezone` from the `CandidateSession`
  type and the two spots that read/pass it through — the interval-overlap
  math itself (`c.start < o.end && o.start < c.end`) is untouched, it was
  already comparing whatever Date objects expansion handed it.

**Storage-adjacent writers** (build a `dtstart` from user input)
- `src/components/schedule-editor/SessionForm.tsx` — remove the timezone
  `<select>`, `timezoneTouched` state, and the effect deriving it from
  facility province. Build `dtstart` directly from date+time strings with a
  literal `Z` suffix (no `zonedTimeToUtc`).
- `src/components/schedule-command/ScheduleCommandCentre.tsx` — all four
  handlers (`handleConfirmCreate`, `handleConfirmDuplicate`,
  `handleConfirmReschedule`, `handleConfirmAddTime`) currently thread a
  `timezone` through to `zonedTimeToUtc`/`zonedTimeString`; all four instead
  build/read the literal digits directly. This is where three of the P1
  bugs lived — worth an extra pass of manual testing on drag-to-reschedule
  specifically once this lands, since it has no dedicated harness assertion
  today.
- `src/components/schedule/editing/{AddAnotherTimeDialog,
  DuplicateSessionDialog,RescheduleConfirmDialog}.tsx` — drop `timezone`
  from whatever local types/props they carry (e.g.
  `RescheduleTarget.timezone` added this cycle).
- `src/app/api/sessions/route.ts` — drop the `timezone` Zod field (currently
  `z.string().default("America/Edmonton")`) and its use in the insert.
- `src/app/api/sessions/[sessionId]/route.ts` — drop `timezone` from the
  `.select()` and the reschedule-conflict-check payload.
- `src/app/api/sessions/[sessionId]/exceptions/route.ts` — drop the
  `zonedTimeToUtc` import and its two uses building
  `modified_start`/`modified_end`; build those directly from
  `exception_date` + the time strings.
- `src/app/api/import/commit/route.ts` — same pattern, currently hardcodes
  `"America/Edmonton"` in two places (the bug class's fourth instance, not
  caught by the P1 sweep because this route wasn't touched then). Confirm
  this route is still reachable before spending time on it — `data-sources/
  page.tsx` is its only known caller and hasn't been checked against the
  dead-code findings in [[project_launch_audit_2026_08_12]].

**Type/schema surface**
- `src/types/database.types.ts` — regenerate from the DB (Supabase CLI) once
  migration 034 is applied, rather than hand-editing; it should drop
  `timezone` from the `sessions` Row/Insert/Update types on its own.
- `src/components/schedule-command/types.ts` — drop `province` from
  `CommandFacility` *only if* nothing else needs it; check first; it may
  still be used for e.g. address display independent of timezone.

**Read-only display consumers** (just drop the now-unused `timezone` prop/arg)
- `src/components/schedule/{EventCalendarView,FloorplanView,SessionModal,
  SpaceDetailSheet,WeeklyScheduleGrid,WeeklyScheduleList,
  WeeklyScheduleMap}.tsx`
- `src/components/brochure/BrochureDocument.tsx`
- `src/lib/rrule/validate.ts`
- `src/lib/seasons/current.ts` — check this one specifically before editing:
  its `timezone` mention is about "what day is *right now*," a genuinely
  different, still-real concern (the viewer/server's runtime clock) from a
  session's stored time — see `localDateString()`'s doc comment in
  `dates.ts`. Confirm it isn't actually using a session's `timezone` column
  for that before touching it.

## Verification plan

`verify-f.mjs` and `verify-g.mjs` both build fixtures with an explicit
`timezone` field and assert DST/offset behavior that no longer exists once
this lands — they need rewriting, not just re-running:
- Drop every DST-boundary assertion in `verify-f` (section on the Nov 2026
  fall-back) — there's nothing left to drift, by construction.
- Drop the `timezone` field from every fixture session insert across both
  files (`POST /api/sessions`, `PATCH`, raw `admin.from("sessions").insert`).
- Add a new assertion worth having that didn't make sense before: create a
  session with an explicit evening time (e.g. `20:00`), read it back through
  `GET /api/sessions/expand`, and assert the returned hour/day are
  byte-identical to what was submitted — a direct regression test for the
  exact P0 "lands on the day before" bug class, now asserting "there is no
  conversion" rather than "the conversion is correct."
- `verify-b`/`verify-d`/`verify-e` don't touch `sessions.timezone` directly
  and shouldn't need changes — re-run them clean as a sanity check anyway,
  same as every prior cycle.

## Constraints carried over from RESUME-schedule-input-fixes.md

- **Don't trust a green `tsc`/`eslint`/`next build` as proof** — none of the
  original bugs threw, and a stale `Intl` call with a hardcoded zone
  wouldn't either. Verify against the running app + real DB reads, per
  [[feedback_verify_dont_assume_dropin]].
- **`git status` first.** This migration file exists on disk but has not
  been applied, and no application code has been touched yet — the tree
  should currently show only this doc and the one new migration file as
  new/uncommitted from this pass.
- Follow [[feedback_verification_harness_pattern]] for whatever new
  assertions get added: service-role fixtures, a genuinely signed-in user
  acting, a positive control alongside every negative one, teardown in a
  `finally`.
