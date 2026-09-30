"use client";

import { useMemo, useState } from "react";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { Plus } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatSessionTime, formatDayShort, formatDayFull, nowAsSessionTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import { getSessionBlockStyle } from "./sessionCardColor";
import DayStrip from "./DayStrip";
import NowPill from "./NowPill";
import SessionTags from "./SessionTags";
import { DAYS, dayIndexFromDate, sessionDayIndex } from "@/lib/schedule/weekGeometry";
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
      map[sessionDayIndex(session.start)].push(session);
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
  const sessionNow = nowAsSessionTime();

  return (
    <div>
      <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

      {/* Phones show one day at a time; these pick it. */}
      <DayStrip
        className="mt-3 sm:hidden"
        days={days}
        counts={days.map((_, i) => sessionsByDay[i]?.length ?? 0)}
        activeIndex={activeDayIndex}
        onSelect={setActiveDayIndex}
      />

      {/* Day columns */}
      <div className="mt-4 overflow-x-auto">
        <div className={cn("grid gap-2", "grid-cols-1 sm:grid-cols-7", "sm:min-w-[900px]")}>
          {days.map((day, dayIndex) => {
            const isActiveDay = dayIndex === activeDayIndex;
            if (forcedSingleDay && !isActiveDay) return null;

            const daySessions = sessionsByDay[dayIndex] ?? [];
            const isToday = now.toDateString() === day.toDateString();

            return (
              <div key={dayIndex} className={cn("min-w-0 flex-col", isActiveDay ? "flex" : "hidden sm:flex")}>
                {/* Plain ink, like the landing page's printed week. The
                    centre's colour only marks today. */}
                <div
                  className={cn(
                    "flex min-h-8 items-center justify-between gap-1 px-1 pb-1.5",
                    isToday ? "border-b-2" : "border-b border-border mb-px"
                  )}
                  style={isToday ? { borderColor: "var(--org-primary, var(--brand))" } : undefined}
                >
                  <p className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                    <span className="hidden font-semibold text-foreground sm:inline">{formatDayShort(day)}</span>
                    <span className="hidden tabular-nums text-muted-foreground sm:inline">{day.getDate()}</span>
                    <span className="truncate font-semibold text-foreground sm:hidden">{formatDayFull(day)}</span>
                    {isToday && (
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: "var(--org-primary, var(--brand))" }}
                      >
                        Today
                      </span>
                    )}
                  </p>
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() =>
                        editing.onAddSession({
                          dayCode: DAYS[dayIndex].code,
                          dayLabel: DAYS[dayIndex].label,
                        })
                      }
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={`Add session on ${DAYS[dayIndex].label}`}
                      title="Add session"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>

                <div className="mt-2 flex min-h-[56px] flex-1 flex-col gap-1.5">
                  {daySessions.length === 0 ? (
                    <p className="rounded-[10px] border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                      Nothing scheduled
                    </p>
                  ) : (
                    daySessions.map((session) => {
                      const { isLive, isPast } = getSessionLiveStatus(session, sessionNow);
                      const where = [session.spaceNames.join(", "), session.locationDetail]
                        .filter(Boolean)
                        .join(" · ");

                      return (
                        <div key={session.key} className="relative">
                          <button
                            onClick={() => setSelectedSession(session)}
                            className="w-full rounded-[10px] border px-2.5 py-2 text-left transition-[filter] hover:brightness-95"
                            style={getSessionBlockStyle(session, isPast)}
                          >
                            <p className={cn("truncate text-[13px] font-semibold leading-tight", editing && "pr-5")}>
                              {sessionDisplayLabel(session)}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-tight tabular-nums opacity-80">
                              {formatSessionTime(session.start)}–{formatSessionTime(session.end)}
                              {isLive && <NowPill />}
                            </p>
                            {where && <p className="mt-0.5 truncate text-[11px] leading-tight opacity-70">{where}</p>}
                            <SessionTags tags={session.templateTags} className="mt-1" />
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
