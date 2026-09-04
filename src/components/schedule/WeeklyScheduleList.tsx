"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import {
  formatSessionTime,
  formatDayShort,
  formatDayFull,
  nowAsSessionTime,
} from "@/lib/utils/dates";
import { dayIndexFromDate, sessionDayIndex } from "@/lib/schedule/weekGeometry";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";
import { DAYS } from "@/lib/schedule/weekGeometry";
import { useScheduleEditing } from "./editing/ScheduleEditingContext";
import SessionActionsMenu from "./editing/SessionActionsMenu";

interface WeeklyScheduleListProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

/**
 * Day-by-day list view — an alternative to the grid for schedules with
 * dense or overlapping sessions where a time-axis grid gets cramped.
 *
 * Like the other views, an enclosing ScheduleEditingProvider turns the same
 * markup into an editor: each day heading gains an "Add session" action and
 * each row a "⋯" menu. Without one it stays exactly the read-only list the
 * widget embeds.
 */
export default function WeeklyScheduleList({ sessions, weekStart, onWeekChange }: WeeklyScheduleListProps) {
  const editing = useScheduleEditing();
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);

  // A dead "Add session" on every day is worse than none — the command centre
  // explains in the rail why placing is unavailable.
  const canAdd = !!editing?.canCreate && editing.templates.length > 0;
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => dayIndexFromDate(new Date()));

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
      map[sessionDayIndex(session.start)].push(session);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return map;
  }, [sessions]);

  const now = new Date();
  const sessionNow = nowAsSessionTime();

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
                : "bg-muted text-muted-foreground hover:bg-border"
            )}
            style={activeDayIndex === i ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
          >
            <span>{formatDayShort(day)}</span>
            <span className="font-bold">{day.getDate()}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-6">
        {days.map((day, dayIndex) => {
          const isMobileHidden = dayIndex !== activeDayIndex;
          const daySessions = sessionsByDay[dayIndex] ?? [];
          const isToday = now.toDateString() === day.toDateString();

          return (
            <div key={dayIndex} className={cn(isMobileHidden ? "hidden sm:block" : "block")}>
              <div
                className={cn("flex items-baseline gap-2 pb-2 border-b-2", !isToday && "border-border")}
                style={isToday ? { borderColor: "var(--org-accent, #2563eb)" } : undefined}
              >
                <h3
                  className={cn("text-sm font-bold", !isToday && "text-foreground")}
                  style={isToday ? { color: "var(--org-accent, #2563eb)" } : undefined}
                >
                  {formatDayFull(day)}
                </h3>
                {daySessions.length > 0 && (
                  <span className="text-xs text-muted-foreground/70">
                    {daySessions.length} session{daySessions.length === 1 ? "" : "s"}
                  </span>
                )}
                {canAdd && (
                  <button
                    type="button"
                    onClick={() =>
                      editing.onAddSession({
                        dayCode: DAYS[dayIndex].code,
                        dayLabel: DAYS[dayIndex].label,
                      })
                    }
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add session
                  </button>
                )}
              </div>

              {daySessions.length === 0 ? (
                <p className="text-sm text-muted-foreground/70 py-4">No drop-ins scheduled.</p>
              ) : (
                <ul className="divide-y divide-border mt-1">
                  {daySessions.map((session) => {
                    const { isLive, isPast } = getSessionLiveStatus(session, sessionNow);
                    const dotColor = session.templateColor ?? "var(--org-primary, #2563eb)";

                    return (
                      <li key={session.key} className="group flex items-center">
                        <button
                          onClick={() => setSelectedSession(session)}
                          className={cn(
                            "flex-1 min-w-0 flex items-center gap-3 py-3 text-left hover:bg-muted rounded-lg px-2 -mx-2 transition-colors",
                            isPast && "opacity-50"
                          )}
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                          <span className="w-24 sm:w-28 shrink-0 text-xs font-medium text-muted-foreground">
                            {formatSessionTime(session.start)}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-foreground truncate">
                              {session.templateName ?? session.scheduleGroupName}
                            </span>
                            {(session.spaceNames.length > 0 || session.locationDetail) && (
                              <span className="block text-xs text-muted-foreground/70 truncate">
                                {[session.spaceNames.join(", "), session.locationDetail].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                          {isLive && (
                            <span
                              className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-white px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
                            >
                              On now
                            </span>
                          )}
                        </button>
                        {editing && (
                          <SessionActionsMenu session={session} editing={editing} variant="on-row" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {selectedSession && (
        <SessionModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onDelete={
            editing
              ? (session) => {
                  editing.onDelete(session);
                  setSelectedSession(null);
                }
              : undefined
          }
          isDeleting={editing?.deletingSessionId === selectedSession.sessionId}
        />
      )}
    </div>
  );
}
