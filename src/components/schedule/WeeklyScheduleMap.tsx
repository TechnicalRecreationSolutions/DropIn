"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatSessionTime, formatDayShort, formatDayFull, nowAsSessionTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { getSessionCardStyle } from "./sessionCardColor";
import SessionTags from "./SessionTags";
import { mergeResidualBands } from "@/lib/schedule/residual";
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
  packIntoTracks,
} from "@/lib/schedule/weekGeometry";
import {
  useScheduleEditing,
  type ScheduleEditingApi,
} from "./editing/ScheduleEditingContext";
import SessionActionsMenu from "./editing/SessionActionsMenu";
import {
  useScheduleCanvas,
  canvasBlockId,
  type CanvasBlock,
  type ScheduleCanvasApi,
} from "./editing/ScheduleCanvasContext";
import { minutesOfDayIn, localDateString } from "@/lib/utils/dates";
import { clampMinute, snap, MIN_DURATION_MINUTES } from "@/lib/schedule/gridEdits";

interface WeeklyScheduleMapProps {
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
}

const GENERAL_COLUMN = "General";

/** "7:15 AM" from a minute of the day — for the live labels a gesture draws,
 *  which have a number rather than a Date to render. */
function formatMinuteOfDay(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** A column before its overlapping sessions have been split into tracks. */
type UnpackedColumn = Omit<MapColumn, "tracks">;

interface MapColumn {
  /** Column heading, and the grouping key for sessions without a real space. */
  name: string;
  /** Set only for columns backed by a real `spaces` row — the only droppable ones. */
  spaceId: string | null;
  sessions: ExpandedSession[];
  /**
   * The column split into side-by-side sub-columns so overlapping sessions are
   * drawn next to each other rather than one hiding the other. Length 1 for the
   * ordinary case of a lane whose bookings do not collide.
   */
  tracks: ExpandedSession[][];
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
  const canvas = useScheduleCanvas();
  const [selectedSession, setSelectedSession] = useState<ExpandedSession | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => dayIndexFromDate(new Date()));

  /**
   * The live drag, so the rest of a multi-selection can follow the block being
   * dragged.
   *
   * Dragging one of six selected blocks moves all six — that is what the drop
   * handler does — and showing only the one under the pointer moving means the
   * other five appear to stay put right up until they jump. dnd-kit only
   * transforms the element it is dragging, so the others are translated by the
   * same, equally snapped, delta.
   *
   * Read off the canvas rather than from `useDndMonitor`. This component also
   * renders the public widget and facility page, where no DndContext exists —
   * and that hook throws rather than degrading, so it took every read-only
   * render of the schedule down with it.
   */
  const drag = canvas?.dragGhost ?? null;

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const activeDay = days[activeDayIndex];

  // One day at a time is what makes this view readable, and also what makes an
  // empty day ambiguous: a program that runs Mon–Wed looks *missing* on Sunday
  // rather than simply not on today. The chips carry each day's own count so the
  // week is legible without clicking through it.
  const countByDayIndex = useMemo(() => {
    const counts = Array<number>(7).fill(0);
    for (const session of sessions) counts[sessionDayIndex(session.start)]++;
    return counts;
  }, [sessions]);

  const daySessions = useMemo(() => {
    return sessions
      .filter((s) => sessionDayIndex(s.start) === activeDayIndex)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [sessions, activeDayIndex]);

  // Every space the editor knows about. Lanes are the lane block — 1 through 8,
  // the numbers painted on the deck — and there is no second set to filter down
  // to: whether the tank is long course or short course is a property of the
  // session running in it, carried on the session and shown on its card
  // (migration 049). A visitor's columns come from the sessions themselves.
  const editingSpaces = editing?.spaces;

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

    const spaceColumns: UnpackedColumn[] = (
      editingSpaces ??
      Array.from(spaceNameById, ([id, name]) => ({ id, name }))
    )
      .map((space) => ({
        name: spaceNameById.get(space.id) ?? space.name,
        spaceId: space.id,
        // Residual blocks arrive split into bands by /api/sessions/expand. A
        // band boundary caused by a claim on *another* lane means nothing in
        // this column, so rejoin what is contiguous here — otherwise an
        // untouched lane shows three stacked blocks where one belongs.
        sessions: mergeResidualBands(bySpaceId.get(space.id) ?? []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const locationColumns: UnpackedColumn[] = Array.from(byLocationName, ([name, list]) => ({
      name,
      spaceId: null,
      sessions: list,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const result = [...spaceColumns, ...locationColumns];
    if (withoutLocation.length > 0) {
      result.push({ name: GENERAL_COLUMN, spaceId: null, sessions: withoutLocation });
    }

    // Split each column only once the whole column is known. Packing on the
    // *rendered* pixel range rather than raw minutes means two blocks separate
    // exactly when they would have collided on screen — including the half-slot
    // floor a zero-length session is drawn at.
    return result.map((col) => ({
      ...col,
      tracks: packIntoTracks(col.sessions, (session) => {
        const { top, height } = getSessionPixelPosition(session.start, session.end);
        return { start: top, end: top + height };
      }),
    }));
  }, [daySessions, editingSpaces]);

  const gridHeightPx = getGridHeightPx(GRID_START_HOUR, GRID_END_HOUR);
  const timeLabels = useMemo(() => getHourLabels(GRID_START_HOUR, GRID_END_HOUR), []);
  const totalSlots = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / 30;

  // Everything the canvas needs to turn a gesture into an edit: which day is on
  // screen, and the lane order that makes "one column to the right" and a
  // relative paste expressible. Published from here because this component is
  // the only thing that knows them — the context deliberately holds no opinion
  // about how a surface is laid out.
  const canvasColumns = useMemo(
    () => columns.map((c) => ({ spaceId: c.spaceId, name: c.name })),
    [columns]
  );
  const activeDayCode = DAYS[activeDayIndex].code;
  const activeDayDate = localDateString(activeDay);
  const setSurface = canvas?.setSurface;

  useEffect(() => {
    setSurface?.({ dayCode: activeDayCode, date: activeDayDate, columns: canvasColumns });
  }, [setSurface, activeDayCode, activeDayDate, canvasColumns]);

  // A residual fragment is a derived slice, not a stored block (see
  // MapSessionBlock) — it is drawn, but it is not a cell: selecting one and
  // pressing Delete would remove the whole session the slice came out of.
  const canvasBlocks: CanvasBlock[] = useMemo(() => {
    const built: CanvasBlock[] = [];
    columns.forEach((col, columnIndex) => {
      for (const session of col.sessions) {
        if (session.residualSegment?.isSlice) continue;
        built.push({
          id: canvasBlockId(session, col.spaceId ?? col.name),
          session,
          columnIndex,
          spaceId: col.spaceId,
          startMinute: minutesOfDayIn(session.start),
          endMinute: minutesOfDayIn(session.end),
        });
      }
    });
    return built;
  }, [columns]);

  const setBlocks = canvas?.setBlocks;
  useEffect(() => {
    setBlocks?.(canvasBlocks);
  }, [setBlocks, canvasBlocks]);

  return (
    <div>
      <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

      {/* Day selector chips. Under an editor they are also drop targets: the
          columns of this view are all one day, so dropping onto a chip is the
          only single gesture that can move a block to another weekday — the
          alternative is cut, switch day, paste. */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mt-3 px-1">
        {days.map((day, i) => (
          <DayChip
            key={i}
            day={day}
            dayCode={DAYS[i].code}
            count={countByDayIndex[i]}
            isActive={activeDayIndex === i}
            droppable={!!canvas?.enabled}
            onSelect={() => setActiveDayIndex(i)}
          />
        ))}
      </div>

      <div className="flex items-baseline gap-2 flex-wrap mt-3">
        <h3 className="text-sm font-bold text-foreground">{formatDayFull(activeDay)}</h3>
      </div>

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
            {/* A column that had to split needs room for its sub-columns, or
                two 80px halves make both unreadable — so its minimum grows with
                the track count instead of every column shrinking. */}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: columns
                  .map((c) => `minmax(${Math.max(160, c.tracks.length * 110)}px, 1fr)`)
                  .join(" "),
              }}
            >
              {columns.map((col, columnIndex) => (
                <MapColumnView
                  key={col.spaceId ?? col.name}
                  column={col}
                  columnIndex={columnIndex}
                  dayCode={activeDayCode}
                  heightPx={gridHeightPx}
                  totalSlots={totalSlots}
                  editing={editing}
                  canvas={canvas}
                  drag={drag}
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
  columnIndex,
  dayCode,
  heightPx,
  totalSlots,
  editing,
  canvas,
  drag,
  onSelectSession,
}: {
  column: MapColumn;
  columnIndex: number;
  dayCode: string;
  heightPx: number;
  totalSlots: number;
  editing: ScheduleEditingApi | null;
  canvas: ScheduleCanvasApi | null;
  drag: { blockId: string | null; x: number; y: number } | null;
  onSelectSession: (session: ExpandedSession) => void;
}) {
  // Only real spaces are droppable — a "General"/free-text column has no
  // space_id to write onto a session.
  const droppable = !!editing && !!column.spaceId;
  const { setNodeRef, isOver } = useDroppable({
    id: `map-${column.spaceId ?? column.name}-${dayCode}`,
    data: { type: "map-slot", spaceId: column.spaceId, spaceName: column.name, dayCode, columnIndex },
    disabled: !droppable,
  });

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const isGeneral = column.name === GENERAL_COLUMN;
  const isActiveColumn = canvas?.activeCell?.columnIndex === columnIndex;

  /**
   * Clicking empty grid sets the paste target and clears the selection — the
   * two halves of clicking an empty cell in a spreadsheet. The minute comes
   * from where the pointer actually was, so pasting lands at 7:15 when that is
   * where you clicked, rather than at the top of the nearest half-hour row.
   */
  function handleBackgroundPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!canvas?.enabled) return;
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = clampMinute(
      snap(GRID_START_HOUR * 60 + ((event.clientY - rect.top) / SLOT_HEIGHT_PX) * 30)
    );
    canvas.setActiveCell({ columnIndex, startMinute: minute });
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) canvas.clearSelection();
  }

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
        ref={(node) => {
          setNodeRef(node);
          surfaceRef.current = node;
        }}
        onPointerDown={handleBackgroundPointerDown}
        // Read back by the fill handle via elementFromPoint: a pointer drag
        // across lanes has to answer "which column am I over now", and the
        // alternative — measuring every column's rect on every move — would
        // re-measure a scrolling container mid-gesture.
        data-canvas-column={columnIndex}
        className={cn(
          "relative border border-t-0 rounded-b-lg transition-colors",
          // A drop target has to read as one in both themes; bg-blue-50 is
          // invisible against a dark surface.
          isOver ? "bg-blue-500/10 ring-2 ring-inset ring-blue-500" : "bg-muted",
          isActiveColumn ? "border-blue-400" : "border-border"
        )}
        style={{ height: heightPx + "px" }}
      >
        {Array.from({ length: totalSlots }, (_, i) => (
          <div
            key={i}
            className={cn("absolute inset-x-0 border-b pointer-events-none", i % 2 === 0 ? "border-border" : "border-border")}
            style={{ top: i * SLOT_HEIGHT_PX + "px", height: SLOT_HEIGHT_PX + "px" }}
          />
        ))}

        {/* The paste target. Drawn as a caret rather than a filled cell because
            a cell has no height here — a paste keeps each copied block's own
            duration and only its top-left corner lands on this line. */}
        {canvas?.activeCell && canvas.activeCell.columnIndex === columnIndex && (
          <div
            aria-hidden
            className="absolute inset-x-0 border-t-2 border-blue-500 pointer-events-none"
            style={{
              top: ((canvas.activeCell.startMinute - GRID_START_HOUR * 60) / 30) * SLOT_HEIGHT_PX + "px",
            }}
          />
        )}

        {droppable && column.sessions.length === 0 && (
          <p className="absolute inset-x-0 top-4 text-xs text-muted-foreground/70 text-center px-2 pointer-events-none">
            Drop a template here
          </p>
        )}

        {column.tracks.map((track, trackIndex) =>
          track.map((session) => (
            <MapSessionBlock
              key={session.key}
              session={session}
              blockId={canvasBlockId(session, column.spaceId ?? column.name)}
              columnIndex={columnIndex}
              spaceId={column.spaceId}
              trackIndex={trackIndex}
              trackCount={column.tracks.length}
              editing={editing}
              canvas={canvas}
              drag={drag}
              onSelect={onSelectSession}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MapSessionBlock({
  session,
  blockId,
  columnIndex,
  spaceId,
  trackIndex,
  trackCount,
  editing,
  canvas,
  drag,
  onSelect,
}: {
  session: ExpandedSession;
  blockId: string;
  columnIndex: number;
  spaceId: string | null;
  /** Which sub-column of its space this block sits in, and how many there are. */
  trackIndex: number;
  trackCount: number;
  editing: ScheduleEditingApi | null;
  canvas: ScheduleCanvasApi | null;
  drag: { blockId: string | null; x: number; y: number } | null;
  onSelect: (session: ExpandedSession) => void;
}) {
  // A residual fragment is a *derived* slice, not what staff entered: dragging
  // it would reschedule the whole 9–5 block to the fragment's two-hour window.
  // The block is still clickable, and still editable through its menu.
  const isFragment = !!session.residualSegment?.isSlice;
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `session-${session.sessionId}-${session.key}`,
    data: { type: "session", session, blockId, columnIndex, spaceId },
    disabled: !editing || isFragment,
  });

  const { top, height } = getSessionPixelPosition(session.start, session.end);
  const isPast = session.end < nowAsSessionTime();
  const displayName = sessionDisplayLabel(session);

  const selectable = !!canvas?.enabled && !isFragment;
  const isSelected = selectable && canvas.selectedIds.has(blockId);

  // Every other block of the same selection follows the one being dragged, by
  // the same snapped delta. Only dnd-kit's own element gets `transform`, so
  // without this a six-block selection shows one block moving and five that
  // look like they were left behind.
  const ghost =
    drag && drag.blockId && drag.blockId !== blockId && isSelected
      ? { x: drag.x, y: drag.y }
      : null;

  // While an edge is being dragged the block is drawn from this instead of
  // from its stored times. Without it the block sits still until the write
  // lands and a refetch comes back, which reads as a gesture that did nothing.
  const [preview, setPreview] = useState<{ top: number; height: number } | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [spanTo, setSpanTo] = useState<number | null>(null);

  const startMinute = minutesOfDayIn(session.start);
  const endMinute = minutesOfDayIn(session.end);

  /**
   * What the times would be if the pointer were released now.
   *
   * A drag's own translate is the only source for this — dnd-kit has already
   * snapped it to the canvas grain (`snapToCanvasGrid`), and the drop handler
   * derives the written time from the same translate, so the label cannot
   * disagree with what gets saved.
   */
  const activeTranslateY = transform?.y ?? ghost?.y ?? 0;
  const dragMinuteDelta = Math.round((activeTranslateY / SLOT_HEIGHT_PX) * 30);

  /**
   * Thickness of the two edge grips, in pixels, scaled to the block.
   *
   * A 15-minute block is 24px tall, and the fixed 10px grips took 6px off each
   * end of it — half the block, leaving a 12px strip to grab it by. So the
   * shortest sessions were the hardest to move, which is backwards: a short
   * block is the one most often in the wrong place. At 6px they take a quarter
   * instead of a half.
   */
  const renderedHeight = preview?.height ?? height;
  const handleThickness = renderedHeight >= SLOT_HEIGHT_PX ? 10 : 6;

  /**
   * Take focus back after a keyboard gesture.
   *
   * Moving a block to another lane renders it from a different column, so React
   * unmounts the old node and mounts a new one — and focus goes with it. One
   * ArrowRight and the keyboard was addressing nothing, which makes the whole
   * keyboard path a dead end on its second press. Keyed on the request's
   * counter, not on selection, so it fires once per gesture and never steals
   * focus from someone using a pointer.
   */
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const focusSeq = canvas?.focusRequest.seq ?? 0;
  const focusMine = canvas?.focusRequest.sessionId === session.sessionId;
  useEffect(() => {
    if (!focusMine) return;
    buttonRef.current?.focus({ preventScroll: true });
  }, [focusMine, focusSeq]);

  const blockHint = !selectable
    ? isFragment
      ? `${displayName} — this is what is left of a longer block after another booking; open it to edit the block itself`
      : displayName
    : session.followsOperatingHours
      ? `${displayName} — runs the whole time the department is open, so its times cannot be dragged`
      : `${displayName} — double-click for details`;
  const liveLabel =
    previewLabel ??
    ((isDragging || ghost) && dragMinuteDelta !== 0
      ? `${formatMinuteOfDay(startMinute + dragMinuteDelta)}–${formatMinuteOfDay(endMinute + dragMinuteDelta)}`
      : null);

  function beginResize(event: React.PointerEvent, edge: "start" | "end") {
    if (!canvas?.enabled || session.followsOperatingHours) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    const originY = event.clientY;
    let minutes = edge === "start" ? minutesOfDayIn(session.start) : minutesOfDayIn(session.end);

    function onMove(moveEvent: PointerEvent) {
      const deltaMinutes = ((moveEvent.clientY - originY) / SLOT_HEIGHT_PX) * 30;
      const base = edge === "start" ? minutesOfDayIn(session.start) : minutesOfDayIn(session.end);
      minutes = clampMinute(snap(base + deltaMinutes));
      const startMin = edge === "start" ? minutes : minutesOfDayIn(session.start);
      const endMin = edge === "end" ? minutes : minutesOfDayIn(session.end);
      if (endMin - startMin < MIN_DURATION_MINUTES) return;
      setPreview({
        top: ((startMin - GRID_START_HOUR * 60) / 30) * SLOT_HEIGHT_PX,
        height: ((endMin - startMin) / 30) * SLOT_HEIGHT_PX,
      });
      // The value, not just the shape. A block that is merely taller does not
      // tell anyone whether it now ends at 9:00 or 9:15, which is the entire
      // question the gesture is answering.
      setPreviewLabel(`${formatMinuteOfDay(startMin)}–${formatMinuteOfDay(endMin)}`);
    }

    function onUp(upEvent: PointerEvent) {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      setPreview(null);
      setPreviewLabel(null);
      void canvas?.resizeBlock({ blockId, edge, toMinute: minutes, weekOnly: upEvent.altKey });
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function beginLaneSpan(event: React.PointerEvent) {
    if (!canvas?.enabled) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    let target = columnIndex;

    function onMove(moveEvent: PointerEvent) {
      const under = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest<HTMLElement>("[data-canvas-column]");
      if (!under) return;
      target = Number(under.dataset.canvasColumn);
      setSpanTo(target);
    }

    function onUp() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      setSpanTo(null);
      if (target !== columnIndex) void canvas?.spanLanes({ blockId, toColumnIndex: target });
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={setNodeRef}
      // Stable hooks for verify-aw: a selection ring is a class name, and a
      // harness asserting on class names tests Tailwind rather than the canvas.
      data-canvas-block={blockId}
      data-canvas-selected={isSelected ? "true" : "false"}
      className={cn(
        "absolute rounded-lg border-l-4 overflow-visible group/block",
        // NOT `transition-all`. That animated top/height/transform too, so a
        // dragged block eased toward the pointer a beat behind it and a resized
        // one grew after the fact — the two things a direct-manipulation canvas
        // may never do. Only the shadow is worth easing.
        "transition-shadow",
        editing && !isFragment && "cursor-grab active:cursor-grabbing touch-none",
        // Dragging used to only fade the block, because dnd-kit's `transform`
        // was never applied — so nothing followed the pointer and the gesture
        // read as broken until the write landed. It moves now; the fade is
        // gone, and a shadow plus a raised z-index is what says "this one".
        isDragging && "shadow-xl z-30 cursor-grabbing",
        ghost && "shadow-lg z-20 opacity-90",
        isSelected && "ring-2 ring-offset-1 ring-blue-600 z-10",
        spanTo !== null && "opacity-70"
      )}
      style={{
        top: (preview?.top ?? top) + "px",
        height: (preview?.height ?? height) + "px",
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : ghost
            ? `translate3d(${ghost.x}px, ${ghost.y}px, 0)`
            : undefined,
        // Horizontal share of the column. A single track reproduces the old
        // `inset-x-1` exactly; two or more sit side by side, which is the only
        // way a program booked over a drop-in block is visible at all.
        left: `calc(${(trackIndex / trackCount) * 100}% + 4px)`,
        width: `calc(${100 / trackCount}% - 8px)`,
        color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
        ...getSessionCardStyle(session, isPast),
      }}
      {...(editing && !isFragment ? listeners : {})}
      {...(editing && !isFragment ? attributes : {})}
    >
      <button
        ref={buttonRef}
        type="button"
        // On a canvas a single click selects, like any spreadsheet cell, and
        // the details move to a double click. With no canvas above it — the
        // widget, a public facility page — the single click still opens the
        // modal, because there is nothing there to select into.
        onClick={(event) => {
          if (!selectable) {
            onSelect(session);
            return;
          }
          event.stopPropagation();
          canvas.selectBlock(
            blockId,
            event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
          );
        }}
        onDoubleClick={() => onSelect(session)}
        // A pointer and a keyboard mean different things by "activate". A
        // mouse click selects and a double-click opens; from the keyboard
        // there is no double-press, so Enter takes the "open" role and Space
        // keeps the "select" one. Without this split a keyboard user could
        // select a block and never reach its details.
        onKeyDown={(event) => {
          if (!selectable) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onSelect(session);
          }
        }}
        aria-pressed={selectable ? isSelected : undefined}
        className={cn(
          "w-full h-full flex flex-col items-stretch justify-start text-left px-2 py-1 hover:brightness-95 rounded-md overflow-hidden",
          // A visible focus ring, always — the canvas is navigable by Tab and
          // an invisible focus makes the arrow keys act on nothing anyone can
          // see. `focus-visible` rather than `focus` so a pointer click does
          // not leave a ring behind on every block it touches.
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        )}
        // A block that cannot take a gesture has to say so where the gesture
        // would be tried. Withholding the grip silently leaves someone
        // hunting for a handle that was never going to be there.
        title={blockHint}
      >
        <p className={cn("text-xs font-semibold leading-tight truncate", editing && "pr-4")}>
          {displayName}
        </p>
        {(liveLabel || height >= SLOT_HEIGHT_PX) && (
          <p
            className={cn(
              "text-xs leading-tight truncate",
              liveLabel ? "font-semibold opacity-100 tabular-nums" : "opacity-75"
            )}
          >
            {liveLabel ?? `${formatSessionTime(session.start)}–${formatSessionTime(session.end)}`}
          </p>
        )}
        {/* Blocks here are drawn to the height of their own duration, so a
            short session genuinely has no room — the same reason the time
            above is gated. The tags are still in the detail modal either way,
            which is why dropping them is safe rather than lossy. */}
        {height >= SLOT_HEIGHT_PX * 2 && (
          <SessionTags tags={session.templateTags} size="xs" className="mt-0.5" />
        )}
      </button>

      {/* Edge handles. A session that follows its department's operating hours
          (058) has no time of its own to drag, so it gets none — offering a
          grip that the server is required to ignore would read as a bug.

          They are sized against the block, not fixed: a 15-minute block is 24px
          tall, and two 10px grips centred on its edges left about 4px of body
          that could actually be grabbed to move it. So the shortest blocks in
          the schedule were the ones that could not be dragged — exactly
          backwards, since a short block is the one most often in the wrong
          place. Each grip also sits half outside the block, so what it takes
          from the draggable body is half its height, not all of it. */}
      {selectable && !session.followsOperatingHours && (
        <>
          <div
            onPointerDown={(event) => beginResize(event, "start")}
            style={{ height: handleThickness, top: -handleThickness / 2 }}
            className={cn(
              "absolute inset-x-3 flex items-center cursor-ns-resize touch-none transition-opacity",
              // Hover is not available on a touch screen, so a selected block
              // shows its grips outright — which is also the state someone is
              // in when they mean to resize.
              isSelected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100"
            )}
            role="presentation"
            aria-hidden
          >
            <div className="mx-auto h-1 w-8 rounded-full bg-blue-600 shadow" />
          </div>
          <div
            onPointerDown={(event) => beginResize(event, "end")}
            style={{ height: handleThickness, bottom: -handleThickness / 2 }}
            className={cn(
              "absolute inset-x-3 flex items-center cursor-ns-resize touch-none transition-opacity",
              isSelected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100"
            )}
            role="presentation"
            aria-hidden
          >
            <div className="mx-auto h-1 w-8 rounded-full bg-blue-600 shadow" />
          </div>
        </>
      )}

      {/* The fill handle. Dragged sideways it extends the session across the
          lanes it crosses — one session in Lanes 1-4, which is how the schema
          models a shared lap-swim block, rather than four copies of it.
          Square and cornered so it cannot be mistaken for the round edge
          grips, which do something else entirely. */}
      {selectable && (
        <div
          onPointerDown={beginLaneSpan}
          className={cn(
            "absolute -right-1 -bottom-1 w-3 h-3 rounded-sm bg-blue-600 border border-white cursor-ew-resize touch-none transition-opacity",
            isSelected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100"
          )}
          title="Drag sideways to extend across lanes"
          role="presentation"
          aria-hidden
        />
      )}

      {editing && (
        <SessionActionsMenu session={session} editing={editing} className="absolute top-1 right-1" />
      )}
    </div>
  );
}

/** A day chip that is also a drop target while an editor is mounted. */
function DayChip({
  day,
  dayCode,
  count,
  isActive,
  droppable,
  onSelect,
}: {
  day: Date;
  dayCode: string;
  count: number;
  isActive: boolean;
  droppable: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `map-day-${dayCode}`,
    data: { type: "map-day", dayCode },
    disabled: !droppable,
  });

  return (
    <button
      ref={setNodeRef}
      onClick={onSelect}
      className={cn(
        "flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors",
        isActive ? "text-white" : "bg-muted text-muted-foreground hover:bg-border",
        isOver && !isActive && "ring-2 ring-blue-500 bg-blue-50"
      )}
      style={isActive ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
    >
      <span>{formatDayShort(day)}</span>
      <span className="font-bold">{day.getDate()}</span>
      <span
        className={cn(
          "text-[10px] leading-tight tabular-nums",
          isActive ? "text-white/80" : "text-muted-foreground/70"
        )}
      >
        {count > 0 ? count : "–"}
      </span>
    </button>
  );
}
