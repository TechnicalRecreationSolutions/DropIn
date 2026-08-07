"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime, formatDayShort, formatDayFull } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import { getSessionCardStyle } from "./sessionCardColor";
import { DAYS, dayIndexFromDate } from "@/lib/schedule/weekGeometry";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";
import { useScheduleEditing } from "./editing/ScheduleEditingContext";
import SessionActionsMenu from "./editing/SessionActionsMenu";

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
 *
 * Under a ScheduleEditingProvider (the dashboard command centre) the exact
 * same markup gains a "+" in each day header and a "⋯" menu on each card;
 * with no provider (widget, public facility page) it renders read-only. One
 * component, so what staff edit can never drift from what visitors see.
 */
export default function WeeklyScheduleGrid({
  sessions,
  weekStart,
  onWeekChange,
  singleDay,
  onDeleteSession,
  deletingSessionId,
}: WeeklyScheduleGridProps) {
  const editing = useScheduleEditing();
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() =>
    singleDay ? dayIndexFromDate(singleDay) : dayIndexFromDate(new Date())
  );

  // Explicit props win so the schedule-group preview keeps its own delete
  // wiring; otherwise deletion comes from the editing context.
  const deleteHandler = onDeleteSession ?? editing?.onDelete;
  const deletingId = deletingSessionId ?? editing?.deletingSessionId ?? null;

  // A dead "+" on every day is worse than none — the command centre explains
  // in the rail why placing is unavailable (no schedule picked, no templates).
  const canAdd = !!editing?.canCreate && editing.templates.length > 0;

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

  // `singleDay` callers want exactly one day at every width. Everyone else
  // gets the full week on desktop and, on phones, only the day the chips
  // above select — otherwise those chips would be inert. Done in CSS rather
  // than by measuring the viewport so the server and client agree.
  const forcedSingleDay = singleDay !== undefined;

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
            const isActiveDay = dayIndex === activeDayIndex;
            if (forcedSingleDay && !isActiveDay) return null;

            const daySessions = sessionsByDay[dayIndex] ?? [];
            const isToday = now.toDateString() === day.toDateString();

            return (
              <div key={dayIndex} className={cn("flex-col", isActiveDay ? "flex" : "hidden sm:flex")}>
                <div
                  className={cn(
                    "text-xs font-bold py-2 px-2 rounded-t-lg text-white",
                    canAdd ? "flex items-center justify-between gap-1" : "text-center"
                  )}
                  style={{ backgroundColor: isToday ? "var(--org-accent, #2563eb)" : "var(--org-primary, #2563eb)" }}
                >
                  <span className={cn(canAdd && "truncate")}>
                    <span className="hidden sm:inline">{formatDayShort(day)} {day.getDate()}</span>
                    <span className="sm:hidden">{formatDayFull(day)}</span>
                  </span>
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() =>
                        editing.onAddSession({
                          dayCode: DAYS[dayIndex].code,
                          dayLabel: DAYS[dayIndex].label,
                        })
                      }
                      className="p-0.5 rounded hover:bg-white/20"
                      aria-label={`Add session on ${DAYS[dayIndex].label}`}
                      title="Add session"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
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
                        <div key={session.key} className="relative">
                          <button
                            onClick={() => setSelectedSession(session)}
                            className="w-full text-left rounded-md px-2.5 py-2 border transition-shadow hover:shadow-sm"
                            style={{
                              color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
                              ...getSessionCardStyle(session, isPast),
                            }}
                          >
                            <p className={cn("text-xs font-semibold leading-tight truncate", editing && "pr-5")}>
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
                          {editing && (
                            <SessionActionsMenu
                              session={session}
                              editing={editing}
                              className="absolute top-1.5 right-1.5"
                            />
                          )}
                        </div>
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
            deleteHandler &&
            ((session) => {
              deleteHandler(session);
              setSelectedSession(null);
            })
          }
          isDeleting={deletingId === selectedSession.sessionId}
        />
      )}
    </div>
  );
}
