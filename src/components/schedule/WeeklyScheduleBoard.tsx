"use client";

import { useMemo, useState } from "react";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { Plus } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { nowAsSessionTime, minutesOfDayIn } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import { getSessionBlockStyle } from "./sessionCardColor";
import NowPill from "./NowPill";
import SessionTags from "./SessionTags";
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
  return `${fmt(startMinute)}–${fmt(endMinute)}`;
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
        <p className="mt-4 rounded-[14px] border border-dashed border-border py-10 text-center text-sm text-muted-foreground">Nothing scheduled this week.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
            <thead>
              <tr>
                <th className="w-20 sm:w-24" />
                {days.map((day, i) => {
                  const isToday = now.toDateString() === day.toDateString();
                  // Plain ink, like a printed schedule's column heads; the
                  // centre's colour only marks today.
                  return (
                    <th
                      key={i}
                      className={cn("px-1.5 pb-2 text-left text-[13px] font-normal", isToday ? "border-b-2" : "border-b border-border")}
                      style={isToday ? { borderColor: "var(--org-primary, var(--brand))" } : undefined}
                    >
                      <span className="font-semibold text-foreground">{DAYS[i].short}</span>{" "}
                      <span className="tabular-nums text-muted-foreground">{day.getDate()}</span>
                      {isToday && (
                        <span
                          className="ml-1.5 text-[11px] font-semibold"
                          style={{ color: "var(--org-primary, var(--brand))" }}
                        >
                          Today
                        </span>
                      )}
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
                      "align-top whitespace-nowrap py-2 pr-3 text-right text-[11px] font-semibold tabular-nums text-muted-foreground",
                      rowIndex > 0 && "border-t border-border/70"
                    )}
                  >
                    {formatBandLabel(row.startMinute, row.endMinute)}
                  </td>
                  {row.byDay.map((cellSessions, dayIndex) => (
                    <BoardCell
                      key={dayIndex}
                      sessions={cellSessions}
                      ruled={rowIndex > 0}
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
  ruled,
  canAdd,
  onAdd,
  onSelect,
  sessionNow,
  editing,
}: {
  sessions: ExpandedSession[];
  /** Hairline above the row, instead of the old alternate shading. */
  ruled: boolean;
  canAdd: boolean;
  onAdd?: () => void;
  onSelect: (session: ExpandedSession) => void;
  sessionNow: Date;
  editing: boolean;
}) {
  const editingApi = useScheduleEditing();

  return (
    <td className={cn("align-top p-1", ruled && "border-t border-border/70")}>
      <div className="flex flex-col gap-1 min-h-[40px]">
        {sessions.map((session) => {
          const { isLive, isPast } = getSessionLiveStatus(session, sessionNow);
          return (
            <div key={session.key} className="relative">
              <button
                onClick={() => onSelect(session)}
                className="w-full rounded-lg border px-2 py-1.5 text-left transition-[filter] hover:brightness-95"
                style={getSessionBlockStyle(session, isPast)}
              >
                <p className={cn("text-[11px] font-semibold leading-tight", editing && "pr-4")}>
                  {sessionDisplayLabel(session)}
                </p>
                {session.spaceNames.length > 0 && (
                  <p className="text-[10px] opacity-70 leading-tight truncate mt-0.5">
                    {session.spaceNames.join(", ")}
                  </p>
                )}
                {/* The reason tags exist: this is the view that gets printed
                    and handed out, and these chips replace the asterisks and
                    colour key on the paper schedule. `xs` because a board box
                    is the smallest card in the app. */}
                <SessionTags tags={session.templateTags} size="xs" className="mt-0.5" />
                {isLive && <NowPill className="mt-1" />}
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
            className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground/70 transition-colors hover:border-input hover:text-foreground"
            aria-label="Add session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </td>
  );
}
