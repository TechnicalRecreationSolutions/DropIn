"use client";

import { useMemo, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime, formatDayShort, formatDayFull } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import { getSessionCardStyle } from "./sessionCardColor";
import { dayIndexFromDate } from "@/lib/schedule/weekGeometry";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";

interface WeeklyScheduleGridProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
  /** If true, shows only the current day (mobile single-day view) */
  singleDay?: Date;
  /** Staff-only: when provided, the session modal shows a delete action. */
  onDeleteSession?: (session: ExpandedSession) => void;
  deletingSessionId?: string | null;
}

/**
 * Weekly grid view — seven day columns, each a simple flex-stacked list of
 * session cards sorted chronologically. No time axis (that's Map's job) —
 * a day's cards just stack top to bottom in the order they occur, same
 * content as WeeklyScheduleList, arranged as columns instead of sections.
 *
 * Desktop: 7-column layout. Mobile: single-day view with day selector chips.
 */
export default function WeeklyScheduleGrid({
  sessions,
  weekStart,
  onWeekChange,
  singleDay,
  onDeleteSession,
  deletingSessionId,
}: WeeklyScheduleGridProps) {
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() =>
    singleDay ? dayIndexFromDate(singleDay) : dayIndexFromDate(new Date())
  );

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const sessionsByDay = useMemo(() => {
    const map: Record<number, ExpandedSession[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const session of sessions) {
      map[dayIndexFromDate(session.start)].push(session);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return map;
  }, [sessions]);

  const visibleDays = singleDay !== undefined
    ? [activeDayIndex]
    : Array.from({ length: 7 }, (_, i) => i);

  const now = new Date();

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
                ? "text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
            style={activeDayIndex === i ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
          >
            <span>{formatDayShort(day)}</span>
            <span className="font-bold">{day.getDate()}</span>
          </button>
        ))}
      </div>

      {/* Day columns */}
      <div className="mt-3 overflow-x-auto">
        <div className={cn("grid gap-1.5", "grid-cols-1 sm:grid-cols-7", "sm:min-w-[900px]")}>
          {days.map((day, dayIndex) => {
            const isVisible = visibleDays.includes(dayIndex);
            if (!isVisible) return null;

            const daySessions = sessionsByDay[dayIndex] ?? [];
            const isToday = now.toDateString() === day.toDateString();

            return (
              <div key={dayIndex} className="flex flex-col">
                <div
                  className="text-center text-xs font-bold py-2 rounded-t-lg text-white"
                  style={{ backgroundColor: isToday ? "var(--org-accent, #2563eb)" : "var(--org-primary, #2563eb)" }}
                >
                  <span className="hidden sm:block">{formatDayShort(day)} {day.getDate()}</span>
                  <span className="sm:hidden">{formatDayFull(day)}</span>
                </div>

                <div
                  className={cn(
                    "flex-1 p-1.5 flex flex-col gap-1.5 min-h-[56px] rounded-b-lg border border-t-0",
                    isToday ? "border-blue-100" : "border-gray-200"
                  )}
                  style={{ backgroundColor: isToday ? "var(--org-card-bg, #eff6ff)" : "#FBFCFD" }}
                >
                  {daySessions.length === 0 ? (
                    <p className="text-center text-xs text-gray-400 opacity-70 py-3">No sessions</p>
                  ) : (
                    daySessions.map((session) => {
                      const { isLive, isPast } = getSessionLiveStatus(session, now);

                      return (
                        <button
                          key={session.key}
                          onClick={() => setSelectedSession(session)}
                          className="w-full text-left rounded-md px-2.5 py-2 border transition-shadow hover:shadow-sm"
                          style={{
                            color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
                            ...getSessionCardStyle(session, isPast),
                          }}
                        >
                          <p className="text-xs font-semibold leading-tight truncate">
                            {session.templateName ?? session.scheduleGroupName}
                          </p>
                          <p className="text-xs opacity-75 leading-tight mt-0.5">
                            {formatTime(session.start)}–{formatTime(session.end)}
                          </p>
                          {isLive && (
                            <span
                              className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide text-white px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
                            >
                              On now
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
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
          onDelete={
            onDeleteSession &&
            ((session) => {
              onDeleteSession(session);
              setSelectedSession(null);
            })
          }
          isDeleting={deletingSessionId === selectedSession.sessionId}
        />
      )}
    </div>
  );
}
