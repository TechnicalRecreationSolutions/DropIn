import type { OccupancyLevel, ReadingMetric } from "@/types/app.types";

/**
 * The reading domain: what each metric is called, what it may hold, and how
 * long a reading is worth showing.
 *
 * Client-safe — the input tool, the public conditions block and the API route
 * all read from here, and a bound enforced in one of them and not the others
 * is the bug this file exists to prevent.
 *
 * The database is still the control. Every range below has a matching CHECK in
 * `061_facility_readings.sql`; these exist so a person gets "that looks like
 * Fahrenheit" instead of a constraint violation.
 */

export const READING_METRICS = [
  "headcount",
  "water_temp_c",
  "air_temp_c",
] as const satisfies readonly ReadingMetric[];

export const OCCUPANCY_LEVELS = [
  "quiet",
  "moderate",
  "busy",
  "full",
] as const satisfies readonly OccupancyLevel[];

interface MetricSpec {
  /** Staff-facing name, on the input tool. */
  label: string;
  /** Patron-facing name, on the public page. Often shorter and never jargon. */
  publicLabel: string;
  /** The suffix a value is rendered with. "" for a count. */
  unit: string;
  min: number;
  max: number;
  /** Whole numbers only? Head counts are; temperatures are not. */
  integer: boolean;
  /**
   * How long this reading still describes "now", in minutes.
   *
   * These are presentation rules, not storage rules — past them the number is
   * still true about the past and is reported that way ("usually about 35 at
   * this time") rather than hidden. The database applies a blunt 24-hour cap
   * underneath, so nothing here can publish a day-old count by forgetting.
   *
   * A head count goes stale fast: a pool empties in twenty minutes when a
   * lesson block ends. Water temperature barely moves in an afternoon, so an
   * hours-old reading is still the honest answer.
   */
  freshMinutes: number;
}

export const METRICS: Record<ReadingMetric, MetricSpec> = {
  headcount: {
    label: "People",
    publicLabel: "People here",
    unit: "",
    min: 0,
    max: 9999,
    integer: true,
    freshMinutes: 90,
  },
  water_temp_c: {
    label: "Water temperature",
    publicLabel: "Water",
    unit: "°C",
    min: -20,
    max: 50,
    integer: false,
    freshMinutes: 12 * 60,
  },
  air_temp_c: {
    label: "Air temperature",
    publicLabel: "Air",
    unit: "°C",
    min: -20,
    max: 50,
    integer: false,
    freshMinutes: 12 * 60,
  },
};

/** "27.5 °C", "42". Rounded the way each metric is read aloud. */
export function formatReading(metric: ReadingMetric, value: number): string {
  const spec = METRICS[metric];
  const n = spec.integer ? Math.round(value) : Math.round(value * 10) / 10;
  return spec.unit ? `${n} ${spec.unit}` : `${n}`;
}

/** Is this reading recent enough to describe the present? */
export function isFresh(
  metric: ReadingMetric,
  recordedAt: string,
  now: Date = new Date()
): boolean {
  const age = (now.getTime() - new Date(recordedAt).getTime()) / 60_000;
  return age >= 0 && age <= METRICS[metric].freshMinutes;
}

/**
 * How a reading's age reads to a patron: "2:15 PM", "Yesterday, 4:40 PM".
 *
 * **Always shown, never optional.** A number without its age is a claim about
 * now that may be four hours old, and the whole reason to publish a head count
 * is that someone is deciding whether to leave the house. Absolute rather than
 * relative ("20 minutes ago") so the string survives being rendered into a
 * cached page.
 */
export function formatRecordedAt(recordedAt: string, now: Date = new Date()): string {
  const at = new Date(recordedAt);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

  return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** What each busyness band says to a patron. */
export const LEVEL_LABEL: Record<OccupancyLevel, string> = {
  quiet: "Quiet",
  moderate: "Moderately busy",
  busy: "Busy",
  full: "At capacity",
};

/**
 * Minutes to ADD to UTC to reach the runtime's local clock.
 *
 * What `facility_public_conditions(p_utc_offset_minutes)` expects. Postgres
 * cannot know the local zone — migration 036 removed the stored one and every
 * calendar surface in this app reads the runtime's instead — so the caller
 * supplies it, and this is the one place the sign convention is written down.
 * `getTimezoneOffset()` returns minutes BEHIND UTC, hence the negation.
 */
export function localUtcOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset();
}
