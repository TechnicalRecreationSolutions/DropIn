"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ExpandedSession } from "@/types/schedule.types";
import { cn } from "@/lib/utils/cn";
import { SLOT_HEIGHT_PX } from "./builderShared";
import GridSessionBlock from "./GridSessionBlock";

interface SpaceColumnProps {
  spaceId: string;
  spaceName: string;
  dayCode: string;
  sessions: ExpandedSession[];
  heightPx: number;
  slotCount: number;
  onDuplicate: (session: ExpandedSession) => void;
}

/**
 * One physical space's drop zone for the currently selected day, on a real
 * hour-by-hour time axis (matching the public WeeklyScheduleMap and the
 * builder's Grid view) — droppable id encodes both the space and the day so
 * SpaceBuilderClient's onDragEnd knows where a template was dropped, and the
 * vertical drop position (converted via pixelOffsetToStartTime) sets the
 * start time, exactly like the day-columns in GridBuilderClient.
 */
export default function SpaceColumn({
  spaceId,
  spaceName,
  dayCode,
  sessions,
  heightPx,
  slotCount,
  onDuplicate,
}: SpaceColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `space-${spaceId}-${dayCode}`,
    data: { type: "space-slot", spaceId, spaceName, dayCode },
  });

  return (
    <div className="min-w-[180px]">
      <div
        className="text-center text-xs font-bold py-2 rounded-t-lg text-white truncate px-2"
        style={{ backgroundColor: "var(--org-primary, #2563eb)" }}
      >
        {spaceName}
      </div>
      <div
        ref={setNodeRef}
        className={cn("relative rounded-b-lg border border-t-0 border-gray-200 transition-colors", isOver ? "bg-blue-50" : "bg-gray-50")}
        style={{ height: heightPx + "px" }}
      >
        {Array.from({ length: slotCount }, (_, i) => (
          <div
            key={i}
            className={cn("absolute inset-x-0 border-b", i % 2 === 0 ? "border-gray-200" : "border-gray-100")}
            style={{ top: i * SLOT_HEIGHT_PX + "px", height: SLOT_HEIGHT_PX + "px" }}
          />
        ))}

        {sessions.length === 0 && (
          <p className="absolute inset-x-0 top-4 text-xs text-gray-400 text-center">Drop a template here</p>
        )}
        {sessions.map((session) => (
          <GridSessionBlock key={session.key} session={session} onDuplicate={onDuplicate} />
        ))}
      </div>
    </div>
  );
}
