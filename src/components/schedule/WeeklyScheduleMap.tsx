"use client";

import { useMemo, useState } from "react";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { configurationLabel } from "@/lib/spaces/configurations";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatSessionTime, formatDayShort, formatDayFull, nowAsSessionTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { getSessionCardStyle } from "./sessionCardColor";
import SessionModal from "./SessionModal";
import WeekNavigator from "./WeekNavigator";
import {
  SLOT_HEIGHT_PX,
  GRID_START_HOUR,
  GRID_END_HOUR,
  DAYS,
  getSessionPixelPosition,
  getHourLabels,
  getGridHeightPx,
  dayIndexFromDate,
  sessionDayIndex,
} from "@/lib/schedule/weekGeometry";
import {
  useScheduleEditing,
  type ScheduleEditingApi,
} from "./editing/ScheduleEditingContext";
import SessionActionsMenu from "./editing/SessionActionsMenu";

interface WeeklyScheduleMapProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

const GENERAL_COLUMN = "General";

interface MapColumn {
  /** Column heading, and the grouping key for sessions without a real space. */
  name: string;
  /** Set only for columns backed by a real `spaces` row — the only droppable ones. */
  spaceId: string | null;
  sessions: ExpandedSession[];
}

/**
 * Resource-axis view — one day at a time, columns are the distinct Spaces
 * in use that day (e.g. "Lane 3", "Court A"), positioned on a real hour-by-
 * hour time axis (like a calendar), not just stacked in arrival order.
 * Sessions with no space attached fall back to grouping by their free-text
 * locationDetail, and sessions with neither are grouped into a trailing
 * "General" column. Geometry shared with WeeklyScheduleGrid via
 * src/lib/schedule/weekGeometry.ts so pixel math never drifts apart.
 *
 * This is the only view with a spatial position to drop onto, so under a
 * ScheduleEditingProvider it becomes the drag-and-drop surface: every space
 * in the facility gets a column (including empty ones, which visitors never
 * see because nothing is scheduled in them), templates drag in from the
 * rail to place a session at an exact time, and placed blocks drag between
 * spaces and times to reschedule. With no provider it renders exactly the
 * read-only map the widget embeds.
 *
 * The `DndContext` itself lives in `ScheduleDndProvider`, above both this
 * view and the template rail it drags from — the rail is a layout sibling,
 * so a context mounted here would leave its drag sources orphaned.
 */
export default function WeeklyScheduleMap({ sessions, weekStart, onWeekChange }: WeeklyScheduleMapProps) {
  const editing = useScheduleEditing();
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
      .filter((s) => sessionDayIndex(s.start) === activeDayIndex)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [sessions, activeDayIndex]);

  // Which state of the building this day's sessions imply (migration 048), and
  // which one the columns are filtered to. `"auto"` follows the day: with one
  // configuration in use the columns narrow to it, and a day that uses two —
  // long course in the morning, short course after — shows everything, because
  // that is a real and expected pattern, not an error (decision 5).
  const configurations = editing?.configurations ?? [];
  const [configurationOverride, setConfigurationOverride] = useState<string | null | "auto">("auto");

  const impliedConfigurationIds = useMemo(
    () => [...new Set(daySessions.flatMap((s) => s.configurationIds))],
    [daySessions]
  );
  const impliedConfigurationNames = useMemo(
    () => [...new Set(daySessions.flatMap((s) => s.configurationNames))],
    [daySessions]
  );
  const activeConfigurationId =
    configurationOverride === "auto"
      ? impliedConfigurationIds.length === 1
        ? impliedConfigurationIds[0]
        : null
      : configurationOverride;

  // Only the editor filters columns. A visitor's column list is built from the
  // sessions themselves, so it already contains exactly the lanes in use —
  // there are no empty 25m columns to hide.
  const allEditingSpaces = editing?.spaces;
  const editingSpaces = useMemo(() => {
    if (!allEditingSpaces) return undefined;
    if (!activeConfigurationId) return allEditingSpaces;
    return allEditingSpaces.filter(
      (s) => s.configurationId === null || s.configurationId === activeConfigurationId
    );
  }, [allEditingSpaces, activeConfigurationId]);

  // Sessions this filter is hiding outright — never silently: staff have to be
  // able to see that a booking exists in the other configuration.
  const hiddenSessionCount = useMemo(() => {
    if (!editing || !activeConfigurationId) return 0;
    return daySessions.filter(
      (s) => s.configurationIds.length > 0 && !s.configurationIds.includes(activeConfigurationId)
    ).length;
  }, [editing, daySessions, activeConfigurationId]);

  const columns: MapColumn[] = useMemo(() => {
    // Sessions land in a column per real space; falling back to their
    // free-text location, then a shared "General" bucket.
    const bySpaceId = new Map<string, ExpandedSession[]>();
    const byLocationName = new Map<string, ExpandedSession[]>();
    const withoutLocation: ExpandedSession[] = [];

    for (const session of daySessions) {
      if (session.spaceIds.length > 0) {
        for (const spaceId of session.spaceIds) {
          bySpaceId.set(spaceId, [...(bySpaceId.get(spaceId) ?? []), session]);
        }
        continue;
      }
      const location = session.locationDetail?.trim();
      if (location) {
        byLocationName.set(location, [...(byLocationName.get(location) ?? []), session]);
        continue;
      }
      withoutLocation.push(session);
    }

    // Space names come from the editor's own list when editing (so empty
    // spaces still get a droppable column) and otherwise from whatever the
    // sessions themselves carry, which is all a public viewer can see.
    const spaceNameById = new Map<string, string>();
    for (const session of daySessions) {
      session.spaceIds.forEach((id, i) => {
        const name = session.spaceNames[i];
        if (name) spaceNameById.set(id, name);
      });
    }

    const spaceColumns: MapColumn[] = (
      editingSpaces ??
      Array.from(spaceNameById, ([id, name]) => ({ id, name }))
    )
      .map((space) => ({
        name: spaceNameById.get(space.id) ?? space.name,
        spaceId: space.id,
        sessions: bySpaceId.get(space.id) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const locationColumns: MapColumn[] = Array.from(byLocationName, ([name, list]) => ({
      name,
      spaceId: null,
      sessions: list,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const result = [...spaceColumns, ...locationColumns];
    if (withoutLocation.length > 0) {
      result.push({ name: GENERAL_COLUMN, spaceId: null, sessions: withoutLocation });
    }
    return result;
  }, [daySessions, editingSpaces]);

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
                : "bg-muted text-muted-foreground hover:bg-border"
            )}
            style={activeDayIndex === i ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
          >
            <span>{formatDayShort(day)}</span>
            <span className="font-bold">{day.getDate()}</span>
          </button>
        ))}
      </div>

      <div className="flex items-baseline gap-2 flex-wrap mt-3">
        <h3 className="text-sm font-bold text-foreground">{formatDayFull(activeDay)}</h3>
        {/* What state the building is in that day, read off the lanes the day's
            sessions claim (migration 048). Rendered for visitors too — "can I
            swim 50s tonight" is a patron question — and absent entirely at any
            facility that has described no configurations. */}
        {configurationLabel(impliedConfigurationNames) && (
          <span className="text-xs font-medium text-muted-foreground">
            {configurationLabel(impliedConfigurationNames)}
          </span>
        )}
      </div>

      {/* Staff-only: narrows the columns to one state of the building, so a tank
          with 8 long-course and 16 short-course lanes isn't 24 columns wide. */}
      {configurations.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          <button
            type="button"
            onClick={() => setConfigurationOverride(null)}
            aria-pressed={!activeConfigurationId}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              !activeConfigurationId
                ? "bg-muted border-border text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All spaces
          </button>
          {configurations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setConfigurationOverride(c.id)}
              aria-pressed={activeConfigurationId === c.id}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                activeConfigurationId === c.id
                  ? "bg-muted border-border text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {hiddenSessionCount > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {hiddenSessionCount} session{hiddenSessionCount !== 1 ? "s" : ""} in another configuration{" "}
          {hiddenSessionCount !== 1 ? "are" : "is"} hidden.{" "}
          <button
            type="button"
            onClick={() => setConfigurationOverride(null)}
            className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Show all spaces
          </button>
        </p>
      )}

      {columns.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground/70">
          <p>
            {editing
              ? "Add a space to this facility (e.g. Lane 3, Court A) to place sessions on the map."
              : "This view works best when sessions have a location set, e.g. Lane 3, Court A."}
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="flex" style={{ minWidth: "max-content" }}>
            {/* Time gutter */}
            <div className="w-12 sm:w-16 flex-shrink-0 relative" style={{ height: gridHeightPx + "px" }}>
              {timeLabels.map((t) => (
                <span
                  key={t.label}
                  className="absolute right-2 text-xs text-muted-foreground/70 -translate-y-2.5"
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
                <MapColumnView
                  key={col.spaceId ?? col.name}
                  column={col}
                  dayCode={DAYS[activeDayIndex].code}
                  heightPx={gridHeightPx}
                  totalSlots={totalSlots}
                  editing={editing}
                  onSelectSession={setSelectedSession}
                />
              ))}
            </div>
          </div>
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

function MapColumnView({
  column,
  dayCode,
  heightPx,
  totalSlots,
  editing,
  onSelectSession,
}: {
  column: MapColumn;
  dayCode: string;
  heightPx: number;
  totalSlots: number;
  editing: ScheduleEditingApi | null;
  onSelectSession: (session: ExpandedSession) => void;
}) {
  // Only real spaces are droppable — a "General"/free-text column has no
  // space_id to write onto a session.
  const droppable = !!editing && !!column.spaceId;
  const { setNodeRef, isOver } = useDroppable({
    id: `map-${column.spaceId ?? column.name}-${dayCode}`,
    data: { type: "map-slot", spaceId: column.spaceId, spaceName: column.name, dayCode },
    disabled: !droppable,
  });

  const isGeneral = column.name === GENERAL_COLUMN;

  return (
    <div className="min-w-[160px]">
      <div
        className={cn(
          "text-center text-xs font-bold py-2 rounded-t-lg text-white truncate px-2",
          isGeneral && "bg-gray-500"
        )}
        style={isGeneral ? undefined : { backgroundColor: "var(--org-primary, #2563eb)" }}
      >
        {column.name}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "relative border border-t-0 border-border rounded-b-lg transition-colors",
          isOver ? "bg-blue-50" : "bg-muted"
        )}
        style={{ height: heightPx + "px" }}
      >
        {Array.from({ length: totalSlots }, (_, i) => (
          <div
            key={i}
            className={cn("absolute inset-x-0 border-b", i % 2 === 0 ? "border-border" : "border-border")}
            style={{ top: i * SLOT_HEIGHT_PX + "px", height: SLOT_HEIGHT_PX + "px" }}
          />
        ))}

        {droppable && column.sessions.length === 0 && (
          <p className="absolute inset-x-0 top-4 text-xs text-muted-foreground/70 text-center px-2">
            Drop a template here
          </p>
        )}

        {column.sessions.map((session) => (
          <MapSessionBlock
            key={session.key}
            session={session}
            editing={editing}
            onSelect={onSelectSession}
          />
        ))}
      </div>
    </div>
  );
}

function MapSessionBlock({
  session,
  editing,
  onSelect,
}: {
  session: ExpandedSession;
  editing: ScheduleEditingApi | null;
  onSelect: (session: ExpandedSession) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `session-${session.sessionId}-${session.key}`,
    data: { type: "session", session },
    disabled: !editing,
  });

  const { top, height } = getSessionPixelPosition(session.start, session.end);
  const isPast = session.end < nowAsSessionTime();
  const displayName = sessionDisplayLabel(session);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute inset-x-1 rounded-lg border-l-4 overflow-hidden transition-all",
        editing && "cursor-grab active:cursor-grabbing touch-none",
        isDragging && "opacity-40"
      )}
      style={{
        top: top + "px",
        height: height + "px",
        color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
        ...getSessionCardStyle(session, isPast),
      }}
      {...(editing ? listeners : {})}
      {...(editing ? attributes : {})}
    >
      <button
        type="button"
        onClick={() => onSelect(session)}
        className="w-full h-full text-left px-2 py-1 hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md"
        title={displayName}
      >
        <p className={cn("text-xs font-semibold leading-tight truncate", editing && "pr-4")}>
          {displayName}
        </p>
        {height >= SLOT_HEIGHT_PX && (
          <p className="text-xs opacity-75 leading-tight truncate">
            {formatSessionTime(session.start)}–{formatSessionTime(session.end)}
          </p>
        )}
      </button>

      {editing && (
        <SessionActionsMenu session={session} editing={editing} className="absolute top-1 right-1" />
      )}
    </div>
  );
}
