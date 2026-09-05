import type { ScheduleTemplate } from "@/types/schedule.types";

/**
 * Miniature wireframes of each schedule view.
 *
 * The old picker offered five 16px lucide icons in a row, which asked staff to
 * guess what "Map" or "Board" meant from an abstract glyph. These are drawn to
 * be recognizable as the actual layout: you pick the view that looks like the
 * thing you want on your website.
 *
 * Everything is `currentColor` at varying opacity so one drawing works on the
 * card's normal, selected and disabled states, in light and dark mode.
 */
export default function LayoutThumbnail({ template }: { template: ScheduleTemplate }) {
  return (
    <svg
      viewBox="0 0 100 62"
      className="w-full h-auto text-foreground"
      role="presentation"
      aria-hidden="true"
    >
      {/* Shared header bar — every view renders under the org-coloured bar. */}
      <rect x="0" y="0" width="100" height="10" rx="2" fill="currentColor" opacity="0.35" />
      {shapes[template]}
    </svg>
  );
}

const block = (x: number, y: number, w: number, h: number, o = 0.22) => (
  <rect key={`${x}-${y}-${w}`} x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" opacity={o} />
);

const shapes: Record<ScheduleTemplate, React.ReactNode> = {
  // Seven day columns with sessions stacked inside a couple of them.
  grid: (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => block(2 + i * 14, 14, 12, 4, 0.16))}
      {block(2, 20, 12, 9)}
      {block(16, 20, 12, 13, 0.3)}
      {block(30, 20, 12, 6)}
      {block(58, 20, 12, 11, 0.3)}
      {block(72, 20, 12, 7)}
      {block(2, 31, 12, 7, 0.16)}
      {block(44, 20, 12, 9, 0.16)}
      {block(86, 20, 12, 5, 0.16)}
    </>
  ),
  // Date rail on the left, one full-width row per session.
  list: (
    <>
      {block(2, 14, 14, 11, 0.3)}
      {block(19, 15, 60, 4)}
      {block(19, 21, 34, 3, 0.14)}
      {block(2, 28, 14, 11, 0.3)}
      {block(19, 29, 52, 4)}
      {block(19, 35, 40, 3, 0.14)}
      {block(2, 42, 14, 11, 0.3)}
      {block(19, 43, 58, 4)}
      {block(19, 49, 30, 3, 0.14)}
    </>
  ),
  // A column per space, sessions laid out down each one.
  map: (
    <>
      {block(2, 14, 30, 5, 0.3)}
      {block(35, 14, 30, 5, 0.3)}
      {block(68, 14, 30, 5, 0.3)}
      {block(2, 21, 30, 14)}
      {block(35, 21, 30, 9)}
      {block(68, 21, 30, 18)}
      {block(2, 37, 30, 8, 0.16)}
      {block(35, 32, 30, 16, 0.16)}
    </>
  ),
  // Time rows against day columns — the timetable grid.
  board: (
    <>
      {block(2, 14, 16, 4, 0.16)}
      {block(20, 14, 24, 4, 0.16)}
      {block(46, 14, 24, 4, 0.16)}
      {block(72, 14, 26, 4, 0.16)}
      {block(2, 21, 16, 8, 0.3)}
      {block(20, 21, 24, 8)}
      {block(46, 21, 24, 8, 0.14)}
      {block(72, 21, 26, 8)}
      {block(2, 31, 16, 8, 0.3)}
      {block(20, 31, 24, 8, 0.14)}
      {block(46, 31, 24, 8)}
      {block(72, 31, 26, 8, 0.14)}
      {block(2, 41, 16, 8, 0.3)}
      {block(20, 41, 24, 8)}
      {block(46, 41, 24, 8, 0.14)}
      {block(72, 41, 26, 8, 0.14)}
    </>
  ),
  // A drawing of the building: pool, court, a couple of rooms.
  floorplan: (
    <>
      <rect x="2" y="13" width="96" height="47" rx="3" fill="currentColor" opacity="0.06" />
      <rect x="7" y="18" width="42" height="22" rx="3" fill="currentColor" opacity="0.32" />
      <line x1="7" y1="25" x2="49" y2="25" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <line x1="7" y1="32" x2="49" y2="32" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <rect x="55" y="18" width="38" height="26" rx="2" fill="currentColor" opacity="0.2" />
      <circle cx="74" cy="31" r="5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <rect x="7" y="44" width="20" height="12" rx="2" fill="currentColor" opacity="0.16" />
      <rect x="31" y="44" width="18" height="12" rx="2" fill="currentColor" opacity="0.16" />
      <rect x="55" y="48" width="38" height="8" rx="2" fill="currentColor" opacity="0.16" />
    </>
  ),
};
