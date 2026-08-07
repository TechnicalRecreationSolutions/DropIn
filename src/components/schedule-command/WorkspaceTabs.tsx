"use client";

import { CalendarRange, MapPin, Map as MapIcon, Code2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceTab } from "@/lib/schedule/commandCentreHref";

const TABS: { value: WorkspaceTab; label: string; icon: typeof MapPin; hint: string }[] = [
  { value: "schedule", label: "Schedule", icon: CalendarRange, hint: "Place and edit sessions" },
  { value: "spaces", label: "Spaces", icon: MapPin, hint: "Lanes, courts, studios" },
  { value: "map", label: "Map", icon: MapIcon, hint: "Draw this building's floorplan" },
  { value: "widget", label: "Widget", icon: Code2, hint: "Embed code and appearance" },
];

interface WorkspaceTabsProps {
  tab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  /** Name of the scope the tabs act on, shown so it's never ambiguous what's being edited. */
  scopeLabel: string;
  /** The Map is drawn per building, so it's labelled with the facility even when a department is in scope. */
  facilityName: string;
}

/**
 * The four jobs a building involves, on one page.
 *
 * These used to be three separate routes — the facility page (spaces, map,
 * widget), the department page (spaces, widget), and the schedule builder —
 * each re-deriving the same context. Here they're tabs over a single scope
 * selection, so switching between "what's scheduled" and "where it happens"
 * never loses your place.
 */
export default function WorkspaceTabs({
  tab,
  onChange,
  scopeLabel,
  facilityName,
}: WorkspaceTabsProps) {
  return (
    <div className="border-b border-gray-200">
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((option) => {
          const Icon = option.icon;
          const active = tab === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-current={active ? "page" : undefined}
              title={
                option.value === "map"
                  ? `${option.hint} (${facilityName})`
                  : `${option.hint} — ${scopeLabel}`
              }
              className={cn(
                "flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                active
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              )}
            >
              <Icon className="w-4 h-4" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
