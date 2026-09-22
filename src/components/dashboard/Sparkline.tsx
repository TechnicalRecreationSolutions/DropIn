/**
 * A single-series line, sized to sit inside a stat tile.
 *
 * One series, so there is no legend — the tile's own label names it. No hover
 * layer either, and that is a deliberate exception rather than an oversight:
 * the tile is a link to /dashboard/analytics, where the same series is drawn
 * full size with a crosshair, a range picker and a CSV export. A tooltip on a
 * 28px-tall sketch would be a worse version of the thing one tap away, and on
 * a phone it would fight the tap that gets you there.
 *
 * Drawn in --viz-cat-1 at 2px with a 0.10 area, which is not a choice made
 * here: it is exactly how ViewsChart draws this same metric on the analytics
 * page this tile links to. The sketch and the chart it opens are the same line.
 *
 * The shape is the content — whether views are climbing, flat or fell off a
 * cliff a week ago is exactly what the single number next to it cannot say.
 */
interface SparklineProps {
  /** Oldest first. Fewer than two points draws nothing. */
  values: number[];
  /** What the series is, for the screen-reader summary ("Views"). */
  label: string;
  className?: string;
}

const W = 100;
const H = 28;

export function Sparkline({ values, label, className }: SparklineProps) {
  // A flat run of zeros has no shape to show, and a line pinned to the floor
  // beside a big "0" reads as a chart that failed to load rather than as a
  // quiet month. The number alone is the honest answer there.
  if (values.length < 2 || values.every((v) => v === 0)) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series is drawn as a flat line through the middle, not as a
  // divide-by-zero or a line pinned to the floor: "nothing changed" is a real
  // answer and should look like one.
  const span = max - min || 1;
  const stepX = W / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    // 2px of breathing room top and bottom so the stroke is never clipped.
    const y = H - 2 - ((v - min) / span) * (H - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // The tile is wider than it is tall and the series should fill it, so the
      // aspect ratio is not preserved — `non-scaling-stroke` below is what keeps
      // the line an even 2px instead of stretching with the box.
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={`${label}: ${values.length} days, from ${values[0]} to ${values[values.length - 1]}, peak ${max}`}
    >
      <path d={area} fill="var(--viz-cat-1)" opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="var(--viz-cat-1)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The most recent day, marked — it is the one the number beside the
          chart is about. */}
      <circle cx={lastX} cy={lastY} r={2} fill="var(--viz-cat-1)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
