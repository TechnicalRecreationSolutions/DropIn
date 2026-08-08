"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { isSameMonth } from "date-fns";
import { nextMonth, prevMonth, formatMonthLabel } from "@/lib/utils/dates";

interface MonthNavigatorProps {
  /** Any date inside the month in view. */
  month: Date;
  onMonthChange: (newMonth: Date) => void;
}

/**
 * Month stepper for the event calendar — a sibling of `WeekNavigator` rather
 * than a mode inside it. The two share a silhouette on purpose (same chevrons,
 * same centred label, same "back to now" escape hatch) but nothing else: one
 * steps by seven days and labels a date span, the other steps by a calendar
 * month and labels a name. Overloading one component with both would mean a
 * prop that changes what every other prop means.
 */
export default function MonthNavigator({ month, onMonthChange }: MonthNavigatorProps) {
  const isCurrentMonth = isSameMonth(month, new Date());

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onMonthChange(prevMonth(month))}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
        aria-label="Previous month"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="flex-1 text-center">
        <p className="text-sm font-semibold text-gray-900">{formatMonthLabel(month)}</p>
      </div>

      <button
        onClick={() => onMonthChange(nextMonth(month))}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
        aria-label="Next month"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {!isCurrentMonth && (
        <button
          onClick={() => onMonthChange(new Date())}
          className="today-btn hidden sm:flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{ color: "var(--org-primary, #2563eb)" }}
        >
          <Calendar className="w-3.5 h-3.5" />
          This month
        </button>
      )}
    </div>
  );
}
