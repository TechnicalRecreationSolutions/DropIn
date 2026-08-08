"use client";

import { LayoutGrid, List, Columns3, Image as ImageIcon, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface ScheduleHeaderBarProps {
  title: string;
  view: ScheduleTemplate;
  onChange: (view: ScheduleTemplate) => void;
  /** Which views the org has enabled (widget_configs.allowed_templates) — the toggle only offers these. */
  allowedViews: ScheduleTemplate[];
}

const OPTIONS: { value: ScheduleTemplate; label: string; icon: typeof Columns3 }[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
  { value: "map", label: "Map", icon: Columns3 },
  { value: "floorplan", label: "Floorplan", icon: ImageIcon },
  { value: "events", label: "Events", icon: CalendarDays },
];

/**
 * Org-colored header bar with a pill-shaped view toggle, letting a viewer
 * switch between the views the org has enabled (widget_configs.
 * allowed_templates) for their own session — the schedule always starts
 * from the first allowed view, but this lets a visitor pick another
 * allowed one without staff involvement. If the org only enabled one view,
 * there's nothing to toggle, so the picker is omitted entirely.
 */
export default function ScheduleHeaderBar({ title, view, onChange, allowedViews }: ScheduleHeaderBarProps) {
  const options = OPTIONS.filter((o) => allowedViews.includes(o.value));

  return (
    <div
      className="rounded-t-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      style={{ backgroundColor: "var(--org-primary)" }}
    >
      <h2 className="text-white font-semibold text-sm sm:text-base">{title}</h2>
      {options.length > 1 && (
        <div
          className="inline-flex gap-0.5 rounded-full p-0.5"
          style={{ backgroundColor: "rgba(255,255,255,.18)" }}
          role="group"
          aria-label="Choose a view"
        >
          {options.map((option) => {
            const Icon = option.icon;
            const active = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  active ? "bg-white" : "text-white/90 hover:text-white"
                )}
                style={active ? { color: "var(--org-primary)" } : undefined}
                aria-pressed={active}
              >
                <Icon className="w-3.5 h-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
