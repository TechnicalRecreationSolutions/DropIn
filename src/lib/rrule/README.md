# RRULE expansion

`expand.ts` turns a session's stored `rrule` + `dtstart` into concrete
occurrence time ranges. `expandOccurrenceTimes()` is the shared core — it's
what the schedule grid, the public page, and `src/lib/sessions/conflicts.ts`
(session-level conflict detection) all build on. Don't re-derive any of this
in a second place; wrap `expandOccurrenceTimes()` instead.

## The one thing to know before touching this file

**`sessions.dtstart` holds local wall-clock digits directly, with no real
instant meaning.** Written and read as an ISO string with a literal `"Z"`
suffix, but that `"Z"` does not mean UTC — it means "these are the digits,
don't convert them." A 6:00 PM session's `dtstart` reads `T18:00:00Z`
regardless of which facility, in which province, is running it. There is no
`timezone` column (removed by `034_remove_timezone.sql` — see
`dropin/docs/RESUME-timezone-removal.md` for why: a session is attended in
person by someone already local to it, so "convert to the viewer's zone" was
solving a problem this product doesn't have).

This is also exactly the representation `rrule.js` itself wants — it has no
concept of "local time" and advances DTSTART by fixed calendar increments
against that instant's raw numeric components, never re-deriving a
wall-clock time from a zone. Because dtstart's digits already *are* the
wall-clock date/time, `expandOccurrenceTimes()` hands them to rrule directly
(`dtstartLine()`) with no conversion, and every generated occurrence comes
back already correct — `BYDAY=MO` matches the calendar day a human actually
picked, full stop.

**Read start/end via UTC getters** (`getUTCHours()`, `getUTCDate()`, ...) —
`src/lib/utils/dates.ts`'s `formatSessionTime`/`formatSessionDayFull`/
`sessionDateString`/`sessionTimeString`/`nowAsSessionTime` do this for you.
Reading a session Date via the *runtime-local* getters
(`formatTime`/`getDay()`/`new Date().toDateString()`, ...) reads a different,
wrong wall-clock value on any machine not itself running in UTC — that
family is for real instants (`created_at`, "today" in a date picker), never
for a session occurrence.

## Historical note: why this used to be much harder

Before the migration above, sessions carried an IANA `timezone` column and
`dtstart` was a real UTC instant. Handing that real instant straight to
rrule broke in two distinct ways, and both are why this file — and its test
harness — exist in their current shape:

- **Evening starts landed on the wrong weekday.** If the local start time
  was late enough that converting it to UTC crossed midnight (e.g. 9pm
  `America/Vancouver` is 4am UTC the *next* day), DTSTART's UTC calendar day
  no longer matched the local calendar day the session was authored against,
  and the generated occurrence landed a day *before* the intended weekday.
- **Sessions drifted out of sync with themselves across a DST boundary.**
  rrule's generated occurrence kept DTSTART's original UTC offset baked in
  forever, silently shifting by the DST delta the first time a
  spring-forward/fall-back boundary was crossed — while `buildEndTime()`
  correctly re-derived the end from each occurrence's local calendar date
  every time. That divergence was enough to manufacture a real (if
  unintended) time-range overlap with a neighbouring session that was never
  supposed to touch it.

The fix at the time was a *floating* (no real-instant) DTSTART derived from
the timezone column on every read, then re-anchored back to a real instant
afterward. Removing the timezone column entirely made that floating
representation the permanent storage format instead of a per-read detour —
the derive/re-anchor round-trip this section used to describe no longer
exists, because there's nothing left to derive it from or re-anchor it to.

`scripts/verify/verify-f.mjs` covers the mechanics this file depends on
(recurrence expansion, conflict detection, exception handling) — run it
after touching anything in here.
