"use client";

import { LayoutGrid, List, Columns3, Image as ImageIcon, Table2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import ScheduleScopeSwitcher, { type ScheduleScope } from "./ScheduleScopeSwitcher";
import type { ScheduleTemplate } from "@/types/schedule.types";

/** One entry in the header's schedule switcher — see scopeOptions below. */
export type ScheduleHeaderScope = ScheduleScope;

interface ScheduleHeaderBarProps {
  title: string;
  view: ScheduleTemplate;
  onChange: (view: ScheduleTemplate) => void;
  /** Which views the org has enabled (widget_configs.allowed_templates) — the toggle only offers these. */
  allowedViews: ScheduleTemplate[];
  /** 2+ entries adds a schedule switcher on its own row under the title (the widget's
   *  multi-schedule filter) — omit for a bar with nothing but the title and view toggle. */
  scopeOptions?: ScheduleHeaderScope[];
  activeScopeId?: string;
  onScopeChange?: (id: string) => void;
}

const OPTIONS: { value: ScheduleTemplate; label: string; icon: typeof Columns3 }[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
  { value: "map", label: "Map", icon: Columns3 },
  { value: "board", label: "Board", icon: Table2 },
  { value: "floorplan", label: "Floorplan", icon: ImageIcon },
];

/**
 * Org-colored header bar with a pill-shaped view toggle, letting a viewer
 * switch between the views the org has enabled (widget_configs.
 * allowed_templates) for their own session — the schedule always starts
 * from the first allowed view, but this lets a visitor pick another
 * allowed one without staff involvement. If the org only enabled one view,
 * there's nothing to toggle, so the picker is omitted entirely.
 *
 * With `scopeOptions`, a second row carries the schedule switcher
 * (`ScheduleScopeSwitcher`) — the widget's multi-schedule filter. The three
 * non-widget callers (public facility page, schedule command centre) pass none
 * and render exactly the title + view toggle they always have.
 */
export default function ScheduleHeaderBar({
  title,
  view,
  onChange,
  allowedViews,
  scopeOptions,
  activeScopeId,
  onScopeChange,
}: ScheduleHeaderBarProps) {
  const options = OPTIONS.filter((o) => allowedViews.includes(o.value));
  const switchable = (scopeOptions?.length ?? 0) > 1;

  return (
    <div
      className="rounded-t-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      style={{ backgroundColor: "var(--org-primary)" }}
    >
      {/* The title stays put whether or not there are scopes. The switcher used
          to replace it, which silently dropped the org's own custom_title the
          moment a second filter was added. */}
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
                  active ? "bg-card" : "text-white/90 hover:text-white"
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

      {/* Its own full-width row inside the bar: the pills need the width, and
          putting them beside the title is what forced the old design to choose
          between showing a title and showing a switcher. */}
      {switchable && (
        <ScheduleScopeSwitcher
          scopes={scopeOptions!}
          activeId={activeScopeId ?? scopeOptions![0].id}
          onChange={(id) => onScopeChange?.(id)}
          onTint
          className="basis-full"
        />
      )}
    </div>
  );
}
