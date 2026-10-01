"use client";

import { Switch } from "@/components/ui/switch";
import type { SessionFilterKey } from "@/lib/schedule/sessionFilters";

interface VisitorFilterTogglesProps {
  value: SessionFilterKey[];
  onChange: (next: SessionFilterKey[]) => void;
  disabled?: boolean;
}

export const FILTER_LABELS: Record<SessionFilterKey, string> = {
  search: "Search",
  activity: "Activity",
  day: "Day",
  time: "Time of day",
  space: "Where",
  age: "Who it's for",
  week: "Jump to a week",
};

const FILTERS: { key: SessionFilterKey; blurb: string }[] = [
  { key: "search", blurb: "Type a name, e.g. Water Walking." },
  { key: "activity", blurb: "Pick from what's on that week." },
  { key: "day", blurb: "Only the days they can come." },
  { key: "time", blurb: "Morning, afternoon or evening." },
  { key: "space", blurb: "Which pool, court or studio." },
  { key: "age", blurb: "Your age groups, where you set them." },
  { key: "week", blurb: "Go straight to a date, no paging." },
];

/**
 * Which general filters visitors get (`widget_configs.enabled_filters`).
 *
 * Separate from the schedule switcher in the Schedules section: that one is a
 * list *you* write (this facility, that department), while these narrow
 * whatever is on screen by what it is and when it runs.
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
    <div className="space-y-2">
      <ul className="rounded-card border border-border divide-y divide-border">
        {FILTERS.map(({ key, blurb }) => {
          const labelId = `widget-filter-${key}`;
          return (
            <li key={key} className="flex items-center gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <span id={labelId} className="block text-body font-medium text-foreground">
                  {FILTER_LABELS[key]}
                </span>
                <span className="block text-caption text-muted-foreground">{blurb}</span>
              </div>
              <Switch
                checked={value.includes(key)}
                onCheckedChange={() => toggle(key)}
                disabled={disabled}
                aria-labelledby={labelId}
              />
            </li>
          );
        })}
      </ul>
      <p className="text-caption text-muted-foreground">
        {value.length === 0
          ? "No filter bar. Visitors just read the schedule."
          : "Each filter only appears when the week has two or more options to choose from."}
      </p>
    </div>
  );
}
