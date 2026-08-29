import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
} from "date-fns";

/**
 * ---------------------------------------------------------------------------
 * Two families of formatter live in this file, and picking the wrong one is a
 * silent bug rather than a crash.
 *
 * `formatTime` / `formatDayShort` / `formatDayFull` read the Date through the
 * **runtime's local getters** (`getHours`, `getDay`, ...) — the viewer's
 * browser on the client, UTC on the server. Correct for dates that are viewer
 * constructs: the week the user is paging through, "today" in a date picker,
 * a `created_at` audit line.
 *
 * `formatSessionTime` / `formatSessionDayShort` / `formatSessionDayFull` read
 * the Date through its **UTC getters** and are the ones to use for **session
 * occurrences**. A session's `start`/`end` Date carries its local wall-clock
 * time in its UTC slots by construction (see src/lib/rrule/README.md) — no
 * IANA zone is stored or needed, but reading it with the runtime-local
 * getters above would still be wrong on any machine not itself running in
 * UTC (every server render, most browsers), silently reintroducing the
 * "wrong hour / wrong day" bug this file's split exists to prevent.
 * ---------------------------------------------------------------------------
 */

export function formatTime(date: Date): string {
  return format(date, "h:mm a");
}

/** `formatTime` read via UTC getters. Use for session occurrences. */
export function formatSessionTime(date: Date): string {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `formatDayShort` read via UTC getters. Use for session occurrences. */
export function formatSessionDayShort(date: Date): string {
  return WEEKDAY_SHORT[date.getUTCDay()];
}

/** `formatDayFull` read via UTC getters. Use for session occurrences. */
export function formatSessionDayFull(date: Date): string {
  return `${WEEKDAY_LONG[date.getUTCDay()]}, ${MONTH_LONG[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Day-of-week index (0 = Sunday, matching `Date.prototype.getDay`) for a
 * session occurrence — `getUTCDay()` directly, since the UTC slots already
 * hold the local wall-clock date. Bucketing with the runtime-local `getDay()`
 * would drop early-morning sessions into the day before on any non-UTC
 * machine.
 */
export function zonedDayOfWeek(date: Date): number {
  return date.getUTCDay();
}

/** Minutes since midnight for a session occurrence, read via UTC getters. */
export function minutesOfDayIn(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * The Sunday (midnight, in the same UTC-slot convention session occurrence
 * Dates use) that a session occurrence falls in — read via UTC getters, like
 * `zonedDayOfWeek`, so it buckets by the weekday the session actually runs on
 * rather than the reader's runtime-local day. Use for grouping occurrences by
 * week (e.g. counting sessions per week in a week list); use `getWeekStart`
 * instead for viewer-owned dates (a week navigator's anchor, "today").
 */
export function sessionWeekStart(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

export function formatDate(date: Date): string {
  return format(date, "MMM d, yyyy");
}

export function formatDayShort(date: Date): string {
  return format(date, "EEE");
}

export function formatDayFull(date: Date): string {
  return format(date, "EEEE, MMMM d");
}

export function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 0 }); // Sunday
}

export function getWeekEnd(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: 0 }); // Saturday
}

export function nextWeek(date: Date): Date {
  return addWeeks(date, 1);
}

export function prevWeek(date: Date): Date {
  return subWeeks(date, 1);
}

export function getMonthStart(date: Date): Date {
  return startOfMonth(date);
}

export function getMonthEnd(date: Date): Date {
  return endOfMonth(date);
}

export function nextMonth(date: Date): Date {
  return addMonths(date, 1);
}

export function prevMonth(date: Date): Date {
  return subMonths(date, 1);
}

/**
 * The range a month *grid* actually displays: the calendar cells run from the
 * Sunday on or before the 1st to the Saturday on or after the last day, so a
 * grid fetching only `getMonthStart`–`getMonthEnd` renders its leading and
 * trailing cells empty even when sessions exist on those days.
 *
 * Weeks start Sunday here, matching getWeekStart and the weekly grid.
 */
export function getMonthGridRange(date: Date): { start: Date; end: Date } {
  return {
    start: getWeekStart(startOfMonth(date)),
    end: getWeekEnd(endOfMonth(date)),
  };
}

export function formatMonthLabel(date: Date): string {
  return format(date, "MMMM yyyy");
}

export function parseDate(iso: string): Date {
  return parseISO(iso);
}

/**
 * Local calendar date as "YYYY-MM-DD" (defaults to today). Use this instead
 * of `date.toISOString().split("T")[0]` for anything meant to represent "the
 * user's current day" — `toISOString()` converts to UTC first, which rolls
 * over to the next calendar date during evening hours in any timezone behind
 * UTC (all of North America), silently scheduling a "today" pick a day late.
 */
export function localDateString(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

/** ISO instant N days before now — for `.gte("occurred_at", ...)`-style query windows. */
export function daysAgoIso(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** A millisecond duration as "45s" or "3m 12s" — for widget/facility time-on-page stats. */
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Re-encodes a real Date's **runtime-local** calendar/clock reading into the
 * convention a session Date uses: those same digits stored in the UTC slots
 * (see rrule/README.md). Use this at the boundary where a viewer-owned date
 * (a week/month-range anchor computed via local Date arithmetic) is about to
 * be compared against or sent alongside session Dates — never earlier, since
 * date-fns/local Date arithmetic (getWeekStart, getMonthGridRange, ...)
 * needs the real runtime-local representation to compute the right calendar
 * day in the first place.
 */
export function toSessionTime(date: Date): Date {
  return new Date(Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()
  ));
}

/**
 * "Right now," re-encoded into the session-Date convention. Compare this —
 * never a plain `new Date()` — against `session.start`/`session.end`; a
 * session Date's real epoch is shifted by whatever the runtime's UTC offset
 * happens to be, so comparing it against a real instant is silently wrong by
 * that same offset.
 */
export function nowAsSessionTime(): Date {
  return toSessionTime(new Date());
}

/** `HH:MM` (24h) for a session occurrence, read via UTC getters — for building API payloads, not display (use formatSessionTime for that). */
export function sessionTimeString(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, "0");
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** `YYYY-MM-DD` for a session occurrence, read via UTC getters (see nowAsSessionTime). */
export function sessionDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Convert a time string like "09:30" into minutes from midnight */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Convert minutes from midnight into a display string like "9:30 AM" */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}
