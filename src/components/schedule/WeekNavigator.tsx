"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { format } from "date-fns";
import { nextWeek, prevWeek } from "@/lib/utils/dates";

interface WeekNavigatorProps {
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

export default function WeekNavigator({ weekStart, onWeekChange }: WeekNavigatorProps) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const isCurrentWeek =
    new Date().toDateString() >= weekStart.toDateString() &&
    new Date().toDateString() <= weekEnd.toDateString();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onWeekChange(prevWeek(weekStart))}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
        aria-label="Previous week"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="flex-1 text-center">
        <p className="text-sm font-semibold text-gray-900">
          {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
        </p>
      </div>

      <button
        onClick={() => onWeekChange(nextWeek(weekStart))}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
        aria-label="Next week"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {!isCurrentWeek && (
        <button
          onClick={() => onWeekChange(new Date())}
          className="today-btn hidden sm:flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{ color: "var(--org-primary, #2563eb)" }}
        >
          <Calendar className="w-3.5 h-3.5" />
          Today
        </button>
      )}
    </div>
  );
}
