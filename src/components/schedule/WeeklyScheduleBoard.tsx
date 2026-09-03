"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { nowAsSessionTime, minutesOfDayIn } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import { getSessionCardStyle } from "./sessionCardColor";
import { DAYS, sessionDayIndex } from "@/lib/schedule/weekGeometry";
import { getSessionLiveStatus } from "@/lib/utils/sessionStatus";
import { useScheduleEditing } from "./editing/ScheduleEditingContext";
import SessionActionsMenu from "./editing/SessionActionsMenu";

interface WeeklyScheduleBoardProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

/** One printed-schedule row: a start/end band and, per day, the sessions active in it. */
interface BoardRow {
  startMinute: number;
  endMinute: number;
  byDay: ExpandedSession[][];
}

/**
 * Builds the row bands a printed rec-centre schedule uses: rather than a
 * continuous time axis (Map) or arrival order (Grid/List), sessions are
 * grouped into a small number of shared time bands so the week reads as a
 * table — a session box appears once per band per day, spanning that band's
 * full width, the way a PDF schedule lays out "6-7:45am" as one row shared
 * by every day that has something running then.
 *
 * Bands are derived from the sessions themselves (every distinct start or
 * end minute across the week is a band boundary) rather than fixed hour
 * slots, so an org's actual time patterns — not an arbitrary grid — decide
 * where rows fall. Two sessions that run back-to-back or overlap land in
 * separate bands; two that run the exact same start/end land in the same
 * band and the same cell.
 */
function buildBoardRows(sessions: ExpandedSession[]): BoardRow[] {
  const boundaries = new Set<number>();
  for (const s of sessions) {
    boundaries.add(minutesOfDayIn(s.start));
    boundaries.add(minutesOfDayIn(s.end));
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  if (sorted.length < 2) return [];

  const rows: BoardRow[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const startMinute = sorted[i];
    const endMinute = sorted[i + 1];
    const byDay: ExpandedSession[][] = Array.from({ length: 7 }, () => []);
    for (const s of sessions) {
      const sStart = minutesOfDayIn(s.start);
      const sEnd = minutesOfDayIn(s.end);
      if (sStart <= startMinute && sEnd >= endMinute) {
        byDay[sessionDayIndex(s.start)].push(s);
      }
    }
    // Drop bands nothing occupies on any day — a boundary from one day's
    // session shouldn't force an empty row across the other six.
    if (byDay.some((d) => d.length > 0)) {
      for (const d of byDay) d.sort((a, b) => a.start.getTime() - b.start.getTime());
      rows.push({ startMinute, endMinute, byDay });
    }
  }
  return rows;
}

function formatBandLabel(startMinute: number, endMinute: number): string {
  const fmt = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const period = h < 12 ? "am" : "pm";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
  };
  return `${fmt(startMinute)}-${fmt(endMinute)}`;
}

function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Board view — a native, editable stand-in for the printed PDF schedules
 * rec centres already hand out (day columns, shared time-band rows, one box
 * per session), for orgs attached to that look who'd otherwise re-upload a
 * flyer every time a time changes. Structurally it's Grid's cousin: same
 * session cards, same modal/edit affordances, but rows are shared time
 * bands instead of a per-day stack, so simultaneous sessions in different
 * spaces (e.g. 25M vs. 50M lap swim at the same hour) sit side by side in
 * one cell instead of merging into one card or needing distinct names to
 * tell apart — the space name prints right on the box.
 */
export default function WeeklyScheduleBoard({ sessions, weekStart, onWeekChange }: WeeklyScheduleBoardProps) {
  const editing = useScheduleEditing();
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);
  const canAdd = !!editing?.canCreate && editing.templates.length > 0;

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const rows = useMemo(() => buildBoardRows(sessions), [sessions]);
  const sessionNow = nowAsSessionTime();
  const now = new Date();

  return (
    <div>
      <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

      {rows.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground/70 py-10">No sessions scheduled this week.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
            <thead>
              <tr>
                <th className="w-20 sm:w-24" />
                {days.map((day, i) => {
                  const isToday = now.toDateString() === day.toDateString();
                  return (
                    <th
                      key={i}
                      className="text-xs font-bold py-2 px-1.5 text-white first:rounded-tl-lg last:rounded-tr-lg"
                      style={{ backgroundColor: isToday ? "var(--org-accent, #2563eb)" : "var(--org-primary, #2563eb)" }}
                    >
                      {DAYS[i].short.toUpperCase()} {day.getDate()}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.startMinute}>
                  <td
                    className={cn(
                      "align-top text-[11px] font-semibold text-muted-foreground pr-2 py-1.5 text-right whitespace-nowrap",
                      rowIndex % 2 === 1 && "bg-muted/60"
                    )}
                  >
                    {formatBandLabel(row.startMinute, row.endMinute)}
                  </td>
                  {row.byDay.map((cellSessions, dayIndex) => (
                    <BoardCell
                      key={dayIndex}
                      sessions={cellSessions}
                      shaded={rowIndex % 2 === 1}
                      canAdd={canAdd}
                      onAdd={
                        canAdd
                          ? () =>
                              editing!.onAddSession({
                                dayCode: DAYS[dayIndex].code,
                                dayLabel: DAYS[dayIndex].label,
                                startTime: minutesToTimeString(row.startMinute),
                              })
                          : undefined
                      }
                      onSelect={setSelectedSession}
                      sessionNow={sessionNow}
                      editing={!!editing}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function BoardCell({
  sessions,
  shaded,
  canAdd,
  onAdd,
  onSelect,
  sessionNow,
  editing,
}: {
  sessions: ExpandedSession[];
  shaded: boolean;
  canAdd: boolean;
  onAdd?: () => void;
  onSelect: (session: ExpandedSession) => void;
  sessionNow: Date;
  editing: boolean;
}) {
  const editingApi = useScheduleEditing();

  return (
    <td className={cn("align-top p-1", shaded && "bg-muted/60")}>
      <div className="flex flex-col gap-1 min-h-[40px]">
        {sessions.map((session) => {
          const { isLive, isPast } = getSessionLiveStatus(session, sessionNow);
          return (
            <div key={session.key} className="relative">
              <button
                onClick={() => onSelect(session)}
                className="w-full text-left rounded-md px-1.5 py-1 border transition-shadow hover:shadow-sm"
                style={{
                  color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
                  ...getSessionCardStyle(session, isPast),
                }}
              >
                <p className={cn("text-[11px] font-semibold leading-tight", editing && "pr-4")}>
                  {session.templateName ?? session.scheduleGroupName}
                </p>
                {session.spaceNames.length > 0 && (
                  <p className="text-[10px] opacity-70 leading-tight truncate mt-0.5">
                    {session.spaceNames.join(", ")}
                  </p>
                )}
                {isLive && (
                  <span
                    className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-white px-1 py-0.5 rounded-full"
                    style={{ backgroundColor: "var(--org-accent, #2563eb)" }}
                  >
                    On now
                  </span>
                )}
              </button>
              {editingApi && (
                <SessionActionsMenu session={session} editing={editingApi} className="absolute top-0.5 right-0.5" />
              )}
            </div>
          );
        })}

        {canAdd && sessions.length === 0 && (
          <button
            type="button"
            onClick={onAdd}
            className="flex-1 min-h-[36px] flex items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/70 hover:text-muted-foreground hover:border-border transition-colors"
            aria-label="Add session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </td>
  );
}
