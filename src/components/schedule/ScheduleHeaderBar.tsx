"use client";

import type { ReactNode } from "react";
import { LayoutGrid, List, Columns3, Image as ImageIcon, Table2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface ScheduleHeaderBarProps {
  title: string;
  view: ScheduleTemplate;
  onChange: (view: ScheduleTemplate) => void;
  /** Which views the org has enabled (widget_configs.allowed_templates) — the toggle only offers these. */
  allowedViews: ScheduleTemplate[];
  /** The schedule switcher (ScheduleScopeFilters), on its own row under the
   *  title — the embed's and the landing hero's, built the same way. Omit for
   *  a bar with nothing but the title and view toggle. */
  scopeControl?: ReactNode;
  /** Extra controls after the view toggle — the visitor Print button, when the org allows it. */
  actions?: ReactNode;
  /**
   * The widget's dark theme. Written out rather than taken from tokens: the
   * widget renders in an iframe where the dashboard's `.dark` class never
   * exists, so every neutral token resolves to its light value there.
   */
  dark?: boolean;
}

const OPTIONS: { value: ScheduleTemplate; label: string; icon: typeof Columns3 }[] = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
  { value: "map", label: "Map", icon: Columns3 },
  { value: "board", label: "Board", icon: Table2 },
  { value: "floorplan", label: "Floorplan", icon: ImageIcon },
];

/**
 * Phone-width columns by view count: up to three share one row, four split
 * 2 + 2, five split 3 + 2 — never a lone pill stranded on the second row.
 * Literal class names so Tailwind picks them up.
 */
const MOBILE_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2",
  5: "grid-cols-3",
};

/**
 * Neutral header bar with a pill-shaped view toggle (docs/DESIGN.md: the
 * centre's brand colour is an accent — the active view — never a filled bar), letting a viewer
 * switch between the views the org has enabled (widget_configs.
 * allowed_templates) for their own session — the schedule always starts
 * from the first allowed view, but this lets a visitor pick another
 * allowed one without staff involvement. If the org only enabled one view,
 * there's nothing to toggle, so the picker is omitted entirely.
 *
 * With `scopeControl`, a second row carries the schedule switcher
 * (`ScheduleScopeFilters`) — the widget's multi-schedule filter. The three
 * non-widget callers (public facility page, schedule command centre) pass none
 * and render exactly the title + view toggle they always have.
 */
export default function ScheduleHeaderBar({
  title,
  view,
  onChange,
  allowedViews,
  scopeControl,
  actions,
  dark = false,
}: ScheduleHeaderBarProps) {
  const options = OPTIONS.filter((o) => allowedViews.includes(o.value));

  return (
    <div
      className={cn(
        "rounded-t-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-b",
        dark ? "bg-gray-900 border-white/10" : "bg-card border-border"
      )}
    >
      {/* The title stays put whether or not there are scopes. The switcher used
          to replace it, which silently dropped the org's own custom_title the
          moment a second filter was added. */}
      <h2
        className={cn(
          "font-semibold text-base tracking-[-0.01em]",
          dark ? "text-white" : "text-foreground"
        )}
      >
        {title}
      </h2>
      {(options.length > 1 || actions) && (
        <div className="flex items-center gap-2 w-full min-w-0 sm:w-auto">
          {options.length > 1 && (
            // Every view stays visible — seeing them all is what gets visitors to
            // try another one. Below `sm` five pills don't fit on one line (a
            // scrolling strip hid the last ones), so the toggle takes the full
            // width and splits them over two balanced rows (MOBILE_COLUMNS);
            // from `sm` up it is the usual single pill.
            <div
              className={cn(
                "grid flex-1 min-w-0 gap-0.5 rounded-2xl p-[3px]",
                MOBILE_COLUMNS[options.length] ?? "grid-cols-3",
                "sm:inline-flex sm:flex-none sm:rounded-full",
                dark ? "bg-white/10" : "bg-muted"
              )}
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
                      "flex min-w-0 whitespace-nowrap items-center justify-center gap-1.5 px-2 sm:px-3 sm:shrink-0 py-1.5 rounded-full text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                      active
                        ? "bg-white font-semibold shadow-[0_1px_2px_rgba(17,17,19,0.1)]"
                        : dark
                          ? "font-medium text-white/75 hover:text-white"
                          : "font-medium text-muted-foreground hover:text-foreground"
                    )}
                    // The one place the centre's colour shows in the bar.
                    style={active ? { color: "var(--org-primary, var(--brand))" } : undefined}
                    aria-pressed={active}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
          {actions}
        </div>
      )}

      {/* Its own full-width row inside the bar: the pills need the width, and
          putting them beside the title is what forced the old design to choose
          between showing a title and showing a switcher. */}
      {scopeControl && <div className="basis-full min-w-0">{scopeControl}</div>}
    </div>
  );
}
