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
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export default function TreeNavNode({
  href,
  label,
  icon: Icon,
  depth,
  isActive,
  isPublished,
  hasChildren,
  isExpanded,
  onToggle,
}: TreeNavNodeProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
          className="shrink-0 p-1 rounded hover:bg-sidebar-accent/80"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}

      <Link
        href={href}
        className="flex-1 flex items-center gap-2 py-1.5 pr-2 min-w-0"
      >
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{label}</span>
        {isPublished === false && (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-full bg-sidebar-foreground/30"
            title="Draft — not published"
          />
        )}
      </Link>
    </div>
  );
}
