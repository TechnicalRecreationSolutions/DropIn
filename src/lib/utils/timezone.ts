/**
 * Sessions are authored as wall-clock time in a specific IANA timezone (the
 * `timezone` column) but stored/expanded as UTC instants. `new Date(...).toISOString()`
 * silently interprets the wall-clock string in whichever timezone the *running*
 * JS engine happens to be in — the browser's when a session is created, the
 * server's when it's expanded — not the timezone the time actually represents.
 * These helpers do the conversion explicitly so the result is correct
 * regardless of where the code runs.
 */

/** Default timezone assumed where a session doesn't collect its own (e.g. the schedule builder). */
export const DEFAULT_APP_TIMEZONE = "America/Edmonton";

/** Converts a wall-clock "YYYY-MM-DD" + "HH:MM" in `timeZone` into the equivalent UTC Date. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const asUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  const offset = zonedOffsetMs(asUtc, timeZone);
  return new Date(asUtc.getTime() - offset);
}

/** The "YYYY-MM-DD" wall-clock date a UTC instant falls on within `timeZone`. */
export function zonedDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** How far `timeZone`'s wall clock is ahead of UTC at `date`, in ms (negative west of UTC). */
function zonedOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const asZoned = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
  );
  return asZoned.getTime() - date.getTime();
}
