"use client";

import type { ReactNode } from "react";
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
 * Neutral header bar with a pill-shaped view toggle (docs/DESIGN.md: the
 * centre's brand colour is an accent — the active view — never a filled bar), letting a viewer
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
  actions,
  dark = false,
}: ScheduleHeaderBarProps) {
  const options = OPTIONS.filter((o) => allowedViews.includes(o.value));
  const switchable = (scopeOptions?.length ?? 0) > 1;

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
        <div className="flex items-center gap-2 max-w-full min-w-0">
          {options.length > 1 && (
            // Five view pills are wider than a phone. The bar wraps them onto their
            // own line, but the card clips the overflow, so the last one ("Floorplan")
            // was cut through the middle of the word with no indication it was
            // reachable. Scrolling the strip itself keeps every view available at
            // 390px without shrinking the labels to nothing.
            <div
              className={cn(
                "inline-flex gap-0.5 rounded-full p-[3px] max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
                      "flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
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
                    <Icon className="w-3.5 h-3.5" />
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
      {switchable && (
        <ScheduleScopeSwitcher
          scopes={scopeOptions!}
          activeId={activeScopeId ?? scopeOptions![0].id}
          onChange={(id) => onScopeChange?.(id)}
          onTint={dark}
          className="basis-full"
        />
      )}
    </div>
  );
}
