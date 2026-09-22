"use client";

import { useState } from "react";

/**
 * Views by weekday and hour — when people actually look at the schedule.
 *
 * The most operationally useful chart on the page, and the reason is specific
 * to recreation: a centre that knows its schedule is read at 6am and at 8pm
 * knows when it can afford to change one, and when a last-minute pool closure
 * needs a phone call instead of a website update.
 *
 * Built from divs rather than SVG so every cell is a real focusable element —
 * a heatmap whose values can only be read by hovering is unusable on the
 * phone most of these visitors are holding, and unusable with a keyboard
 * anywhere. Tapping or focusing a cell writes it into the caption below.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The sequential ramp, as tokens. Step 0 is "nothing happened". */
const STEPS = [
  "var(--viz-heat-0)",
  "var(--viz-heat-1)",
  "var(--viz-heat-2)",
  "var(--viz-heat-3)",
  "var(--viz-heat-4)",
  "var(--viz-heat-5)",
  "var(--viz-heat-6)",
];

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

interface ActivityHeatmapProps {
  /** 7 rows of 24 view counts, Sunday first. */
  heatmap: number[][];
  busiest: { weekday: number; hour: number; views: number } | null;
}

export function ActivityHeatmap({ heatmap, busiest }: ActivityHeatmapProps) {
  const [selected, setSelected] = useState<{ weekday: number; hour: number } | null>(null);

  const peak = Math.max(...heatmap.flat(), 0);
  if (peak === 0) {
    return (
      <p className="text-sm text-muted-foreground/70 py-8 text-center">
        No views recorded yet, so there is nothing to place on a clock.
      </p>
    );
  }

  /** Magnitude to ramp step. Any non-zero count gets at least step 1, so a
   *  single quiet view is never painted as "nothing happened". */
  function step(count: number): string {
    if (count === 0) return STEPS[0];
    return STEPS[Math.max(1, Math.ceil((count / peak) * (STEPS.length - 1)))];
  }

  const shown = selected ?? busiest;
  const shownCount = shown ? heatmap[shown.weekday][shown.hour] : 0;

  return (
    <div>
      {/* The grid scrolls sideways on a phone rather than shrinking cells to
          invisibility — 24 hours cannot fit in 320px and stay tappable.

          Leaving the grid with a mouse drops back to the busiest hour. A
          touch never fires that, so a tapped cell stays put — which is the
          behaviour each input actually wants. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1" onMouseLeave={() => setSelected(null)}>
        <div className="min-w-[34rem]">
          <div className="flex">
            <div className="w-9 shrink-0" />
            <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-px">
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="text-[9px] text-muted-foreground text-center leading-4">
                  {/* "6a" / "6p", not a bare "6": a clock with two 6s and no
                      meridiem is the one label worse than none. */}
                  {hour % 3 === 0 ? formatHour(hour).replace(/m$/, "") : ""}
                </div>
              ))}
            </div>
          </div>

          {heatmap.map((row, weekday) => (
            <div key={weekday} className="flex items-center">
              <div className="w-9 shrink-0 pr-1.5 text-right text-[10px] text-muted-foreground">
                {WEEKDAYS[weekday]}
              </div>
              <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-px py-px">
                {row.map((count, hour) => {
                  const isSelected = selected?.weekday === weekday && selected?.hour === hour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      // Selects, never toggles. `onMouseEnter` has already
                      // selected this cell by the time a click lands, so a
                      // toggle here would clear the caption on the very
                      // click meant to pin it.
                      onClick={() => setSelected({ weekday, hour })}
                      onMouseEnter={() => setSelected({ weekday, hour })}
                      onFocus={() => setSelected({ weekday, hour })}
                      aria-label={`${WEEKDAYS[weekday]} ${formatHour(hour)}: ${count} view${count === 1 ? "" : "s"}`}
                      className="h-4 rounded-[2px] outline-none ring-offset-1 ring-offset-card transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-foreground/40"
                      aria-pressed={isSelected}
                      style={{ backgroundColor: step(count) }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {shown ? (
            <>
              <span className="font-medium text-foreground">
                {WEEKDAYS[shown.weekday]} {formatHour(shown.hour)}
              </span>{" "}
              — {shownCount} view{shownCount === 1 ? "" : "s"}
              {!selected && " (busiest hour)"}
            </>
          ) : (
            "Tap a square for its count."
          )}
        </p>

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>Fewer</span>
          {STEPS.map((color) => (
            <span key={color} className="size-3 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
