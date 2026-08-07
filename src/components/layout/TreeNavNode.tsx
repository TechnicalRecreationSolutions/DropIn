"use client";

import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface TreeNavNodeProps {
  href: string;
  label: string;
  icon: LucideIcon;
  depth: number;
  isActive: boolean;
  isPublished?: boolean;
  /** Count shown at the end of the row, e.g. how many schedules a building has. */
  badge?: number;
}

/**
 * One row in the sidebar. `depth` is kept for the top-level links that
 * render alongside facilities; the nav itself is flat now — the hierarchy
 * below a building lives on the command centre, not here.
 */
export default function TreeNavNode({
  href,
  label,
  icon: Icon,
  depth,
  isActive,
  isPublished,
  badge,
}: TreeNavNodeProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <Link href={href} className="flex-1 flex items-center gap-2 py-1.5 pr-2 pl-1 min-w-0">
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{label}</span>

        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {isPublished === false && (
            <span
              className="size-1.5 rounded-full bg-sidebar-foreground/30"
              title="Draft — not published"
            />
          )}
          {badge !== undefined && (
            <span className="text-[11px] tabular-nums text-sidebar-foreground/40">{badge}</span>
          )}
        </span>
      </Link>
    </div>
  );
}
