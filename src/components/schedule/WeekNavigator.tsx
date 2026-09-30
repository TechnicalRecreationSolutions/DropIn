"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { nextWeek, prevWeek } from "@/lib/utils/dates";

interface WeekNavigatorProps {
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

/**
 * Week header for Grid, List and Board. Same shape as the Map view's day
 * header: outline buttons either side, the range in the middle, and a small
 * "This week" in the centre's colour instead of a coloured bar.
 */
export default function WeekNavigator({ weekStart, onWeekChange }: WeekNavigatorProps) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const now = new Date();
  const firstMoment = new Date(weekStart);
  firstMoment.setHours(0, 0, 0, 0);
  const lastMoment = new Date(weekEnd);
  lastMoment.setHours(23, 59, 59, 999);
  const isCurrentWeek = now >= firstMoment && now <= lastMoment;

  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const range = `${format(weekStart, "MMM d")} – ${format(weekEnd, sameMonth ? "d, yyyy" : "MMM d, yyyy")}`;

  return (
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="outline" size="sm" onClick={() => onWeekChange(prevWeek(weekStart))} aria-label="Previous week">
        <ChevronLeft />
        <span className="hidden sm:inline">Previous week</span>
      </Button>
      <div className="min-w-0 text-center" aria-live="polite">
        {isCurrentWeek && (
          <p className="text-[11px] font-semibold leading-4" style={{ color: "var(--org-primary, var(--brand))" }}>
            This week
          </p>
        )}
        <p className="truncate text-base font-semibold tracking-[-0.01em] text-foreground">{range}</p>
      </div>
      <div className="flex items-center gap-2">
        {!isCurrentWeek && (
          <Button type="button" variant="outline" size="sm" onClick={() => onWeekChange(new Date())}>
            This week
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => onWeekChange(nextWeek(weekStart))} aria-label="Next week">
          <span className="hidden sm:inline">Next week</span>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
