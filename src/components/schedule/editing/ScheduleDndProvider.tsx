"use client";

import { useEffect, useRef } from "react";
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, Modifier } from "@dnd-kit/core";
import type { ExpandedSession } from "@/types/schedule.types";
import {
  DAYS,
  pixelOffsetToStartTime,
  pixelOffsetToMinuteOfDay,
} from "@/lib/schedule/weekGeometry";
import { SNAP_MINUTES, SNAP_HEIGHT_PX } from "@/lib/schedule/gridEdits";
import { minutesOfDayIn } from "@/lib/utils/dates";
import type { EditorTemplate, ScheduleEditingApi } from "./ScheduleEditingContext";
import type { ScheduleCanvasApi } from "./ScheduleCanvasContext";

interface ScheduleDndProviderProps {
  /** Null disables dragging entirely — no DndContext is mounted at all. */
  editing: ScheduleEditingApi | null;
  /** When present, dropping a placed block writes immediately instead of confirming. */
  canvas?: ScheduleCanvasApi | null;
  children: React.ReactNode;
}

/**
 * Snaps a drag's vertical travel to the canvas grain, so a block visibly steps
 * in quarter-hours instead of sliding freely and then jumping on release.
 *
 * It is also what keeps the preview honest: the same grain is used below to
 * turn the drop position into a time, so what the block sits on at pointer-up
 * is what gets written.
 */
const snapToCanvasGrid: Modifier = ({ transform }) => ({
  ...transform,
  y: Math.round(transform.y / SNAP_HEIGHT_PX) * SNAP_HEIGHT_PX,
});

/**
 * Wraps the drag sources (`TemplateRail`) and the drop targets (Map's space
 * columns and day chips) in a single `DndContext`.
 *
 * This has to sit *above both* of them: the rail is a sibling of the
 * schedule panel in the command centre's layout, so a DndContext mounted
 * inside `WeeklyScheduleMap` would leave the rail's `useDraggable` outside
 * any provider — where dnd-kit silently no-ops and nothing ever drags.
 *
 * The drop handler needs nothing from Map's internal state: the droppable
 * carries its space, column and day in `data`, and turning a drop's vertical
 * offset into a start time is a pure function of the shared week geometry.
 *
 * ## Two destinations for a dropped block
 *
 * With a canvas above it, dropping a *placed session* writes straight away and
 * the undo bar reports it — dragging is direct manipulation, not a request to
 * open a dialog. Without one (or for a *template* dragged off the rail, which
 * has details still to fill in) the old path stands: `onReschedule` and
 * `onAddSession` open their dialogs. So the widget and any future read-only
 * surface are untouched by any of this.
 */
export default function ScheduleDndProvider({ editing, canvas, children }: ScheduleDndProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Delay on touch so scrolling the schedule doesn't start a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  // dnd-kit's drag-end event carries no modifier state, and the one that
  // matters is whichever is held when the pointer is *released* — Alt pressed
  // mid-drag is a deliberate change of mind about scope, not a typo. So it is
  // tracked at the window rather than read off the gesture that started it.
  const altHeld = useRef(false);
  useEffect(() => {
    const track = (event: KeyboardEvent | PointerEvent) => {
      altHeld.current = event.altKey;
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    window.addEventListener("pointermove", track);
    // A blurred window never delivers the keyup, which would strand every
    // later drop in "this week only".
    const clear = () => {
      altHeld.current = false;
    };
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
      window.removeEventListener("pointermove", track);
      window.removeEventListener("blur", clear);
    };
  }, []);

  function handleDragEnd(event: DragEndEvent) {
    if (!editing) return;
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as
      | { type?: "template"; template?: EditorTemplate }
      | {
          type?: "session";
          session?: ExpandedSession;
          blockId?: string;
          columnIndex?: number;
          spaceId?: string | null;
        }
      | undefined;

    const overData = over.data.current as
      | {
          type?: string;
          spaceId?: string;
          spaceName?: string;
          dayCode?: string;
          columnIndex?: number;
        }
      | undefined;

    // --- dropped on a day chip: change the weekday, keep lane and time -------
    if (overData?.type === "map-day" && overData.dayCode) {
      if (!canvas?.enabled) return;
      if (activeData?.type !== "session" || !activeData.session || !activeData.blockId) return;
      if (activeData.columnIndex === undefined) return;
      void canvas.moveBlock({
        blockId: activeData.blockId,
        toColumnIndex: activeData.columnIndex,
        toDayCode: overData.dayCode,
        toStartMinute: minutesOfDayIn(activeData.session.start),
        weekOnly: altHeld.current,
      });
      return;
    }

    if (overData?.type !== "map-slot" || !overData.spaceId || !overData.spaceName || !overData.dayCode) return;

    const dayMeta = DAYS.find((d) => d.code === overData.dayCode);
    if (!dayMeta) return;

    // Vertical position of the dragged element relative to the column top is
    // what makes a drop land on a real time rather than just in a column.
    const translatedRect = active.rect.current.translated;
    if (!translatedRect) return;
    const dropOffset = translatedRect.top - over.rect.top;
    const startTime = pixelOffsetToStartTime(dropOffset);

    if (activeData?.type === "template" && activeData.template) {
      editing.onAddSession({
        dayCode: dayMeta.code,
        dayLabel: dayMeta.label,
        spaceId: overData.spaceId,
        spaceName: overData.spaceName,
        startTime,
        template: activeData.template,
      });
      return;
    }

    if (activeData?.type === "session" && activeData.session) {
      if (canvas?.enabled && activeData.blockId && overData.columnIndex !== undefined) {
        void canvas.moveBlock({
          blockId: activeData.blockId,
          toColumnIndex: overData.columnIndex,
          toDayCode: dayMeta.code,
          // The canvas grain, not the dialog path's 30 — the block was drawn
          // stepping in quarter-hours, so writing half-hours would move it
          // somewhere it was never shown.
          toStartMinute: pixelOffsetToMinuteOfDay(dropOffset, SNAP_MINUTES),
          weekOnly: altHeld.current,
        });
        return;
      }

      editing.onReschedule({
        session: activeData.session,
        dayCode: dayMeta.code,
        dayLabel: dayMeta.label,
        startTime,
      });
    }
  }

  if (!editing) return <>{children}</>;

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={(event) => {
        canvas?.setDragGhost(null);
        handleDragEnd(event);
      }}
      onDragCancel={() => canvas?.setDragGhost(null)}
      // Published from here rather than read with `useDndMonitor` inside the
      // view. The view renders the public widget and facility page too, where
      // there is no DndContext at all — and `useDndMonitor` does not degrade
      // there, it throws, taking the whole page with it. Only the component
      // that owns the context may ask it questions.
      onDragMove={(event) => {
        if (!canvas?.enabled) return;
        const data = event.active.data.current as { type?: string; blockId?: string } | undefined;
        if (data?.type !== "session") return;
        canvas.setDragGhost({
          blockId: data.blockId ?? null,
          x: event.delta.x,
          // Snapped with the same constant as the modifier below, so a block
          // and the selection following it never sit a few pixels apart.
          y: Math.round(event.delta.y / SNAP_HEIGHT_PX) * SNAP_HEIGHT_PX,
        });
      }}
      modifiers={canvas?.enabled ? [snapToCanvasGrid] : undefined}
    >
      {children}
    </DndContext>
  );
}
