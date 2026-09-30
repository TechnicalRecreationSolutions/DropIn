"use client";

import { formatDayFull, formatDayShort } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

interface DayStripProps {
  days: Date[];
  /** Which of `days` to show (defaults to all), by index into `days`. */
  indexes?: number[];
  counts: number[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
}

/**
 * The row of day chips from the Map view, for the views that show one day at
 * a time on a phone: short day, date, and how many sessions it has. The
 * selected day is one of the few places the centre's colour shows.
 */
export default function DayStrip({ days, indexes, counts, activeIndex, onSelect, className }: DayStripProps) {
  const shown = indexes ?? days.map((_, i) => i);
  return (
    <div
      className={cn("grid gap-1.5", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(shown.length, 1)}, minmax(0, 1fr))` }}
    >
      {shown.map((i) => {
        const day = days[i];
        const count = counts[i] ?? 0;
        const isActive = i === activeIndex;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            aria-pressed={isActive}
            aria-label={`${formatDayFull(day)}, ${count} ${count === 1 ? "session" : "sessions"}`}
            className={cn(
              "flex min-w-0 flex-col items-center rounded-xl border py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              isActive ? "border-transparent text-white" : "border-border bg-card text-foreground hover:bg-muted"
            )}
            style={isActive ? { backgroundColor: "var(--org-primary, var(--brand))" } : undefined}
          >
            <span className={cn("text-[11px] font-medium", isActive ? "text-white/85" : "text-muted-foreground")}>
              {formatDayShort(day)}
            </span>
            <span className="text-base font-semibold leading-5 tabular-nums">{day.getDate()}</span>
            <span className={cn("text-[11px] leading-4 tabular-nums", isActive ? "text-white/85" : "text-muted-foreground")}>
              {count > 0 ? count : "–"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
