"use client";

import { useCallback, useState } from "react";
import { getWeekStart, getMonthStart } from "@/lib/utils/dates";

/**
 * The single date a schedule surface is "parked on", plus the week and month
 * derived from it.
 *
 * Every surface used to hold a `weekStart`. The event calendar needs a month,
 * and holding both as independent state makes them drift: switch from the week
 * of Sep 28 to the events view and you'd expect October if the week you were
 * reading was mostly October.
 *
 * Deriving both from one anchor also sidesteps a trap that bit the first
 * attempt at this. You cannot store the *week* and derive the month from it:
 * `getWeekStart(getMonthStart(october))` is Mon Sep 28, so a month derived back
 * out of it reads as September and the calendar renders the wrong month every
 * time the 1st is not a Monday. The anchor is an ordinary date; `getWeekStart`
 * is idempotent over it, so the derivation only ever loses information in the
 * direction that doesn't matter.
 */
export function useScheduleAnchor(initial?: Date) {
  const [anchor, setAnchor] = useState<Date>(() => initial ?? new Date());

  // Navigators hand back a Monday; normalizing anyway means a caller passing a
  // raw "jump to this date" (a season start, "today") is equally correct.
  const setWeekStart = useCallback((date: Date) => setAnchor(getWeekStart(date)), []);
  const setMonth = useCallback((date: Date) => setAnchor(getMonthStart(date)), []);

  return {
    /** Monday of the week in view. */
    weekStart: getWeekStart(anchor),
    /** Any date inside the month in view — pass to `useMonthSchedule`/`getMonthGridRange`. */
    month: anchor,
    setWeekStart,
    setMonth,
    /** Jump both views to a specific date, e.g. a season start or "today". */
    setAnchor,
  };
}
