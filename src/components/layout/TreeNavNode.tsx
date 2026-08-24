"use client";

import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
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
  /** Renders a chevron that toggles `expanded` without navigating. Used by the facility row. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Renders as an inert, muted row instead of a link — e.g. a menu item with nothing to scope to yet. */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * One row in the sidebar. `depth` indents nested rows — facility at 0,
 * department/schedule/settings leaves below it. The chevron (when
 * `expandable`) is a sibling of the link, not nested inside it, since a
 * button inside an anchor is invalid HTML: clicking it toggles the row's
 * children without triggering the link's navigation.
 */
export default function TreeNavNode({
  href,
  label,
  icon: Icon,
  depth,
  isActive,
  isPublished,
  badge,
  expandable,
  expanded,
  onToggleExpand,
  disabled,
  disabledReason,
}: TreeNavNodeProps) {
  const rowContent = (
    <>
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
    </>
  );

  return (
    <div
      className={cn(
        "group flex items-center gap-0.5 rounded-md text-sm transition-colors",
        disabled
          ? "text-sidebar-foreground/30 cursor-not-allowed"
          : isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      {expandable && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleExpand?.();
          }}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          className="p-0.5 rounded hover:bg-sidebar-accent shrink-0 text-sidebar-foreground/40"
        >
          <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        </button>
      )}
      {disabled ? (
        <span
          className="flex-1 flex items-center gap-2 py-1.5 pr-2 pl-1 min-w-0"
          title={disabledReason}
          aria-disabled="true"
        >
          {rowContent}
        </span>
      ) : (
        <Link href={href} className="flex-1 flex items-center gap-2 py-1.5 pr-2 pl-1 min-w-0">
          {rowContent}
        </Link>
      )}
    </div>
  );
}
