"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayPoint } from "@/lib/analytics/queries";
import { formatDay } from "@/lib/analytics/range";

/**
 * Views and unique visitors per day.
 *
 * Still hand-drawn SVG rather than a charting dependency — two series over at
 * most a couple of hundred points does not earn one — but no longer the bare
 * sparkline it replaces. Three things that one got wrong and this one does
 * not:
 *
 * 1. **Gaps.** The old chart plotted only days that had events, evenly
 *    spaced, so a quiet week was drawn as if it never happened and the slope
 *    across it was a fiction. The series now arrives gap-filled from
 *    `eachDay(range)` and a zero day is plotted as a zero.
 * 2. **A scale.** There were no axis labels at all, so a peak of 9 and a peak
 *    of 9,000 drew the identical picture.
 * 3. **A hover layer.** `<title>` tooltips need a mouse and a steady hand;
 *    this app is mobile-first, so the crosshair follows touch as well.
 *
 * Both series count the same thing (events per day) and share one axis. Two
 * scales on two edges would let any pair of lines be made to cross wherever
 * the author wanted.
 */

/**
 * The SVG is sized in real CSS pixels, not scaled from a fixed viewBox.
 *
 * A `viewBox="0 0 720 200"` on a 358px phone halves everything inside it,
 * including the axis labels — an 11px scale rendered at 5px, which is not a
 * scale. Measuring the container and making one SVG unit one CSS pixel keeps
 * the type at the size it was written at, at every width, with no distorted
 * strokes from `preserveAspectRatio="none"`.
 */
const H = 200;
const FALLBACK_W = 720;
const MIN_W = 240;
const PAD = { top: 12, right: 10, bottom: 24, left: 40 };
const PLOT_H = H - PAD.top - PAD.bottom;

/** Above this many days, per-point markers become a solid smear — drop them. */
const MAX_MARKERS = 45;

interface ViewsChartProps {
  data: DayPoint[];
  /** Hidden when every day's visitor count is zero, so the legend never lies. */
  showVisitors?: boolean;
}

/** A "nice" axis maximum — 1, 2 or 5 x a power of ten at or above the peak. */
function niceMax(value: number): number {
  if (value <= 5) return Math.max(value, 1);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

export function ViewsChart({ data, showVisitors = true }: ViewsChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(FALLBACK_W);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(MIN_W, Math.round(entry.contentRect.width)))
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const W = width;
  const PLOT_W = W - PAD.left - PAD.right;

  const geometry = useMemo(() => {
    const peak = Math.max(...data.map((d) => Math.max(d.views, showVisitors ? d.visitors : 0)), 0);
    const max = niceMax(peak);
    const stepX = data.length > 1 ? PLOT_W / (data.length - 1) : 0;
    const x = (i: number) => PAD.left + (data.length > 1 ? i * stepX : PLOT_W / 2);
    const y = (value: number) => PAD.top + PLOT_H - (value / max) * PLOT_H;

    const path = (pick: (d: DayPoint) => number) =>
      data.map((d, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(pick(d))).join(" ");

    const viewsPath = path((d) => d.views);
    return {
      max,
      x,
      y,
      viewsPath,
      visitorsPath: showVisitors ? path((d) => d.visitors) : null,
      areaPath:
        data.length > 0
          ? viewsPath + " L" + x(data.length - 1) + "," + (PAD.top + PLOT_H) + " L" + x(0) + "," + (PAD.top + PLOT_H) + " Z"
          : "",
    };
  }, [data, showVisitors, PLOT_W]);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground/70 py-10 text-center">No views recorded in this period.</p>;
  }

  /** Index of the day under the pointer, from an x position in client pixels. */
  function indexAt(clientX: number): number | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const ratio = (svgX - PAD.left) / PLOT_W;
    const index = Math.round(ratio * (data.length - 1));
    return Math.min(data.length - 1, Math.max(0, index));
  }

  const active = hover === null ? null : data[hover];
  const markers = data.length <= MAX_MARKERS;
  // Keep the tooltip inside the card near the ends instead of letting it hang
  // off the edge, which on a phone means half of it is simply not there.
  const hoverRatio = hover === null || data.length <= 1 ? 0 : hover / (data.length - 1);
  const tooltipSide = hoverRatio > 0.65 ? "right" : "left";

  const gridValues = [0, geometry.max / 2, geometry.max];

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: "var(--viz-cat-1)" }} aria-hidden />
          Views
        </span>
        {showVisitors && (
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: "var(--viz-cat-2)" }} aria-hidden />
            Unique visitors
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full touch-pan-y"
        role="img"
        aria-label={`Views per day, peaking at ${Math.max(...data.map((d) => d.views))} on ${
          data.reduce((best, d) => (d.views > best.views ? d : best), data[0]).day
        }`}
        onMouseMove={(e) => setHover(indexAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => setHover(indexAt(e.touches[0].clientX))}
        onTouchMove={(e) => setHover(indexAt(e.touches[0].clientX))}
        onTouchEnd={() => setHover(null)}
      >
        {/* Grid and scale, recessive — they orient the eye, they are not data. */}
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geometry.y(value)}
              y2={geometry.y(value)}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={geometry.y(value) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 11 }}
            >
              {Math.round(value)}
            </text>
          </g>
        ))}

        <path d={geometry.areaPath} fill="var(--viz-cat-1)" opacity="0.10" />
        <path
          d={geometry.viewsPath}
          fill="none"
          stroke="var(--viz-cat-1)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {geometry.visitorsPath && (
          <path
            d={geometry.visitorsPath}
            fill="none"
            stroke="var(--viz-cat-2)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            // Dashed as well as coloured: the two series stay apart in a
            // greyscale print and for a reader who cannot separate the hues.
            strokeDasharray="5 4"
          />
        )}

        {markers &&
          data.map((d, i) => (
            <circle key={d.day} cx={geometry.x(i)} cy={geometry.y(d.views)} r="2.5" fill="var(--viz-cat-1)" />
          ))}

        {hover !== null && active && (
          <g>
            <line
              x1={geometry.x(hover)}
              x2={geometry.x(hover)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="currentColor"
              className="text-muted-foreground"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={geometry.x(hover)}
              cy={geometry.y(active.views)}
              r="4.5"
              fill="var(--viz-cat-1)"
              stroke="var(--color-card)"
              strokeWidth="2"
            />
            {showVisitors && (
              <circle
                cx={geometry.x(hover)}
                cy={geometry.y(active.visitors)}
                r="4.5"
                fill="var(--viz-cat-2)"
                stroke="var(--color-card)"
                strokeWidth="2"
              />
            )}
          </g>
        )}

        {/* First and last day only — intermediate ticks collide on a phone. */}
        <text x={PAD.left} y={H - 6} className="fill-muted-foreground" style={{ fontSize: 11 }}>
          {formatDay(data[0].day)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 11 }}>
          {formatDay(data[data.length - 1].day)}
        </text>
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10"
          style={tooltipSide === "left" ? { left: `${hoverRatio * 90}%` } : { right: `${(1 - hoverRatio) * 90}%` }}
        >
          <p className="font-semibold text-popover-foreground mb-1">{formatDay(active.day)}</p>
          <dl className="space-y-0.5 text-popover-foreground/80">
            <div className="flex items-center justify-between gap-4">
              <dt>Views</dt>
              <dd className="font-medium tabular-nums">{active.views}</dd>
            </div>
            {showVisitors && (
              <div className="flex items-center justify-between gap-4">
                <dt>Visitors</dt>
                <dd className="font-medium tabular-nums">{active.visitors}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <dt>Session clicks</dt>
              <dd className="font-medium tabular-nums">{active.clicks}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
