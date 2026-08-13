"use client";

import { useMemo, useState } from "react";
import { isSameMonth } from "date-fns";
import { Printer, Plus } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { eventDisplayTitle } from "@/types/schedule.types";
import {
  formatTimeIn,
  formatDayFull,
  formatMonthLabel,
  getMonthGridRange,
  getMonthStart,
  localDateString,
} from "@/lib/utils/dates";
import { zonedDateString } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils/cn";
import { DAYS, dayIndexFromDate } from "@/lib/schedule/weekGeometry";
import SessionModal from "./SessionModal";
import MonthNavigator from "./MonthNavigator";
import { useScheduleEditing } from "./editing/ScheduleEditingContext";
import SessionActionsMenu from "./editing/SessionActionsMenu";

/** Who the printed sheet belongs to. Screen rendering ignores this entirely. */
export interface PrintBranding {
  name: string;
  logoUrl?: string | null;
}

interface EventCalendarViewProps {
  /** Already filtered to `is_event` sessions by the fetch — see `useTemplateSchedule`. */
  sessions: ExpandedSession[];
  /** Any date inside the month in view. */
  month: Date;
  onMonthChange: (newMonth: Date) => void;
  /**
   * Org name/logo for the printed sheet. Only surfaces that know which org they
   * belong to pass it — the dashboard already sits under the org's own chrome,
   * so a masthead there would be redundant on screen and is unavailable on paper.
   */
  printBranding?: PrintBranding;
}

/**
 * Month-at-a-glance calendar of the sessions staff flagged as events.
 *
 * This is the view the whole track exists for: a recreation org's "what's
 * happening this month" sheet, the one that gets printed and taped to the wall
 * by the front desk. That origin story drives two things — it is a *month*, not
 * a scrollable agenda, and it has to survive `print.css` at one page wide.
 *
 * On mobile it becomes an agenda list rather than a shrunken grid, following
 * the precedent the weekly grid set: seven columns of a time axis on a phone is
 * unreadable, and a month is thirty-odd cells of the same problem. Days with
 * nothing on them are dropped from the agenda entirely — a month of empty rows
 * is not information.
 */
export default function EventCalendarView({
  sessions,
  month,
  onMonthChange,
  printBranding,
}: EventCalendarViewProps) {
  const editing = useScheduleEditing();
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);

  // The grid's own range, not the calendar month's: the leading and trailing
  // cells belong to the neighbouring months and are rendered dimmed rather
  // than blank, so a Thursday-the-1st doesn't look like a broken layout.
  const days = useMemo(() => {
    const { start, end } = getMonthGridRange(month);
    const out: Date[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(new Date(d));
    }
    return out;
  }, [month]);

  // Keyed by the calendar date in the *session's own* zone. Deliberately not by
  // ISO instant — an 8pm event in any timezone behind UTC lands on the
  // following day under toISOString(), which would file half an org's evening
  // events one day late. And deliberately not by the *viewer's* local date
  // either: that files an early-morning session under the previous day for
  // anyone reading from a zone further west than the facility.
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, ExpandedSession[]>();
    for (const session of sessions) {
      const key = zonedDateString(session.start, session.timezone);
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return map;
  }, [sessions]);

  const todayKey = localDateString();

  // A dead "+" on thirty-odd cells is worse than none — the command centre
  // explains in the rail why placing is unavailable. False on the org-wide
  // Events tab, where there is no single schedule to place into.
  const canAdd = !!editing?.canCreate && editing.templates.length > 0;

  function addOn(day: Date) {
    if (!editing) return;
    const index = dayIndexFromDate(day);
    editing.onAddSession({
      dayCode: DAYS[index].code,
      dayLabel: formatDayFull(day),
      // The month grid knows the actual date, unlike the week views. This is
      // what makes the dialog offer a one-off rather than a weekly series.
      date: localDateString(day),
    });
  }

  // Days carrying something, in order — the mobile agenda, and the answer to
  // "is this month actually empty".
  const agendaDays = useMemo(
    () => days.filter((d) => isSameMonth(d, month) && (sessionsByDate.get(localDateString(d))?.length ?? 0) > 0),
    [days, month, sessionsByDate]
  );

  return (
    <div className="event-calendar">
      <div className="no-print flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <MonthNavigator month={month} onMonthChange={onMonthChange} />
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <Printer className="w-3.5 h-3.5" />
          Print
        </button>
      </div>

      {/* Only visible on paper. The month label lives in the navigator, which
          the print stylesheet strips — a sheet on a wall with no month on it is
          the one thing that makes it useless. The accent rule carries the org's
          colour across the top so the sheet reads as theirs from a distance. */}
      <div
        className="hidden print:flex items-center gap-3 mb-2 pb-2 border-b-4"
        style={{ borderColor: "var(--org-primary, #2563eb)" }}
      >
        {printBranding?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={printBranding.logoUrl} alt="" className="h-10 w-auto object-contain" />
        )}
        <div className="min-w-0">
          {printBranding?.name && (
            <p className="text-sm font-semibold text-gray-600 leading-tight">
              {printBranding.name}
            </p>
          )}
          <h2 className="text-2xl font-bold text-gray-900 leading-tight">
            {formatMonthLabel(month)}
          </h2>
        </div>
      </div>

      {/* Desktop: the month grid. */}
      <div className="hidden sm:block mt-3">
        <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
          {DAYS.map((day) => (
            <div
              key={day.code}
              className="bg-gray-50 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            >
              {day.short}
            </div>
          ))}

          {days.map((day) => {
            const key = localDateString(day);
            const dayEvents = sessionsByDate.get(key) ?? [];
            const inMonth = isSameMonth(day, month);
            const isToday = key === todayKey;

            return (
              <div
                key={key}
                className={cn(
                  "group/cell bg-white min-h-[7rem] p-1.5 flex flex-col gap-1",
                  !inMonth && "bg-gray-50/70"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      "text-xs font-semibold leading-none rounded-full px-1.5 py-1",
                      !inMonth && "text-gray-300",
                      inMonth && !isToday && "text-gray-500",
                      isToday && "text-white"
                    )}
                    style={isToday ? { backgroundColor: "var(--org-accent, #2563eb)" } : undefined}
                  >
                    {day.getDate()}
                  </span>

                  {/* Revealed on hover/focus rather than always shown: a "+" in
                      all 35 cells at once turns the month into a grid of
                      buttons and buries the events it exists to display. */}
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() => addOn(day)}
                      aria-label={`Add an event on ${formatDayFull(day)}`}
                      className="no-print opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100 p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-opacity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {dayEvents.map((session) => (
                  <EventChip
                    key={session.key}
                    session={session}
                    dimmed={!inMonth}
                    onOpen={() => setSelectedSession(session)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: agenda. */}
      <div className="sm:hidden mt-3 space-y-5">
        {agendaDays.map((day) => {
          const key = localDateString(day);
          const dayEvents = sessionsByDate.get(key) ?? [];
          const isToday = key === todayKey;

          return (
            <div key={key}>
              <div
                className={cn(
                  "flex items-center gap-2 pb-1.5 border-b-2",
                  isToday ? "border-transparent" : "border-gray-200"
                )}
                style={isToday ? { borderColor: "var(--org-accent, #2563eb)" } : undefined}
              >
                <h3
                  className={cn("text-sm font-bold", !isToday && "text-gray-900")}
                  style={isToday ? { color: "var(--org-accent, #2563eb)" } : undefined}
                >
                  {formatDayFull(day)}
                </h3>
                {canAdd && (
                  <button
                    type="button"
                    onClick={() => addOn(day)}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                )}
              </div>
              <ul className="divide-y divide-gray-100">
                {dayEvents.map((session) => (
                  <li key={session.key} className="group flex items-center">
                    <button
                      onClick={() => setSelectedSession(session)}
                      className="flex-1 min-w-0 flex items-start gap-3 py-3 text-left"
                    >
                      <span
                        className="w-1 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: eventAccentColor(session) }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">
                          {eventDisplayTitle(session)}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {formatTimeIn(session.start, session.timezone)} · {session.facilityName}
                        </span>
                        {session.feature?.summary && (
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {session.feature.summary}
                          </span>
                        )}
                      </span>
                    </button>
                    {editing && <SessionActionsMenu session={session} editing={editing} variant="on-row" />}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* The agenda lists only days that already have something on them, so on
          mobile there is no empty cell to press. Without this, adding an event
          to a quiet day would be desktop-only. Defaults to today when the month
          in view contains it, else the 1st. */}
      {canAdd && (
        <div className="sm:hidden mt-4">
          <button
            type="button"
            onClick={() => addOn(isSameMonth(new Date(), month) ? new Date() : getMonthStart(month))}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add an event
          </button>
        </div>
      )}

      {/* One empty state for both layouts. It sits *below* the navigator rather
          than replacing the view, so an empty month is still a month you can
          page out of. */}
      {agendaDays.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm font-medium">No events this month</p>
          <p className="text-xs mt-1">
            {editing
              ? "Turn on “Show on event calendar” for a session to feature it here."
              : "Try another month."}
          </p>
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

/**
 * Colour for an event, in the order migration 028 documents: the feature's own
 * accent, then the session template's colour, then org brand. An org that never
 * sets an accent still gets a calendar coloured by activity rather than a grey one.
 */
function eventAccentColor(session: ExpandedSession): string {
  return session.feature?.accentColor ?? session.templateColor ?? "var(--org-primary, #2563eb)";
}

function EventChip({
  session,
  dimmed,
  onOpen,
}: {
  session: ExpandedSession;
  dimmed: boolean;
  onOpen: () => void;
}) {
  const accent = eventAccentColor(session);

  return (
    <button
      onClick={onOpen}
      className={cn(
        "event-chip w-full text-left rounded px-1.5 py-1 border-l-2 transition-colors hover:brightness-95",
        dimmed && "opacity-50"
      )}
      style={{
        borderColor: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`,
      }}
    >
      <span className="block text-[11px] font-semibold text-gray-900 leading-tight truncate">
        {eventDisplayTitle(session)}
      </span>
      {/* summary is written for exactly this cell — one line, authored short
          rather than truncated prose (migration 028, session_features.summary). */}
      <span className="block text-[10px] text-gray-500 leading-tight truncate">
        {session.feature?.summary ?? formatTimeIn(session.start, session.timezone)}
      </span>
    </button>
  );
}
