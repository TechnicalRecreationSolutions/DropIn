"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical, Pencil, Copy } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ListSessionRowProps {
  session: ExpandedSession;
  onDuplicate: (session: ExpandedSession) => void;
}

/** One placed session in the List builder — editable/duplicatable via its "⋯" menu, matching Grid/Space's affordances. */
export default function ListSessionRow({ session, onDuplicate }: ListSessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const color = session.templateColor;
  const editHref = `/dashboard/sessions/${session.sessionId}/edit`;
  const displayName = session.templateName ?? session.scheduleGroupName;

  return (
    <li className="flex items-center gap-3 py-2.5 group">
      <span
        className={cn("w-2.5 h-2.5 rounded-full shrink-0", !color && "bg-blue-400")}
        style={color ? { backgroundColor: color } : undefined}
      />
      <Link href={editHref} className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-80">
        <span className="w-24 sm:w-28 shrink-0 text-xs font-medium text-gray-500">
          {formatTime(session.start)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-900 truncate">{displayName}</span>
          {(session.spaceNames.length > 0 || session.locationDetail) && (
            <span className="block text-xs text-gray-400 truncate">
              {[session.spaceNames.join(", "), session.locationDetail].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </Link>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="p-1.5 rounded hover:bg-gray-100 opacity-60 group-hover:opacity-100 transition-opacity"
          aria-label="Session actions"
        >
          <MoreVertical className="w-4 h-4 text-gray-500" />
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
    </li>
  );
}
