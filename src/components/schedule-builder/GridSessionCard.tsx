"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical, Pencil, Copy } from "lucide-react";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatTime } from "@/lib/utils/dates";
import { getSessionCardStyle } from "@/components/schedule/sessionCardColor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface GridSessionCardProps {
  session: ExpandedSession;
  onDuplicate: (session: ExpandedSession) => void;
}

/**
 * One placed session in the Grid builder — a simple flex-stacked card (no
 * time-axis positioning, matching the public WeeklyScheduleGrid), editable
 * and duplicatable via its "⋯" menu. Distinct from GridSessionBlock, which
 * is absolute-positioned/draggable for the Space builder's real time axis.
 */
export default function GridSessionCard({ session, onDuplicate }: GridSessionCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const editHref = `/dashboard/sessions/${session.sessionId}/edit`;
  const displayName = session.templateName ?? session.scheduleGroupName;
  const isPast = session.end < new Date();

  return (
    <div
      className="group relative rounded-md px-2.5 py-2 border text-left"
      style={{
        color: isPast ? "#8FA2AD" : "var(--org-text-on-tint, #1e3a5f)",
        ...getSessionCardStyle(session, isPast),
      }}
    >
      <Link href={editHref} className="block hover:opacity-80">
        <p className="text-xs font-semibold leading-tight truncate pr-5">{displayName}</p>
        <p className="text-xs opacity-75 leading-tight mt-0.5">
          {formatTime(session.start)}–{formatTime(session.end)}
        </p>
      </Link>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          onClick={(e) => e.preventDefault()}
          className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-black/10 opacity-60 hover:opacity-100 transition-opacity"
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
