"use client";

import { useCallback, useState } from "react";
import { getWeekStart, getMonthStart } from "@/lib/utils/dates";

/**
 * The single date a schedule surface is "parked on", plus the week and month
 * derived from it.
 *
 * `month` and `setMonth` are currently unused by every template — the month
 * event calendar that motivated them was removed (see docs/PLAN.md §3a) — but
 * are kept rather than stripped, since every call site still threads a `month`
 * anchor through and a future month-shaped view can reuse this without
 * re-solving the derivation trap below.
 *
 * Deriving both `weekStart` and `month` from one anchor sidesteps a trap that
 * bit the first attempt at this. You cannot store the *week* and derive the
 * month from it: `getWeekStart(getMonthStart(october))` is Mon Sep 28, so a
 * month derived back out of it reads as September and any month-shaped view
 * would render the wrong month whenever the 1st is not a Monday. The anchor is
 * an ordinary date; `getWeekStart` is idempotent over it, so the derivation
 * only ever loses information in the direction that doesn't matter.
 */
export function useScheduleAnchor(initial?: Date) {
  const [anchor, setAnchor] = useState<Date>(() => initial ?? new Date());

  // Navigators hand back a Monday; normalizing anyway means a caller passing a
  // raw "jump to this date" (a schedule's start date, "today") is equally correct.
  const setWeekStart = useCallback((date: Date) => setAnchor(getWeekStart(date)), []);
  const setMonth = useCallback((date: Date) => setAnchor(getMonthStart(date)), []);

  return {
    /** Monday of the week in view. */
    weekStart: getWeekStart(anchor),
    /** Any date inside the month in view — pass to `useMonthSchedule`/`getMonthGridRange`. */
    month: anchor,
    setWeekStart,
    setMonth,
    /** Jump both views to a specific date, e.g. a schedule's start date or "today". */
    setAnchor,
  };
}
