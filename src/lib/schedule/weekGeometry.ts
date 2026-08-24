/**
 * Weekly schedule geometry shared by every time-axis view — the public
 * WeeklyScheduleGrid, the public WeeklyScheduleMap (space columns on a time
 * axis), and the dashboard builder's Grid/Space views. Single source of
 * truth so pixel math and drag-drop math never drift apart between views.
 */

import { minutesOfDayIn, zonedDayOfWeek } from "@/lib/utils/dates";

export const SLOT_HEIGHT_PX = 48; // Height of each 30-minute slot
export const SLOT_MINUTES = 30;
export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 22;

/**
 * Pixel top/height for a session occurring between start/end, relative to a
 * grid starting at gridStartHour. `start`/`end` must be session occurrence
 * Dates (UTC-getter convention, see rrule/README.md) — minutesOfDayIn reads
 * them via UTC getters, so a runtime-local read here would both mislabel and
 * *mis-position* the block.
 */
export function getSessionPixelPosition(
  start: Date,
  end: Date,
  gridStartHour = GRID_START_HOUR,
  gridEndHour = GRID_END_HOUR
): { top: number; height: number } {
  const gridStartMinute = gridStartHour * 60;
  const gridEndMinute = gridEndHour * 60;
  const startMin = minutesOfDayIn(start);
  const endMin = minutesOfDayIn(end);
  const clampedStart = Math.max(startMin, gridStartMinute);
  const clampedEnd = Math.min(endMin, gridEndMinute);
  const top = ((clampedStart - gridStartMinute) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const height = Math.max(((clampedEnd - clampedStart) / SLOT_MINUTES) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2);
  return { top, height };
}

/** Converts a pixel offset from the top of a time-axis column into a snapped HH:MM start time. */
export function pixelOffsetToStartTime(
  offsetPx: number,
  gridStartHour = GRID_START_HOUR,
  gridEndHour = GRID_END_HOUR
): string {
  const gridStartMinute = gridStartHour * 60;
  const gridEndMinute = gridEndHour * 60;
  const rawMinutes = gridStartMinute + (offsetPx / SLOT_HEIGHT_PX) * SLOT_MINUTES;
  const snapped = Math.round(rawMinutes / SLOT_MINUTES) * SLOT_MINUTES;
  const clamped = Math.max(gridStartMinute, Math.min(gridEndMinute - SLOT_MINUTES, snapped));
  return minutesToTimeString(clamped);
}

/** Hour labels for a time-axis gutter, e.g. "6am", "7am", ... "9pm". */
export function getHourLabels(gridStartHour = GRID_START_HOUR, gridEndHour = GRID_END_HOUR): { label: string; top: number }[] {
  const labels: { label: string; top: number }[] = [];
  for (let min = gridStartHour * 60; min < gridEndHour * 60; min += 60) {
    const h = Math.floor(min / 60);
    const top = ((min - gridStartHour * 60) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
    labels.push({ label: `${h % 12 || 12}${h < 12 ? "am" : "pm"}`, top });
  }
  return labels;
}

/** Total pixel height of a time-axis column for the given hour range. */
export function getGridHeightPx(gridStartHour = GRID_START_HOUR, gridEndHour = GRID_END_HOUR): number {
  return ((gridEndHour - gridStartHour) * 60 / SLOT_MINUTES) * SLOT_HEIGHT_PX;
}

export interface WeekDay {
  code: string; // iCal two-letter day code, e.g. "MO"
  label: string; // e.g. "Monday"
  short: string; // e.g. "Mon"
}

export const DAYS: WeekDay[] = [
  { code: "SU", label: "Sunday", short: "Sun" },
  { code: "MO", label: "Monday", short: "Mon" },
  { code: "TU", label: "Tuesday", short: "Tue" },
  { code: "WE", label: "Wednesday", short: "Wed" },
  { code: "TH", label: "Thursday", short: "Thu" },
  { code: "FR", label: "Friday", short: "Fri" },
  { code: "SA", label: "Saturday", short: "Sat" },
];

/**
 * Day-of-week index where 0=Sunday...6=Saturday, matching DAYS' order, for a
 * **viewer-owned** date (e.g. "today", a week-navigator date) — runtime-local
 * `getDay()` already returns 0=Sunday...6=Saturday, so this is a direct
 * passthrough. Use `sessionDayIndex` for a session occurrence instead.
 */
export function dayIndexFromDate(date: Date): number {
  return date.getDay();
}

/**
 * Day-of-week index where 0=Sunday...6=Saturday, for a **session occurrence**
 * — UTC getters (see rrule/README.md), so it's filed under the weekday it
 * actually runs on regardless of the runtime's own zone.
 */
export function sessionDayIndex(date: Date): number {
  return zonedDayOfWeek(date);
}

export function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
