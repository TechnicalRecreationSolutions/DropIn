"use client";

import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ExpandedSession } from "@/types/schedule.types";
import { DAYS, pixelOffsetToStartTime } from "@/lib/schedule/weekGeometry";
import type { EditorTemplate, ScheduleEditingApi } from "./ScheduleEditingContext";

interface ScheduleDndProviderProps {
  /** Null disables dragging entirely — no DndContext is mounted at all. */
  editing: ScheduleEditingApi | null;
  children: React.ReactNode;
}

/**
 * Wraps the drag sources (`TemplateRail`) and the drop targets (Map's space
 * columns) in a single `DndContext`.
 *
 * This has to sit *above both* of them: the rail is a sibling of the
 * schedule panel in the command centre's layout, so a DndContext mounted
 * inside `WeeklyScheduleMap` would leave the rail's `useDraggable` outside
 * any provider — where dnd-kit silently no-ops and nothing ever drags.
 *
 * The drop handler needs nothing from Map's internal state: the droppable
 * carries its space and day in `data`, and turning a drop's vertical offset
 * into a start time is a pure function of the shared week geometry. So the
 * logic lives here rather than being plumbed back down.
 */
export default function ScheduleDndProvider({ editing, children }: ScheduleDndProviderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Delay on touch so scrolling the schedule doesn't start a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!editing) return;
    const { active, over } = event;
    if (!over) return;

    const overData = over.data.current as
      | { type?: string; spaceId?: string; spaceName?: string; dayCode?: string }
      | undefined;
    if (overData?.type !== "map-slot" || !overData.spaceId || !overData.spaceName || !overData.dayCode) return;

    const dayMeta = DAYS.find((d) => d.code === overData.dayCode);
    if (!dayMeta) return;

    // Vertical position of the dragged element relative to the column top is
    // what makes a drop land on a real time rather than just in a column.
    const translatedRect = active.rect.current.translated;
    if (!translatedRect) return;
    const startTime = pixelOffsetToStartTime(translatedRect.top - over.rect.top);

    const activeData = active.data.current as
      | { type?: "template"; template?: EditorTemplate }
      | { type?: "session"; session?: ExpandedSession }
      | undefined;

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
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}
