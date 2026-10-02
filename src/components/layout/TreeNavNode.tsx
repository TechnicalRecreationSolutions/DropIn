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
  /**
   * How the badge reads. `muted` (default) is a quiet count, e.g. schedules
   * in a building. `solid` and `urgent` are an inbox: a pill that says
   * something is waiting (brand blue), or that something is urgent (destructive).
   * In the collapsed sidebar those two become a dot on the icon.
   */
  badgeTone?: "muted" | "solid" | "urgent";
  /** Screen-reader text for the badge, e.g. "3 things need you". */
  badgeLabel?: string;
  /** Renders a chevron that toggles `expanded` without navigating. Used by the facility row. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Renders as an inert, muted row instead of a link — e.g. a menu item with nothing to scope to yet. */
  disabled?: boolean;
  disabledReason?: string;
  /** Icon-only mode for the collapsed sidebar — hides the label and centers the icon. */
  collapsed?: boolean;
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
  badgeTone = "muted",
  badgeLabel,
  expandable,
  expanded,
  onToggleExpand,
  disabled,
  disabledReason,
  collapsed,
}: TreeNavNodeProps) {
  const showPill = badge !== undefined && badge > 0 && badgeTone !== "muted";
  const rowContent = (
    <>
      <span className="relative inline-flex shrink-0">
        <Icon className={cn("size-4", isActive && !disabled ? "text-foreground" : "text-muted-foreground")} />
        {collapsed && showPill && (
          <span
            aria-hidden
            className={cn(
              "absolute -top-1 -right-1 size-2 rounded-full ring-2 ring-background",
              badgeTone === "urgent" ? "bg-destructive" : "bg-brand"
            )}
          />
        )}
      </span>
      {collapsed && showPill && badgeLabel && <span className="sr-only">{badgeLabel}</span>}
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>

          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {isPublished === false && (
              <span
                className="size-1.5 rounded-full bg-muted-foreground"
                title="Draft — not published"
              />
            )}
            {badge !== undefined && badgeTone === "muted" && (
              <span className="text-label tabular-nums text-muted-foreground">{badge}</span>
            )}
            {showPill && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-label tabular-nums",
                  badgeTone === "urgent"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-brand text-brand-foreground"
                )}
              >
                <span aria-hidden>{badge}</span>
                {badgeLabel && <span className="sr-only">{badgeLabel}</span>}
              </span>
            )}
          </span>
        </>
      )}
    </>
  );

  return (
    <div
      className={cn(
        "group relative flex h-9 items-center gap-0.5 rounded-control text-sm font-medium transition-colors duration-150",
        disabled
          ? "text-muted-foreground opacity-60 cursor-not-allowed"
          : isActive
            ? "bg-muted font-semibold text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
            : "text-foreground hover:bg-muted"
      )}
      style={{ paddingLeft: collapsed ? undefined : `${depth * 14 + 8}px` }}
    >
      {expandable && !collapsed && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleExpand?.();
          }}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          className="inline-flex size-6 items-center justify-center rounded-full shrink-0 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
      )}
      {disabled ? (
        <span
          className={cn(
            "flex-1 flex h-full items-center gap-2.5 min-w-0",
            collapsed ? "justify-center px-2" : "pr-2 pl-1"
          )}
          title={disabledReason ?? (collapsed ? label : undefined)}
          aria-disabled="true"
        >
          {rowContent}
        </span>
      ) : (
        <Link
          href={href}
          className={cn(
            "flex-1 flex h-full items-center gap-2.5 min-w-0 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "justify-center px-2" : "pr-2 pl-1"
          )}
          title={collapsed ? label : undefined}
        >
          {rowContent}
        </Link>
      )}
    </div>
  );
}
