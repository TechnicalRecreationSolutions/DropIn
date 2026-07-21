"use client";

import { useMemo, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime, formatDayShort, formatDayFull, timeToMinutes } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";

interface WeeklyScheduleGridProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
  /** Grid start hour (24h). Default: 6 */
  gridStartHour?: number;
  /** Grid end hour (24h). Default: 22 */
  gridEndHour?: number;
  /** If true, shows only the current day (mobile single-day view) */
  singleDay?: Date;
}

const SLOT_HEIGHT_PX = 48; // Height of each 30-minute slot
const SLOT_MINUTES = 30;
const SPORT_COLORS: Record<string, string> = {
  swimming:    "bg-blue-100 border-blue-400 text-blue-900",
  hockey:      "bg-slate-100 border-slate-400 text-slate-900",
  skating:     "bg-cyan-100 border-cyan-400 text-cyan-900",
  basketball:  "bg-orange-100 border-orange-400 text-orange-900",
  volleyball:  "bg-yellow-100 border-yellow-400 text-yellow-900",
  badminton:   "bg-green-100 border-green-400 text-green-900",
  pickleball:  "bg-lime-100 border-lime-400 text-lime-900",
  tennis:      "bg-emerald-100 border-emerald-400 text-emerald-900",
  soccer:      "bg-green-100 border-green-500 text-green-900",
  fitness:     "bg-purple-100 border-purple-400 text-purple-900",
  yoga:        "bg-pink-100 border-pink-400 text-pink-900",
  dance:       "bg-fuchsia-100 border-fuchsia-400 text-fuchsia-900",
  open_gym:    "bg-gray-100 border-gray-400 text-gray-900",
  curling:     "bg-indigo-100 border-indigo-400 text-indigo-900",
  default:     "bg-blue-100 border-blue-300 text-blue-900",
};

function getColor(sportCategory: string): string {
  return SPORT_COLORS[sportCategory] ?? SPORT_COLORS.default;
}

/**
 * Visual weekly schedule grid — the core UI component of Dropin.
 *
 * Desktop: 7-column CSS Grid with time gutter on the left.
 * Mobile: single-day view with day selector chips at the top.
 *
 * Sessions are absolutely positioned within their day column using
 * CSS top/height calculated from start/end minutes relative to gridStartHour.
 */
export default function WeeklyScheduleGrid({
  sessions,
  weekStart,
  onWeekChange,
  gridStartHour = 6,
  gridEndHour = 22,
  singleDay,
}: WeeklyScheduleGridProps) {
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => {
    if (singleDay) return singleDay.getDay() === 0 ? 6 : singleDay.getDay() - 1;
    const today = new Date();
    const d = today.getDay();
    return d === 0 ? 6 : d - 1; // 0=Mon ... 6=Sun
  });

  const gridStartMinute = gridStartHour * 60;
  const gridEndMinute = gridEndHour * 60;
  const totalMinutes = gridEndMinute - gridStartMinute;
  const totalSlots = totalMinutes / SLOT_MINUTES;
  const gridHeightPx = totalSlots * SLOT_HEIGHT_PX;

  // Build the 7 day columns
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  // Group sessions by day index (0=Mon ... 6=Sun)
  const sessionsByDay = useMemo(() => {
    const map: Record<number, ExpandedSession[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];

    for (const session of sessions) {
      const dayOfWeek = session.start.getDay(); // 0=Sun
      const index = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // convert to Mon=0
      map[index].push(session);
    }
    return map;
  }, [sessions]);

  function getSessionPosition(session: ExpandedSession) {
    const startMin = session.start.getHours() * 60 + session.start.getMinutes();
    const endMin = session.end.getHours() * 60 + session.end.getMinutes();
    const clampedStart = Math.max(startMin, gridStartMinute);
    const clampedEnd = Math.min(endMin, gridEndMinute);
    const top = ((clampedStart - gridStartMinute) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
    const height = Math.max(((clampedEnd - clampedStart) / SLOT_MINUTES) * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2);
    return { top, height };
  }

  // Time labels for the left gutter
  const timeLabels = useMemo(() => {
    const labels: { label: string; top: number }[] = [];
    for (let min = gridStartMinute; min < gridEndMinute; min += 60) {
      const h = Math.floor(min / 60);
      const top = ((min - gridStartMinute) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
      labels.push({ label: `${h % 12 || 12}${h < 12 ? "am" : "pm"}`, top });
    }
    return labels;
  }, [gridStartMinute, gridEndMinute]);

  const visibleDays = singleDay !== undefined
    ? [activeDayIndex]
    : Array.from({ length: 7 }, (_, i) => i);

  return (
    <div>
      <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

      {/* Mobile: day selector chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mt-3 sm:hidden px-1">
        {days.map((day, i) => (
          <button
            key={i}
            onClick={() => setActiveDayIndex(i)}
            className={cn(
              "flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors",
              activeDayIndex === i
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            <span>{formatDayShort(day)}</span>
            <span className="font-bold">{day.getDate()}</span>
          </button>
        ))}
      </div>

      {/* Schedule grid */}
      <div className="flex mt-2 overflow-x-auto">
        {/* Time gutter */}
        <div
          className="w-12 sm:w-16 flex-shrink-0 relative"
          style={{ height: gridHeightPx + "px" }}
        >
          {timeLabels.map((t) => (
            <span
              key={t.label}
              className="absolute right-2 text-xs text-gray-400 -translate-y-2.5"
              style={{ top: t.top + "px" }}
            >
              {t.label}
            </span>
          ))}
        </div>

        {/* Day columns */}
        <div className={cn(
          "flex-1 grid border-l border-gray-200",
          "grid-cols-1 sm:grid-cols-7" // mobile: 1 col, desktop: 7 cols
        )}>
          {days.map((day, dayIndex) => {
            const isVisible = visibleDays.includes(dayIndex);
            if (!isVisible) return null;

            const daySessions = sessionsByDay[dayIndex] ?? [];
            const isToday = new Date().toDateString() === day.toDateString();

            return (
              <div key={dayIndex} className="relative border-r border-gray-200 last:border-r-0">
                {/* Day header */}
                <div className={cn(
                  "sticky top-0 z-10 text-center py-2 border-b border-gray-200 bg-white text-xs font-medium",
                  isToday ? "text-blue-600" : "text-gray-600"
                )}>
                  <span className="hidden sm:block">{formatDayShort(day)} {day.getDate()}</span>
                  <span className="sm:hidden">{formatDayFull(day)}</span>
                </div>

                {/* Grid lines (30-min slots) */}
                <div
                  className="relative"
                  style={{ height: gridHeightPx + "px" }}
                >
                  {Array.from({ length: totalSlots }, (_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "absolute inset-x-0 border-b",
                        i % 2 === 0 ? "border-gray-200" : "border-gray-100"
                      )}
                      style={{ top: i * SLOT_HEIGHT_PX + "px", height: SLOT_HEIGHT_PX + "px" }}
                    />
                  ))}

                  {/* Session blocks */}
                  {daySessions.map((session) => {
                    const { top, height } = getSessionPosition(session);
                    const colorClass = getColor(session.sportCategory);

                    return (
                      <button
                        key={session.key}
                        onClick={() => setSelectedSession(session)}
                        className={cn(
                          "absolute inset-x-1 rounded-lg border-l-4 px-2 py-1 text-left",
                          "hover:brightness-95 transition-all overflow-hidden",
                          "focus:outline-none focus:ring-2 focus:ring-blue-500",
                          colorClass,
                          session.isModified && "opacity-80"
                        )}
                        style={{ top: top + "px", height: height + "px" }}
                        title={session.programName}
                      >
                        <p className="text-xs font-semibold leading-tight truncate">
                          {session.programName}
                        </p>
                        {height >= SLOT_HEIGHT_PX && (
                          <p className="text-xs opacity-75 leading-tight truncate">
                            {formatTime(session.start)}–{formatTime(session.end)}
                          </p>
                        )}
                        {height >= SLOT_HEIGHT_PX * 2 && session.costCents === 0 && (
                          <p className="text-xs opacity-60 leading-tight">Free</p>
                        )}
                        {height >= SLOT_HEIGHT_PX * 2 && session.costCents > 0 && (
                          <p className="text-xs opacity-60 leading-tight">
                            ${(session.costCents / 100).toFixed(2)}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Session detail modal */}
      {selectedSession && (
        <SessionModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}
