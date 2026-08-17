"use client";

import Link from "next/link";
import { MoreVertical, Pencil, Copy, Clock3, Trash2, CalendarClock } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { cn } from "@/lib/utils/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sessionEditHref, type ScheduleEditingApi } from "./ScheduleEditingContext";

interface SessionActionsMenuProps {
  session: ExpandedSession;
  editing: ScheduleEditingApi;
  /** Tone the trigger for a colored session card vs. a plain white row. */
  variant?: "on-card" | "on-row";
  className?: string;
}

/**
 * The "⋯" affordance overlaid on a session wherever a schedule view is
 * editable. Deliberately an overlay rather than a replacement for the card
 * itself: the card underneath stays byte-for-byte what a visitor sees, so
 * switching between viewing and editing never changes the layout.
 *
 * `onPointerDown` is stopped so opening the menu on a draggable block (Map)
 * doesn't start a drag instead.
 */
export default function SessionActionsMenu({
  session,
  editing,
  variant = "on-card",
  className,
}: SessionActionsMenuProps) {
  const isDeleting = editing.deletingSessionId === session.sessionId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        disabled={isDeleting}
        className={cn(
          "rounded transition-opacity disabled:opacity-30",
          variant === "on-card"
            ? "p-0.5 hover:bg-black/10 opacity-60 hover:opacity-100"
            : "p-1.5 hover:bg-gray-100 text-gray-500 opacity-60 group-hover:opacity-100",
          className
        )}
        aria-label={`Actions for ${session.templateName ?? session.scheduleGroupName}`}
      >
        <MoreVertical className={variant === "on-card" ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={sessionEditHref(session)}>
            <Pencil />
            Edit details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editing.onOverrideWeek(session)}>
          <CalendarClock />
          Override this week…
        </DropdownMenuItem>
        {editing.canDuplicate && (
          <DropdownMenuItem onSelect={() => editing.onAddAnotherTime(session)}>
            <Clock3 />
            Add another time…
          </DropdownMenuItem>
        )}
        {editing.canDuplicate && (
          <DropdownMenuItem onSelect={() => editing.onDuplicate(session)}>
            <Copy />
            Duplicate to…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => editing.onDelete(session)}>
          <Trash2 />
          Remove series
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
