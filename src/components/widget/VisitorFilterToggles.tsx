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
 * (this facility, that department), while these narrow whatever is on screen
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
                "relative flex items-start gap-2.5 rounded-card border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                active
                  ? "border-brand bg-brand-subtle"
                  : "border-border bg-card hover:bg-muted"
              )}
            >
              <Icon
                aria-hidden
                className={cn("mt-0.5 size-4 shrink-0", active ? "text-brand-strong" : "text-muted-foreground")}
              />
              <span className="min-w-0 pr-5">
                <span className="block text-body font-medium text-foreground">{label}</span>
                <span className="block text-label font-normal text-muted-foreground">{blurb}</span>
              </span>
              {active && (
                <span className="absolute top-2 right-2 inline-flex items-center justify-center size-5 rounded-full bg-brand text-brand-foreground">
                  <Check className="size-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-caption text-muted-foreground">
        {value.length === 0
          ? "No filter bar — visitors just read the schedule."
          : "Each filter only appears when the week has two or more options to choose from."}
      </p>
    </div>
  );
}
