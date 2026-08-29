const CHART_HEIGHT = 120;
const CHART_WIDTH = 600;
const PADDING = 4;

/**
 * Minimal inline-SVG line chart — no charting library in this codebase yet,
 * and one series over <=30 points doesn't need one. Sequential blue, per the
 * dataviz palette's single-hue-for-magnitude rule.
 */
export function ViewsChart({ data }: { data: { day: string; views: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">No widget views yet in this window.</p>;
  }

  const max = Math.max(...data.map((d) => d.views), 1);
  const stepX = data.length > 1 ? (CHART_WIDTH - PADDING * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = PADDING + i * stepX;
    const y = CHART_HEIGHT - PADDING - (d.views / max) * (CHART_HEIGHT - PADDING * 2);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${CHART_HEIGHT} L${points[0].x},${CHART_HEIGHT} Z`;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full h-32"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Widget views by day, peaking at ${max}`}
    >
      <path d={areaPath} fill="#2a78d6" opacity="0.08" />
      <path d={linePath} fill="none" stroke="#2a78d6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p) => (
        <circle key={p.day} cx={p.x} cy={p.y} r="2.5" fill="#2a78d6">
          <title>{`${p.day}: ${p.views} view${p.views === 1 ? "" : "s"}`}</title>
        </circle>
      ))}
    </svg>
  );
}
