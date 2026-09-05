"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
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
 *
 * The list starts at today rather than at Sunday: someone reading a drop-in
 * schedule wants to know when they can next come, and days already gone are
 * noise at the top of that answer. They're collapsed behind a toggle rather
 * than dropped, because staff editing this same list mid-week still need to
 * reach Monday. Only the *current* week collapses anything — a week the
 * viewer navigated back to is one they asked to see in full.
 */
export default function WeeklyScheduleList({ sessions, weekStart, onWeekChange }: WeeklyScheduleListProps) {
  const editing = useScheduleEditing();
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);

  // A dead "Add session" on every day is worse than none — the command centre
  // explains in the rail why placing is unavailable.
  const canAdd = !!editing?.canCreate && editing.templates.length > 0;
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => dayIndexFromDate(new Date()));
  // null = follow `autoExpand` below; a boolean is the viewer's own choice,
  // which always wins from then on.
  const [showPastOverride, setShowPastOverride] = useState<boolean | null>(null);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  // -1 when the week in view doesn't contain today (a past or future week),
  // which is also the case where nothing gets collapsed.
  const todayIndex = useMemo(() => {
    const today = new Date().toDateString();
    return days.findIndex((day) => day.toDateString() === today);
  }, [days]);

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

  const pastDayCount = todayIndex > 0 ? todayIndex : 0;

  /**
   * Collapsing must never be the reason the list looks empty. If nothing is
   * left from today onward but there *is* something earlier this week, the
   * earlier days open on their own — otherwise a Mon–Wed-only schedule read
   * on a Saturday, or a filter whose every match is behind us, shows a week
   * of "No drop-ins scheduled" with the real answer hidden behind a toggle
   * nobody knows to press.
   */
  const autoExpand = useMemo(() => {
    if (pastDayCount === 0) return false;
    let upcoming = 0;
    let earlier = 0;
    for (let i = 0; i < 7; i++) {
      const count = sessionsByDay[i]?.length ?? 0;
      if (i >= pastDayCount) upcoming += count;
      else earlier += count;
    }
    return upcoming === 0 && earlier > 0;
  }, [pastDayCount, sessionsByDay]);

  const showPastDays = showPastOverride ?? autoExpand;
  const firstVisibleIndex = showPastDays ? 0 : pastDayCount;
  const visibleDayIndexes = useMemo(
    () => days.map((_, i) => i).filter((i) => i >= firstVisibleIndex),
    [days, firstVisibleIndex]
  );

  // The chips are a picker over what's actually rendered, so a day that just
  // got collapsed (or that a week change left behind) falls back to the top.
  const effectiveActiveDayIndex = visibleDayIndexes.includes(activeDayIndex)
    ? activeDayIndex
    : (visibleDayIndexes[0] ?? 0);

  const now = new Date();
  const sessionNow = nowAsSessionTime();

  return (
    <div>
      <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

      {/* Mobile: day selector chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mt-3 sm:hidden px-1">
        {visibleDayIndexes.map((i) => {
          const day = days[i];
          const isActive = effectiveActiveDayIndex === i;
          return (
            <button
              key={i}
              onClick={() => setActiveDayIndex(i)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors",
                isActive ? "text-white" : "bg-muted text-muted-foreground hover:bg-border"
              )}
              style={isActive ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
            >
              <span>{formatDayShort(day)}</span>
              <span className="font-bold">{day.getDate()}</span>
            </button>
          );
        })}
      </div>

      {pastDayCount > 0 && (
        <button
          type="button"
          onClick={() => setShowPastOverride(!showPastDays)}
          aria-expanded={showPastDays}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showPastDays ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showPastDays
            ? "Hide earlier days"
            : `Show ${pastDayCount} earlier day${pastDayCount === 1 ? "" : "s"}`}
        </button>
      )}

      <div className="mt-3 space-y-6">
        {visibleDayIndexes.map((dayIndex) => {
          const day = days[dayIndex];
          const isMobileHidden = dayIndex !== effectiveActiveDayIndex;
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
