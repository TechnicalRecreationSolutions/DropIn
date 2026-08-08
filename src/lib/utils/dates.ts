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

export function formatTime(date: Date): string {
  return format(date, "h:mm a");
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
  return startOfWeek(date, { weekStartsOn: 1 }); // Monday
}

export function getWeekEnd(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: 1 }); // Sunday
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
 * Monday on or before the 1st to the Sunday on or after the last day, so a
 * grid fetching only `getMonthStart`–`getMonthEnd` renders its leading and
 * trailing cells empty even when sessions exist on those days.
 *
 * Weeks start Monday here, matching getWeekStart and the weekly grid.
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
