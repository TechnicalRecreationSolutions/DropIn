"use client";

import { Check, Lock, Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import LayoutThumbnail from "./LayoutThumbnail";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface LayoutPickerProps {
  /** Ordered — index 0 is the view the widget boots into. */
  value: ScheduleTemplate[];
  onChange: (next: ScheduleTemplate[]) => void;
  /** Floorplan needs a published facility map and a single-facility scope. */
  floorplanAvailable: boolean;
  disabled?: boolean;
}

const LAYOUTS: { value: ScheduleTemplate; label: string; blurb: string }[] = [
  { value: "grid", label: "Week grid", blurb: "The whole week, one column per day." },
  { value: "list", label: "List", blurb: "Day by day — easiest to read on a phone." },
  { value: "map", label: "By space", blurb: "Grouped by pool, gym, studio, court." },
  { value: "board", label: "Timetable", blurb: "Times down the side, days across." },
  { value: "floorplan", label: "Floorplan", blurb: "A picture of your building, tap a space." },
];

/**
 * The "which views can visitors use" picker.
 *
 * Two things are being chosen at once and the UI has to keep them apart: which
 * views are *available* (the set), and which one *loads first* (the order —
 * `allowed_templates[0]`, which is what `WidgetScheduleClient` boots into). The
 * order already round-trips through the API as an array, so the default view is
 * a free feature; it just needed to be sayable.
 */
export default function LayoutPicker({ value, onChange, floorplanAvailable, disabled }: LayoutPickerProps) {
  function toggle(template: ScheduleTemplate) {
    if (value.includes(template)) {
      // At least one view has to stay on — a widget with nothing to render is
      // not a state worth supporting.
      if (value.length === 1) return;
      onChange(value.filter((t) => t !== template));
      return;
    }
    onChange([...value, template]);
  }

  function makeDefault(template: ScheduleTemplate) {
    onChange([template, ...value.filter((t) => t !== template)]);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {LAYOUTS.map(({ value: template, label, blurb }) => {
        const checked = value.includes(template);
        const isDefault = checked && value[0] === template;
        const locked = template === "floorplan" && !floorplanAvailable;
        const isDisabled = disabled || locked;

        return (
          <div
            key={template}
            className={cn(
              "relative flex flex-col rounded-xl border bg-card transition-all",
              checked ? "border-blue-600 ring-2 ring-blue-600/25" : "border-border",
              isDisabled && "opacity-55"
            )}
          >
            {/* Full-card hit target sits *under* the artwork, so the whole tile
                toggles while the "Loads first" control above it stays clickable. */}
            <button
              type="button"
              onClick={() => toggle(template)}
              disabled={isDisabled}
              aria-pressed={checked}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            >
              <span className="sr-only">
                {label}
                {locked ? " — needs a published facility map" : ""}
              </span>
            </button>

            <div className="relative z-[1] flex-1 pointer-events-none p-2.5">
              <div
                className={cn(
                  "rounded-lg overflow-hidden border border-border/60 bg-muted/40 p-1.5",
                  checked ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"
                )}
              >
                <LayoutThumbnail template={template} />
              </div>
              <p className="mt-2 text-sm font-medium text-foreground flex items-center gap-1.5">
                {label}
                {locked && <Lock className="w-3 h-3 text-muted-foreground" />}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground mt-0.5">
                {locked ? "Publish a facility map to unlock." : blurb}
              </p>
            </div>

            {/* In flow, not floated over the blurb — overlapping the copy made
                "Load first" read as the end of the description. */}
            {checked && !isDefault && (
              <div className="relative z-[2] px-2.5 pb-2.5">
                <button
                  type="button"
                  onClick={() => makeDefault(template)}
                  aria-label={`Make ${label} load first`}
                  className="w-full py-1 rounded-md bg-muted text-[11px] font-medium text-muted-foreground hover:bg-blue-600 hover:text-white transition-colors"
                >
                  Load first
                </button>
              </div>
            )}

            {checked && (
              <span className="absolute top-2 right-2 z-[2] inline-flex items-center justify-center size-5 rounded-full bg-blue-600 text-white pointer-events-none">
                <Check className="w-3 h-3" />
              </span>
            )}

            {isDefault && (
              <span className="absolute -top-2 left-2.5 z-[2] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-semibold pointer-events-none">
                <Star className="w-2.5 h-2.5 fill-current" />
                Loads first
              </span>
            )}

          </div>
        );
      })}
    </div>
  );
}
