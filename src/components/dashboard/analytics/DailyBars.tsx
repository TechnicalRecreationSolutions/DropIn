"use client";

import { useState } from "react";

/**
 * One bar per day, against a reference the bar can be read as a share of.
 *
 * Used by Utilization (programmed hours against open hours) and by Attendance
 * (peak count per day, no reference). Two callers, one chart, because they are
 * the same form: a magnitude over time with an optional target behind it.
 *
 * ## It is not a dual-axis chart, and must never become one
 *
 * The bar and the track are **the same measure on one scale** — hours against
 * hours, people against capacity. That is what makes the comparison mean
 * something: the bar is literally a fraction of the track. Plotting a second
 * measure with its own scale here (attendance against hours, say) would be the
 * dual-axis chart, which can be made to show any relationship you like by
 * choosing the scales. Two measures want two charts.
 *
 * ## Divs, not SVG
 *
 * Every bar is a real focusable element, so the values can be read with a
 * keyboard and on a phone, where hover does not exist. The selected bar writes
 * itself into the caption underneath rather than into a floating tooltip —
 * same pattern as `ActivityHeatmap`, and for the same reason.
 *
 * ## Long ranges bucket into weeks
 *
 * A year is 366 bars, which at any readable width is a 1px comb. Past a
 * quarter the data is summed into weeks and the caption says so. Squeezing
 * them instead produces a chart whose shape is an artefact of the pixel grid.
 */

export interface DailyBarsPoint {
  /** "YYYY-MM-DD", local. */
  day: string;
  value: number;
  /** The track behind the bar, in the SAME unit. `null` hides it for that day. */
  reference?: number | null;
}

export interface DailyBarsProps {
  data: DailyBarsPoint[];
  /** Names the bar. With a reference present this is also the legend entry. */
  valueLabel: string;
  referenceLabel?: string;
  /** "h", "" — appended to every number. */
  unit?: string;
  /** Decimals in the caption. Hours want 1, counts want 0. */
  precision?: number;
}

/** Past this many points, days become weeks. */
const BUCKET_THRESHOLD = 92;

export default function DailyBars({
  data,
  valueLabel,
  referenceLabel,
  unit = "",
  precision = 1,
}: DailyBarsProps) {
  const [selected, setSelected] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground/70">Nothing to chart yet.</p>;
  }

  const bucketed = data.length > BUCKET_THRESHOLD;
  const points = bucketed ? bucketByWeek(data) : data;
  const hasReference = points.some((p) => p.reference != null && p.reference > 0);

  // Scaled against the largest thing on the chart, whichever series it is in —
  // scaling the bar to its own peak would let it overflow the track it is
  // meant to be read as a fraction of.
  const peak = Math.max(...points.map((p) => Math.max(p.value, p.reference ?? 0)), 1);

  const fmt = (n: number) => `${n.toFixed(precision).replace(/\.0$/, "")}${unit}`;
  const active = selected != null ? points[selected] : null;

  return (
    <div>
      {/* A legend whenever there are two marks — identity is never colour
          alone. One series needs none: the section heading names it. */}
      {hasReference && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px]"
              style={{ background: "var(--viz-cat-1)" }}
              aria-hidden
            />
            {valueLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-muted ring-1 ring-border" aria-hidden />
            {referenceLabel ?? "Reference"}
          </span>
        </div>
      )}

      {/* gap-[2px] is the surface gap between adjacent bars — without it a run
          of full days reads as one continuous block. */}
      <div className="flex h-36 items-end gap-[2px]" role="group" aria-label={`${valueLabel} by ${bucketed ? "week" : "day"}`}>
        {points.map((point, i) => {
          const isActive = selected === i;
          const valuePct = (point.value / peak) * 100;
          const refPct = point.reference != null ? (point.reference / peak) * 100 : 0;

          return (
            <button
              key={point.day}
              type="button"
              onClick={() => setSelected(isActive ? null : i)}
              onMouseEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              aria-label={`${labelFor(point.day, bucketed)}: ${fmt(point.value)} ${valueLabel}${
                point.reference != null ? ` of ${fmt(point.reference)} ${referenceLabel ?? ""}` : ""
              }`}
              // The hit target is the full column height even when the bar is
              // 3px tall — a quiet day must still be selectable.
              className="group relative flex h-full min-w-0 flex-1 items-end rounded-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* The track: the reference, recessive, behind the bar. */}
              {refPct > 0 && (
                <span
                  className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-muted"
                  style={{ height: `${refPct}%` }}
                  aria-hidden
                />
              )}
              <span
                className="relative w-full rounded-t-[4px] transition-opacity"
                style={{
                  height: `${Math.max(valuePct, point.value > 0 ? 2 : 0)}%`,
                  background: "var(--viz-cat-1)",
                  opacity: selected == null || isActive ? 1 : 0.55,
                }}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {/* The caption is the tooltip. It reserves its line whether or not
          anything is selected, so the chart does not jump on hover. */}
      <p className="mt-2 min-h-5 text-xs text-muted-foreground">
        {active ? (
          <>
            <span className="font-medium text-foreground">{labelFor(active.day, bucketed)}</span>
            {" — "}
            {fmt(active.value)} {valueLabel.toLowerCase()}
            {active.reference != null && active.reference > 0 && (
              <> of {fmt(active.reference)} {(referenceLabel ?? "").toLowerCase()}</>
            )}
          </>
        ) : (
          <>
            {points.length} {bucketed ? "weeks" : "days"}
            {bucketed && " — bucketed, because a range this long has more days than readable bars"}
          </>
        )}
      </p>
    </div>
  );
}

/** Sums consecutive runs of 7 into one point, keeping the first day's label. */
function bucketByWeek(data: DailyBarsPoint[]): DailyBarsPoint[] {
  const out: DailyBarsPoint[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7);
    const anyReference = chunk.some((p) => p.reference != null);
    out.push({
      day: chunk[0].day,
      value: chunk.reduce((total, p) => total + p.value, 0),
      reference: anyReference
        ? chunk.reduce((total, p) => total + (p.reference ?? 0), 0)
        : null,
    });
  }
  return out;
}

function labelFor(day: string, bucketed: boolean): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return bucketed ? `Week of ${label}` : label;
}
