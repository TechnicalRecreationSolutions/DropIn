"use client";

import { useState } from "react";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { MoreVertical, Pencil, Copy } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime } from "@/lib/utils/dates";
import { getSportColor } from "@/components/schedule/sportColors";
import { cn } from "@/lib/utils/cn";
import { getSessionPixelPosition, SLOT_HEIGHT_PX } from "./builderShared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface GridSessionBlockProps {
  session: ExpandedSession;
  onDuplicate: (session: ExpandedSession) => void;
}

/**
 * A placed session rendered on a time axis — absolute-positioned by pixel
 * top/height (same geometry as the read-only WeeklyScheduleGrid/Map, via
 * builderShared's getSessionPixelPosition) and draggable so it can be moved
 * to a new day/space/time. Shared by both the Grid builder (day columns)
 * and the Space builder (space columns) — the block itself has no
 * day/space-specific logic, only the column it's dropped into does.
 */
export default function GridSessionBlock({ session, onDuplicate }: GridSessionBlockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const color = session.templateColor;
  const editHref = `/dashboard/sessions/${session.sessionId}/edit`;
  const displayName = session.templateName ?? session.scheduleGroupName;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `session-${session.sessionId}-${session.key}`,
    data: { type: "session", session },
  });

  const { top, height } = getSessionPixelPosition(session.start, session.end);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group absolute inset-x-1 rounded-lg border-l-4 px-2 py-1 text-left overflow-hidden",
        "cursor-grab active:cursor-grabbing touch-none transition-opacity",
        !color && getSportColor(session.sportCategory),
        isDragging && "opacity-40"
      )}
      style={{
        top: top + "px",
        height: height + "px",
        ...(color ? { backgroundColor: `${color}1A`, borderColor: color } : {}),
      }}
      title={displayName}
    >
      <p className="text-xs font-semibold leading-tight truncate pr-4">{displayName}</p>
      {height >= SLOT_HEIGHT_PX && (
        <p className="text-xs opacity-75 leading-tight truncate">
          {formatTime(session.start)}–{formatTime(session.end)}
        </p>
      )}

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 p-0.5 rounded hover:bg-black/10 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Session actions"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={editHref}>
              <Pencil />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDuplicate(session)}>
            <Copy />
            Duplicate to…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
