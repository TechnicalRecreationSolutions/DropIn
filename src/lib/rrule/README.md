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

## Sessions that follow operating hours (migration 058)

A session with `follows_operating_hours = TRUE` does not carry its own times.
Each occurrence's start/end is resolved, **at expansion time**, from the
owning department's `department_hours` rows — so changing a department's
hours moves every session that follows them, with nothing to re-save and no
copy to go stale.

That resolution happens in exactly one place: `expandOccurrenceTimes()`. It
is why the grid, the public widget, the print view, the deck sheet and the
conflict engine are all correct at once, and it is why a new caller must pass
hours in rather than re-deriving them. Use `fetchOperatingHours()`
(`src/lib/schedule/operating-hours-query.ts`) to load them, and see
`src/lib/schedule/operating-hours.ts` for the vocabulary.

Four things that will bite otherwise:

- **One date can now produce more than one occurrence.** A department that
  closes midday has two Monday windows, so a following session yields two
  Monday blocks. `OccurrenceTime.windowIndex` distinguishes them, and
  `ExpandedSession.key` appends `_w1` onward — anything keying on
  `sessionId + date` alone is now ambiguous. (`session_exceptions` is not: it
  keys on the date deliberately, and a cancel drops every window of it.)
- **A closed weekday produces no occurrence at all**, not a zero-length one.
- **A `modified` exception collapses the date to a single occurrence** at the
  overridden times. Applying it per window would duplicate one correction
  across two blocks.
- **`dtstart`/`dtend_time` are not the truth for these sessions.** They stay
  populated as an RRULE anchor and a stale-tolerant snapshot, derived
  server-side in `POST /api/sessions` from the same hours expansion uses (see
  migration 058 §2). Reading them directly to render a following session is
  the bug this design exists to prevent. When hours cannot be resolved at
  all — no department, or every window deleted — expansion deliberately falls
  back to them rather than emptying the schedule.

`DTSTART`'s time component is anchored to midnight for these sessions, so the
arbitrary snapshot time cannot decide whether a *day* falls inside the
requested range. Which weekdays the rule generates is unaffected.

### Holidays (migration 059)

`DepartmentOperatingHours` is `{ week, overrides }`. `overrides` is keyed by
`"YYYY-MM-DD"` and is read **before** the weekly pattern, so a Christmas Day
closure beats "Fridays are 06:00–21:00". An override holding an empty array
means closed; the *absence of a key* is what falls through to the week.

Watch the inversion between the two tables behind this:

| | no row / no key |
|---|---|
| `department_hours` (058) | that weekday is **closed** |
| `department_holidays` (059) | that date is **ordinary** — use the week |

`observance` is what separates `closed` from `normal_hours`, since both store
zero window rows. A `custom_hours` holiday with no usable windows resolves as
closed, because "open, hours unspecified" is not a schedule.

Holidays bind only sessions that follow the hours. A fixed-time session runs
on Christmas exactly as before — cancel it with a `session_exception` if that
is wrong. And `hasAnyWindow()` deliberately ignores overrides: a department
whose only configuration is "closed Christmas Day" has still never said when
it is open, so nothing can follow it.

## Verifying

`scripts/verify/verify-f.mjs` covers the mechanics this file depends on
(recurrence expansion, conflict detection, exception handling) — run it
after touching anything in here.

`scripts/verify/verify-as.mjs` covers the operating-hours resolution above.
Its section 0 imports this module directly and needs no database or server:

```bash
node --experimental-strip-types scripts/verify/verify-as.mjs --logic-only
```

Run that first after any change in here — it is the fastest signal, and a
failure there tells you the problem is the arithmetic rather than the schema.
