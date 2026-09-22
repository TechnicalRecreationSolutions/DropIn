/**
 * The arithmetic behind the Overview's "today" ribbon.
 *
 * Kept apart from the component on purpose: every number the strip draws —
 * where the axis starts, which row a block lands in, where "now" sits, what
 * the summary line claims — is checkable without a browser, and
 * `verify-ay --logic-only` checks exactly this file.
 *
 * Everything here is in **minutes since midnight**, never Dates. Session
 * occurrence Dates carry local wall-clock digits in UTC slots (see
 * rrule/README.md), so the caller converts once with `minutesOfDayIn()` and
 * this module never has to know the convention — which is also why it cannot
 * reintroduce the "read with local getters" bug that class of Date invites.
 */

/** The minimum a block occupies. Anything shorter is drawn at this width. */
export const MIN_BLOCK_MINUTES = 20;

/** Narrowest axis the strip will draw, so one short session is not a full-width blob. */
export const MIN_AXIS_MINUTES = 4 * 60;

export interface Span {
  startMin: number;
  endMin: number;
}

export interface Axis {
  startMin: number;
  endMin: number;
}

/**
 * The hour-aligned window the ribbon spans.
 *
 * Hour-aligned because the tick labels are hours: an axis starting at 6:12
 * would put its first label 48 minutes in, and every block's apparent position
 * would have to be read against a gridline that is not where it looks.
 *
 * `nowMin` is included when given so the "now" marker is never off-screen on a
 * day whose sessions have all finished — the most common way to open this page
 * in the evening, and the one case where an off-axis marker would read as
 * "nothing is running" being drawn as a blank strip instead of a stated fact.
 */
export function axisBounds(spans: Span[], nowMin: number | null): Axis {
  const candidates: number[] = [];
  for (const s of spans) {
    candidates.push(s.startMin, s.endMin);
  }
  if (nowMin !== null) candidates.push(nowMin);
  if (candidates.length === 0) {
    // Nothing at all to place. The component draws its empty state instead of
    // this, but returning a sane window keeps the function total.
    return { startMin: 8 * 60, endMin: 8 * 60 + MIN_AXIS_MINUTES };
  }

  let startMin = Math.floor(Math.min(...candidates) / 60) * 60;
  let endMin = Math.ceil(Math.max(...candidates) / 60) * 60;

  // Grow to the minimum span, forwards first, then backwards — so a lunchtime
  // session widens into the afternoon rather than into an empty morning.
  if (endMin - startMin < MIN_AXIS_MINUTES) {
    endMin = Math.min(24 * 60, startMin + MIN_AXIS_MINUTES);
    if (endMin - startMin < MIN_AXIS_MINUTES) {
      startMin = Math.max(0, endMin - MIN_AXIS_MINUTES);
    }
  }

  return { startMin: Math.max(0, startMin), endMin: Math.min(24 * 60, endMin) };
}

/** Where a minute-of-day sits on the axis, as a 0–100 percentage. */
export function positionPct(minute: number, axis: Axis): number {
  const span = axis.endMin - axis.startMin;
  if (span <= 0) return 0;
  const pct = ((minute - axis.startMin) / span) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Left offset and width for a block, both as percentages of the axis.
 *
 * A block shorter than `MIN_BLOCK_MINUTES` is widened rather than drawn at its
 * true width: a 10-minute closure on a 14-hour axis is a 1.2% sliver nobody can
 * tap, and a block you cannot tap is a block that is not on the page (rubric
 * B2/E2). The widening is visual only — the label still carries the real times.
 */
export function blockRect(span: Span, axis: Axis): { leftPct: number; widthPct: number } {
  const drawnEnd = Math.max(span.endMin, span.startMin + MIN_BLOCK_MINUTES);
  const leftPct = positionPct(span.startMin, axis);
  const widthPct = Math.max(0, positionPct(drawnEnd, axis) - leftPct);
  return { leftPct, widthPct };
}

/**
 * Greedy first-fit packing into rows of non-overlapping blocks.
 *
 * Two sessions at the same time in different lanes are *both* real, so they
 * cannot share a row; but the strip is a summary and not the grid, so it caps
 * the rows it will draw and hands the rest back as `overflow` for the component
 * to count ("+3 more"). Silently dropping them would make a busy Saturday look
 * quieter than a Tuesday, which is the exact failure the strip exists to
 * prevent.
 *
 * Input order does not matter: the sort here decides the layout, so the same
 * set of occurrences always packs the same way regardless of the order the API
 * returned them in.
 */
export function packRows<T extends Span>(spans: T[], maxRows: number): { rows: T[][]; overflow: T[] } {
  const sorted = [...spans].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const rows: T[][] = [];
  const rowEnds: number[] = [];
  const overflow: T[] = [];

  for (const span of sorted) {
    // A block is drawn at least MIN_BLOCK_MINUTES wide, so it must also *reserve*
    // that much: packing on true end times would let a 10-minute block share a
    // row with one starting 5 minutes later, and the two would visibly overlap.
    const drawnEnd = Math.max(span.endMin, span.startMin + MIN_BLOCK_MINUTES);
    let placed = false;
    for (let i = 0; i < rows.length; i++) {
      if (rowEnds[i] <= span.startMin) {
        rows[i].push(span);
        rowEnds[i] = drawnEnd;
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (rows.length < maxRows) {
      rows.push([span]);
      rowEnds.push(drawnEnd);
    } else {
      overflow.push(span);
    }
  }

  return { rows, overflow };
}

/**
 * The hour marks to label, thinned so they never collide.
 *
 * A 16-hour day at phone width has room for about six labels, not sixteen. The
 * step grows with the span rather than with the pixel width because the ribbon
 * scrolls horizontally on a narrow screen — the drawn width per hour is fixed,
 * so the span is what decides.
 */
export function hourTicks(axis: Axis): number[] {
  const hours = (axis.endMin - axis.startMin) / 60;
  const step = hours <= 6 ? 1 : hours <= 12 ? 2 : 3;
  const ticks: number[] = [];
  const firstHour = Math.ceil(axis.startMin / 60);
  for (let h = firstHour; h * 60 <= axis.endMin; h++) {
    if ((h - firstHour) % step === 0) ticks.push(h * 60);
  }
  return ticks;
}

export interface TodaySummary<T extends Span> {
  total: number;
  /** Running at `nowMin` — inclusive of the start minute, exclusive of the end. */
  onNow: T[];
  /** The next one to start after `nowMin`, or null if the day's starts are done. */
  next: T | null;
  /** Earliest start and latest end across everything today, or null when empty. */
  firstMin: number | null;
  lastMin: number | null;
}

/**
 * What the line above the ribbon says.
 *
 * `onNow` uses a half-open interval: a session ending at 10:00 is not "on now"
 * at 10:00, and the one starting at 10:00 is. Without that, the two would both
 * be reported as running for one minute every hour, and the count above the
 * ribbon would disagree with the blocks under it.
 */
export function summarise<T extends Span>(spans: T[], nowMin: number | null): TodaySummary<T> {
  const sorted = [...spans].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const onNow = nowMin === null ? [] : sorted.filter((s) => s.startMin <= nowMin && nowMin < s.endMin);
  const next = nowMin === null ? (sorted[0] ?? null) : (sorted.find((s) => s.startMin > nowMin) ?? null);

  return {
    total: sorted.length,
    onNow,
    next,
    firstMin: sorted.length > 0 ? Math.min(...sorted.map((s) => s.startMin)) : null,
    lastMin: sorted.length > 0 ? Math.max(...sorted.map((s) => s.endMin)) : null,
  };
}
