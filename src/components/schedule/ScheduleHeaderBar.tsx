"use client";

import { LayoutGrid, List, Columns3, Image as ImageIcon, Table2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScheduleTemplate } from "@/types/schedule.types";

/** One entry in the header's schedule switcher — see scopeOptions below. */
export interface ScheduleHeaderScope {
  id: string;
  label: string;
}

interface ScheduleHeaderBarProps {
  title: string;
  view: ScheduleTemplate;
  onChange: (view: ScheduleTemplate) => void;
  /** Which views the org has enabled (widget_configs.allowed_templates) — the toggle only offers these. */
  allowedViews: ScheduleTemplate[];
  /** 2+ entries replaces the plain title with a dropdown for switching between schedules
   *  (the widget's multi-schedule filter) — omit for the plain, static title. */
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
      {switchable ? (
        <Select value={activeScopeId} onValueChange={onScopeChange}>
          <SelectTrigger
            aria-label="Choose a schedule"
            className="h-auto w-fit border-0 bg-transparent p-0 gap-1.5 text-white font-semibold text-sm sm:text-base hover:bg-white/10 rounded-md px-1.5 py-1 -mx-1.5 -my-1 focus-visible:ring-white/50 [&_svg]:!text-white [&_svg]:opacity-90"
          >
            {/*
              Radix's SelectValue only auto-derives its text from the
              matching SelectItem once that item has mounted client-side
              (SelectContent isn't in the DOM until first opened) — left to
              its default, the title renders as an empty span until
              hydration + a first open. Passing children explicitly is
              Radix's documented override and is what actually makes this
              server-render correctly, matching the plain-title case below.
            */}
            <SelectValue>{title}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {scopeOptions!.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <h2 className="text-white font-semibold text-sm sm:text-base">{title}</h2>
      )}
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
