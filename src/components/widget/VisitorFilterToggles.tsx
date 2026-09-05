"use client";

import {
  CalendarDays,
  Check,
  Clock,
  MapPin,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SessionFilterKey } from "@/lib/schedule/sessionFilters";

interface VisitorFilterTogglesProps {
  value: SessionFilterKey[];
  onChange: (next: SessionFilterKey[]) => void;
  disabled?: boolean;
}

const FILTERS: {
  key: SessionFilterKey;
  label: string;
  blurb: string;
  Icon: typeof Search;
}[] = [
  {
    key: "search",
    label: "Search",
    blurb: "Type a name, e.g. Water Walking.",
    Icon: Search,
  },
  {
    key: "activity",
    label: "Activity",
    blurb: "Pick from what's actually on that week.",
    Icon: Sparkles,
  },
  {
    key: "day",
    label: "Day",
    blurb: "Only the days they can come.",
    Icon: CalendarDays,
  },
  {
    key: "time",
    label: "Time of day",
    blurb: "Morning, afternoon or evening.",
    Icon: Clock,
  },
  {
    key: "space",
    label: "Where",
    blurb: "Which pool, court or studio.",
    Icon: MapPin,
  },
  {
    key: "age",
    label: "Who it's for",
    blurb: "Your age groups, where you set them.",
    Icon: Users,
  },
  {
    key: "week",
    label: "Jump to a week",
    blurb: "Go straight to a date, no paging.",
    Icon: CalendarDays,
  },
];

/**
 * Which general filters visitors get (`widget_configs.enabled_filters`).
 *
 * Separate from the schedule switcher below it: that one is a list *you* write
 * (this building, that department), while these narrow whatever is on screen
 * by what it is and when it runs. Both are visitor-facing, both are optional,
 * which is why they share step 3.
 *
 * Turning one on is not a promise that it appears: the widget hides any filter
 * the loaded week has fewer than two values for, so enabling "Where" at a
 * single-space facility costs nothing.
 */
export default function VisitorFilterToggles({
  value,
  onChange,
  disabled,
}: VisitorFilterTogglesProps) {
  function toggle(key: SessionFilterKey) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {FILTERS.map(({ key, label, blurb, Icon }) => {
          const active = value.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              disabled={disabled}
              aria-pressed={active}
              className={cn(
                "relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all disabled:opacity-50",
                active
                  ? "border-blue-600 ring-2 ring-blue-600/25 bg-blue-50/60 dark:bg-blue-950/30"
                  : "border-border bg-card hover:border-blue-300 hover:bg-muted/50"
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center size-8 rounded-lg shrink-0",
                  active ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
              </span>
              <span className="min-w-0 pr-5">
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{blurb}</span>
              </span>
              {active && (
                <span className="absolute top-2 right-2 inline-flex items-center justify-center size-5 rounded-full bg-blue-600 text-white">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? "No filter bar — visitors just read the schedule."
          : "A filter only appears when that week has at least two of them to choose between, so an unused one never shows up empty."}
      </p>
    </div>
  );
}
