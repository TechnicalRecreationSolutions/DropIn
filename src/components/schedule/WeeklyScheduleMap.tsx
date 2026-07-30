"use client";

import { useMemo, useState } from "react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime, formatDayShort, formatDayFull } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { getSessionCardStyle } from "./sessionCardColor";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import {
  SLOT_HEIGHT_PX,
  GRID_START_HOUR,
  GRID_END_HOUR,
  getSessionPixelPosition,
  getHourLabels,
  getGridHeightPx,
  dayIndexFromDate,
} from "@/lib/schedule/weekGeometry";

interface WeeklyScheduleMapProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

const GENERAL_COLUMN = "General";

/**
 * Resource-axis view — one day at a time, columns are the distinct Spaces
 * in use that day (e.g. "Lane 3", "Court A"), positioned on a real hour-by-
 * hour time axis (like a calendar), not just stacked in arrival order.
 * Sessions with no space attached fall back to grouping by their free-text
 * locationDetail, and sessions with neither are grouped into a trailing
 * "General" column. Geometry shared with WeeklyScheduleGrid via
 * src/lib/schedule/weekGeometry.ts so pixel math never drifts apart.
 */
export default function WeeklyScheduleMap({ sessions, weekStart, onWeekChange }: WeeklyScheduleMapProps) {
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => dayIndexFromDate(new Date()));

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const activeDay = days[activeDayIndex];

  const daySessions = useMemo(() => {
    return sessions
      .filter((s) => dayIndexFromDate(s.start) === activeDayIndex)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [sessions, activeDayIndex]);

  const columns = useMemo(() => {
    function columnKeys(s: ExpandedSession): string[] {
      if (s.spaceNames.length > 0) return s.spaceNames;
      if (s.locationDetail && s.locationDetail.trim() !== "") return [s.locationDetail];
      return [];
    }

    const byName = new Map<string, ExpandedSession[]>();
    const withoutLocation: ExpandedSession[] = [];

    for (const session of daySessions) {
      const keys = columnKeys(session);
      if (keys.length === 0) {
        withoutLocation.push(session);
        continue;
      }
      for (const key of keys) {
        const existing = byName.get(key) ?? [];
        existing.push(session);
        byName.set(key, existing);
      }
    }

    const locationNames = Array.from(byName.keys()).sort((a, b) => a.localeCompare(b));
    const result: { name: string; sessions: ExpandedSession[] }[] = locationNames.map((name) => ({
      name,
      sessions: byName.get(name)!,
    }));

    if (withoutLocation.length > 0) {
      result.push({ name: GENERAL_COLUMN, sessions: withoutLocation });
    }

    return result;
  }, [daySessions]);

  const gridHeightPx = getGridHeightPx(GRID_START_HOUR, GRID_END_HOUR);
  const timeLabels = useMemo(() => getHourLabels(GRID_START_HOUR, GRID_END_HOUR), []);
  const totalSlots = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / 30;

  return (
    <div>
      <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

      {/* Day selector chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mt-3 px-1">
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

      <h3 className="text-sm font-bold text-gray-900 mt-3">{formatDayFull(activeDay)}</h3>

      {columns.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <p>This view works best when sessions have a location set, e.g. Lane 3, Court A.</p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="flex" style={{ minWidth: "max-content" }}>
            {/* Time gutter */}
            <div className="w-12 sm:w-16 flex-shrink-0 relative" style={{ height: gridHeightPx + "px" }}>
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

            {/* Space columns on the time axis */}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))` }}
            >
              {columns.map((col) => (
                <div key={col.name} className="min-w-[160px]">
                  <div
                    className={cn(
                      "text-center text-xs font-bold py-2 rounded-t-lg text-white",
                      col.name === GENERAL_COLUMN && "bg-gray-500"
                    )}
                    style={col.name === GENERAL_COLUMN ? undefined : { backgroundColor: "var(--org-primary, #2563eb)" }}
                  >
                    {col.name}
                  </div>
                  <div
                    className="relative border border-t-0 border-gray-200 rounded-b-lg bg-gray-50"
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

                    {col.sessions.map((session) => {
                      const { top, height } = getSessionPixelPosition(session.start, session.end);
                      const isPast = session.end < new Date();

                      return (
                        <button
                          key={session.key}
                          onClick={() => setSelectedSession(session)}
                          className={cn(
                            "absolute inset-x-1 text-left rounded-lg border-l-4 px-2 py-1 overflow-hidden",
                            "hover:brightness-95 transition-all",
                            "focus:outline-none focus:ring-2 focus:ring-blue-500"
                          )}
                          style={{
                            top: top + "px",
                            height: height + "px",
                            color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
                            ...getSessionCardStyle(session, isPast),
                          }}
                          title={session.templateName ?? session.scheduleGroupName}
                        >
                          <p className="text-xs font-semibold leading-tight truncate">
                            {session.templateName ?? session.scheduleGroupName}
                          </p>
                          {height >= SLOT_HEIGHT_PX && (
                            <p className="text-xs opacity-75 leading-tight truncate">
                              {formatTime(session.start)}–{formatTime(session.end)}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedSession && (
        <SessionModal session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}
    </div>
  );
}
