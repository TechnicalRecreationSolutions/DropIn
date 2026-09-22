"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { localDateString } from "@/lib/utils/dates";
import { timeToMinutes } from "@/lib/schedule/operating-hours";
import type { OpenWindow } from "@/lib/schedule/weekOverview";

/**
 * The seven days of open windows a week actually has, holidays applied.
 *
 * Two sources, because they answer different questions and migration 059 was
 * explicit that neither subsumes the other: `department_hours` is the
 * recurring pattern ("a Monday"), and `department_holidays` is a set of dates
 * that override it. Christmas Day is a Monday, and a week overview that
 * counted the building as open on it would overstate the year's capacity in
 * exactly the week someone is most likely to check.
 *
 * ⚠️ Absence means the OPPOSITE thing in the two tables (058/059). No hours row
 * for a weekday means CLOSED; no holiday row for a date means ORDINARY. Both
 * are honoured here — do not "simplify" either into the other.
 */

interface HoursResponse {
  days: { opens: string; closes: string }[][];
}

interface HolidaysResponse {
  holidays: {
    date: string;
    name: string;
    observance: "closed" | "custom_hours" | "normal_hours";
    windows: { opens: string; closes: string }[];
  }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return (await res.json()) as T;
}

function toWindows(raw: { opens: string; closes: string }[] | undefined): OpenWindow[] {
  return (raw ?? [])
    .map((w) => ({ opens: timeToMinutes(w.opens), closes: timeToMinutes(w.closes) }))
    .filter((w): w is OpenWindow => w.opens !== null && w.closes !== null && w.closes > w.opens);
}

export interface DepartmentWeekHours {
  /** Index 0 = Sunday, matching `DAYS` and `sessionDayIndex`. */
  openByDay: OpenWindow[][];
  /** The holidays that actually land in this week, for the panel to name. */
  holidaysThisWeek: { date: string; name: string; observance: string }[];
  isLoading: boolean;
  /** False when the department has set no hours at all — the caller hides every open/unprogrammed figure. */
  hasHours: boolean;
}

export function useDepartmentWeekHours(
  departmentId: string | null | undefined,
  weekStart: Date
): DepartmentWeekHours {
  const dates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        return localDateString(date);
      }),
    [weekStart]
  );

  // A week can straddle New Year, so both years are asked for. The second
  // query is disabled in the 51 weeks where they match, which is the ordinary
  // case and costs nothing.
  const firstYear = Number(dates[0].slice(0, 4));
  const lastYear = Number(dates[6].slice(0, 4));

  const hours = useQuery({
    queryKey: ["department-hours", departmentId],
    queryFn: () => getJson<HoursResponse>(`/api/departments/${departmentId}/hours`),
    enabled: !!departmentId,
    staleTime: 60_000,
  });

  const holidaysA = useQuery({
    queryKey: ["department-holidays", departmentId, firstYear],
    queryFn: () => getJson<HolidaysResponse>(`/api/departments/${departmentId}/holidays?year=${firstYear}`),
    enabled: !!departmentId,
    staleTime: 60_000,
  });

  const holidaysB = useQuery({
    queryKey: ["department-holidays", departmentId, lastYear],
    queryFn: () => getJson<HolidaysResponse>(`/api/departments/${departmentId}/holidays?year=${lastYear}`),
    enabled: !!departmentId && lastYear !== firstYear,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const week = hours.data?.days ?? [];
    const byDate = new Map<string, HolidaysResponse["holidays"][number]>();
    for (const holiday of [...(holidaysA.data?.holidays ?? []), ...(holidaysB.data?.holidays ?? [])]) {
      byDate.set(holiday.date, holiday);
    }

    const openByDay: OpenWindow[][] = [];
    const holidaysThisWeek: DepartmentWeekHours["holidaysThisWeek"] = [];

    dates.forEach((dateKey, offset) => {
      // `dates` runs from weekStart, which is a Sunday (getWeekStart), so the
      // offset IS the weekday index. Asserted rather than assumed by deriving
      // it from the date, which would read a weekday off a viewer-owned Date.
      const dayIndex = (weekStart.getDay() + offset) % 7;
      const holiday = byDate.get(dateKey);

      if (holiday) {
        holidaysThisWeek.push({ date: dateKey, name: holiday.name, observance: holiday.observance });
        if (holiday.observance === "closed") {
          openByDay[dayIndex] = [];
          return;
        }
        if (holiday.observance === "custom_hours") {
          openByDay[dayIndex] = toWindows(holiday.windows);
          return;
        }
        // "normal_hours" is a decision that the ordinary week applies, which is
        // why it is stored at all (059) — it falls through.
      }

      openByDay[dayIndex] = toWindows(week[dayIndex]);
    });

    return {
      openByDay,
      holidaysThisWeek,
      isLoading: hours.isLoading || holidaysA.isLoading,
      hasHours: week.some((day) => (day?.length ?? 0) > 0),
    };
  }, [hours.data, hours.isLoading, holidaysA.data, holidaysA.isLoading, holidaysB.data, dates, weekStart]);
}
