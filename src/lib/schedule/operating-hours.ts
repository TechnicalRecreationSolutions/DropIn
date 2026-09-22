import type { Database } from "@/types/database.types";

type DepartmentHoursRow = Database["public"]["Tables"]["department_hours"]["Row"];

/**
 * Department operating hours, in one place because four layers have to agree
 * on them: the hours editor writes them, POST /api/sessions validates against
 * them, expandOccurrenceTimes() resolves occurrence times from them, and
 * conflicts.ts reasons about the result (migration 058).
 *
 * THE ONE THING TO KNOW: `day_of_week` is 0=Sunday..6=Saturday, matching
 * `getUTCDay()` — and UTC getters are how a session occurrence's weekday MUST
 * be read, because session dates are local wall-clock digits carrying a
 * meaningless "Z" (see src/lib/rrule/README.md). Reading an occurrence's day
 * with the runtime-local `getDay()` returns a different weekday on any machine
 * not itself running in UTC, which here would silently apply Tuesday's hours
 * to a Monday session. There is no conversion anywhere in this file for the
 * same reason there is none in expand.ts.
 */

/** One open/close window, as minutes from midnight. */
export interface OperatingWindow {
  /** Minutes from midnight, inclusive. */
  opens: number;
  /** Minutes from midnight, exclusive. Always > opens. */
  closes: number;
}

/** A department's whole week. Index is `getUTCDay()`: 0=Sunday..6=Saturday. */
export type WeeklyOperatingHours = readonly OperatingWindow[][];

/**
 * A department's whole answer: the recurring week, plus the specific dates
 * that depart from it (migration 059).
 *
 * `overrides` is keyed by "YYYY-MM-DD" and READ BEFORE the week. An entry with
 * an empty array means closed that date — which is the opposite reading of an
 * empty day in `week`, where absence is how closed is spelled, but here the
 * absence of a KEY means "nothing special, use the week". The two are easy to
 * confuse and the tables behind them are documented as such (059's header).
 */
export interface DepartmentOperatingHours {
  week: WeeklyOperatingHours;
  overrides: ReadonlyMap<string, readonly OperatingWindow[]>;
}

/** Hours for every department that might be asked about, keyed by department id. */
export type OperatingHoursByDepartment = ReadonlyMap<string, DepartmentOperatingHours>;

/** What a department with nothing configured looks like. */
export function emptyOperatingHours(): DepartmentOperatingHours {
  return { week: emptyWeek(), overrides: new Map() };
}

/** Sunday-first, matching the index order of WeeklyOperatingHours. */
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Sunday-first short labels, for the editor's day column and the form's summary. */
export const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** An empty week — every day closed. The shape callers get for a department
 *  that has never had hours entered, so nothing has to null-check a week. */
export function emptyWeek(): OperatingWindow[][] {
  return [[], [], [], [], [], [], []];
}

/**
 * "HH:MM" or "HH:MM:SS" -> minutes from midnight.
 *
 * Returns null rather than NaN for anything unparseable, so a malformed row
 * is dropped by the caller instead of poisoning arithmetic downstream — a NaN
 * window silently makes every comparison false, which would read as "closed"
 * in some places and "open forever" in others.
 */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Minutes from midnight -> "HH:MM", the format the TIME column and <input
 *  type="time"> both take. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "6:00 AM" style, for hints and summaries. Presentation only. */
export function minutesToLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Groups raw `department_hours` rows into a week per department.
 *
 * Rows with unparseable or inverted times are dropped rather than repaired.
 * The CHECK constraint in migration 058 already makes both impossible through
 * the database; this is the belt for a row that arrived some other way, and
 * dropping is the safe direction — a dropped window closes the day, which
 * produces no occurrence, rather than inventing one at a time nobody entered.
 */
export function groupHoursByDepartment(
  rows: Pick<DepartmentHoursRow, "department_id" | "day_of_week" | "opens_at" | "closes_at">[],
  /** Holiday rows and their windows (059). Omitted by callers that only need
   *  the recurring week, such as the hours editor. */
  holidays: HolidayInput[] = []
): Map<string, DepartmentOperatingHours> {
  const weeks = new Map<string, OperatingWindow[][]>();

  for (const row of rows) {
    if (row.day_of_week < 0 || row.day_of_week > 6) continue;
    const opens = timeToMinutes(row.opens_at);
    const closes = timeToMinutes(row.closes_at);
    if (opens === null || closes === null || closes <= opens) continue;

    let week = weeks.get(row.department_id);
    if (!week) {
      week = emptyWeek();
      weeks.set(row.department_id, week);
    }
    week[row.day_of_week].push({ opens, closes });
  }

  // Sorted and merged so downstream can assume windows are ordered and
  // non-overlapping — expansion emits one occurrence per window, and two
  // overlapping windows would emit two overlapping occurrences of the same
  // session, which the conflict engine would then report as the session
  // colliding with itself.
  for (const week of weeks.values()) {
    for (let day = 0; day < 7; day++) {
      week[day] = mergeWindows(week[day]);
    }
  }

  const overrides = new Map<string, Map<string, OperatingWindow[]>>();

  for (const holiday of holidays) {
    // 'normal_hours' writes NO entry. The day is ordinary, and an entry would
    // have to duplicate the week to say so — then go stale the moment the
    // week changed. Falling through is both simpler and self-maintaining.
    if (holiday.observance === "normal_hours") continue;

    const windows: OperatingWindow[] = [];
    if (holiday.observance === "custom_hours") {
      for (const w of holiday.windows ?? []) {
        const opens = timeToMinutes(w.opens_at);
        const closes = timeToMinutes(w.closes_at);
        if (opens === null || closes === null || closes <= opens) continue;
        windows.push({ opens, closes });
      }
    }

    // 'closed' lands here with an empty array, and so does a 'custom_hours'
    // holiday whose windows are all missing or malformed — "open, hours
    // unspecified" is not a schedule, and closing is the safe reading (059).
    let forDepartment = overrides.get(holiday.department_id);
    if (!forDepartment) {
      forDepartment = new Map();
      overrides.set(holiday.department_id, forDepartment);
    }
    forDepartment.set(holiday.holiday_date, mergeWindows(windows));
  }

  // A department can appear in either map alone: hours but no holidays, or a
  // Christmas closure entered before anyone set the weekly pattern.
  const result = new Map<string, DepartmentOperatingHours>();
  for (const id of new Set([...weeks.keys(), ...overrides.keys()])) {
    result.set(id, {
      week: weeks.get(id) ?? emptyWeek(),
      overrides: overrides.get(id) ?? new Map(),
    });
  }

  return result;
}

/** One holiday plus its windows, as the query layer assembles it (059). */
export interface HolidayInput {
  department_id: string;
  /** "YYYY-MM-DD". */
  holiday_date: string;
  observance: "closed" | "custom_hours" | "normal_hours";
  windows?: { opens_at: string; closes_at: string }[];
}

/**
 * Sorts windows and merges any that overlap or touch.
 *
 * Touching windows (06:00-12:00 and 12:00-21:00) merge into one, because as
 * two occurrences they would render as two adjacent blocks with a seam the
 * patron cannot explain — the building never closed. Genuine gaps are
 * preserved, which is the entire reason windows are a list.
 *
 * Also the editor's save path: staff who enter overlapping windows get them
 * merged rather than an error, since there is exactly one sane reading of
 * "open 6-12 and 11-9".
 */
export function mergeWindows(windows: OperatingWindow[]): OperatingWindow[] {
  if (windows.length <= 1) return [...windows];

  const sorted = [...windows].sort((a, b) => a.opens - b.opens || a.closes - b.closes);
  const merged: OperatingWindow[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.opens <= last.closes) {
      // Overlapping or touching — extend, never shrink.
      if (next.closes > last.closes) last.closes = next.closes;
    } else {
      merged.push({ ...next });
    }
  }

  return merged;
}

/**
 * True when the department opens at some point during the recurring week. A
 * department with no open window anywhere cannot offer the all-day option.
 *
 * Deliberately ignores holiday overrides (059). Those say how specific dates
 * DEPART from the week, so a department whose only configuration is "closed
 * Christmas Day" has still never said when it is open, and a session
 * following it would have nothing to resolve for the other 364 days.
 */
export function hasAnyWindow(hours: DepartmentOperatingHours | undefined): boolean {
  if (!hours) return false;
  return hours.week.some((day) => day.length > 0);
}

/**
 * The widest window of a given weekday — earliest open to latest close,
 * spanning any midday gap.
 *
 * This is ONLY for the `dtstart`/`dtend_time` snapshot written when a
 * following session is saved (migration 058 §2), and for the fixed-time
 * fallback when hours cannot be resolved. It deliberately flattens the gap,
 * because those columns can hold exactly one range and "the whole span" is
 * the least surprising thing for a raw reader to find there. Nothing that
 * renders a schedule uses this — the grid, widget, print view and conflict
 * engine all go through resolveOperatingWindows below, which keeps the gap.
 */
export function widestWindowOfDay(
  week: WeeklyOperatingHours | undefined,
  dayOfWeek: number
): OperatingWindow | null {
  const day = week?.[dayOfWeek];
  if (!day || day.length === 0) return null;
  return {
    opens: day[0].opens,
    closes: day[day.length - 1].closes,
  };
}

/**
 * The first weekday, scanning forward from `startDayOfWeek`, that has any open
 * window — or null if the week is entirely closed.
 *
 * Used when saving a following session whose own start day happens to be
 * closed: the snapshot still needs *some* plausible range, and the next open
 * day is a better guess than midnight-to-midnight.
 */
export function firstOpenDayFrom(
  week: WeeklyOperatingHours | undefined,
  startDayOfWeek: number
): number | null {
  if (!week) return null;
  for (let offset = 0; offset < 7; offset++) {
    const day = (startDayOfWeek + offset) % 7;
    if (week[day].length > 0) return day;
  }
  return null;
}

/**
 * The windows a following session should produce on one occurrence date.
 *
 * A holiday override for that exact date wins outright over the weekly
 * pattern (059) — that is the whole point of one, and a Christmas Day closure
 * has to beat "Fridays are 06:00-21:00". Absence of an override, not an empty
 * one, is what falls through to the week.
 *
 * Returns an empty array for a closed day, which the caller turns into "no
 * occurrence at all" — not a zero-length one. A patron should not be able to
 * tell "we are shut" from "we are open and nothing is booked"; both are an
 * empty spot on the grid.
 */
export function resolveOperatingWindows(
  hours: DepartmentOperatingHours | undefined,
  /** "YYYY-MM-DD" of the occurrence, in the wall-clock convention. */
  dateKey: string,
  /** `getUTCDay()` of the same occurrence — passed in rather than re-derived
   *  here, so there is exactly one place that reads a weekday off a session
   *  Date and it is the one with the warning next to it. */
  dayOfWeek: number
): readonly OperatingWindow[] {
  if (!hours) return [];
  const override = hours.overrides.get(dateKey);
  if (override !== undefined) return override;
  return hours.week[dayOfWeek] ?? [];
}

/**
 * A one-line summary of a week, for the session form and the department page
 * ("Mon-Fri 6:00 AM - 9:00 PM, Sat 8:00 AM - 6:00 PM, Sun closed").
 *
 * Consecutive days sharing an identical shape are collapsed into a range.
 * Starts on Monday rather than Sunday — the index convention is a machine
 * detail, and "Mon-Fri" is what staff expect to read.
 *
 * The recurring week only. Holiday overrides (059) are dates, not a pattern,
 * and folding them in would turn a one-line summary into a calendar.
 */
export function summarizeWeek(week: WeeklyOperatingHours | undefined): string {
  if (!week || !week.some((day) => day.length > 0)) return "No operating hours set";

  const order = [1, 2, 3, 4, 5, 6, 0];
  const shape = (day: number) => {
    const windows = week![day];
    if (windows.length === 0) return "closed";
    return windows.map((w) => `${minutesToLabel(w.opens)}–${minutesToLabel(w.closes)}`).join(", ");
  };

  const parts: string[] = [];
  let runStart = 0;

  for (let i = 1; i <= order.length; i++) {
    const sameAsRun = i < order.length && shape(order[i]) === shape(order[runStart]);
    if (sameAsRun) continue;

    const from = DAY_LABELS_SHORT[order[runStart]];
    const to = DAY_LABELS_SHORT[order[i - 1]];
    const label = runStart === i - 1 ? from : `${from}–${to}`;
    const value = shape(order[runStart]);
    parts.push(value === "closed" ? `${label} closed` : `${label} ${value}`);
    runStart = i;
  }

  return parts.join(", ");
}
