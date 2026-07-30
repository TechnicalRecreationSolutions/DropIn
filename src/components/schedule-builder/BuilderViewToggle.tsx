"use client";

import { LayoutGrid, List, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { BuilderView } from "./builderShared";

interface BuilderViewToggleProps {
  view: BuilderView;
  onChange: (view: BuilderView) => void;
}

const OPTIONS: { value: BuilderView; label: string; icon: typeof Columns3 }[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
  { value: "space", label: "Map", icon: Columns3 },
];

/**
 * Segmented control for switching how the builder is displayed, matching
 * the public widget's three views. Grid (7 day columns) and List (day-by-
 * day sections) are both simple, no-time-axis views — new sessions are
 * added via a per-day/column "+ Add" button. Map is the only view with a
 * real time axis (physical spaces as columns, drag onto an exact time to
 * place or reschedule) — its internal BuilderView value is still "space"
 * for historical reasons, but it's the builder's equivalent of the public
 * Map view, not a fourth concept.
 */
export default function BuilderViewToggle({ view, onChange }: BuilderViewToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
            aria-pressed={active}
          >
            <Icon className="w-3.5 h-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
