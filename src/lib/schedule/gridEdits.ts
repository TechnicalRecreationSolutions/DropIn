/**
 * The arithmetic behind direct manipulation on a time-axis schedule canvas —
 * dragging a block to another lane/day/time, dragging its edge to resize it,
 * and pasting a copy somewhere else.
 *
 * Pure on purpose. The client needs it to draw a preview while the pointer is
 * still down, and `/api/sessions/batch` needs it to write the result; if those
 * two ever disagree, the block lands somewhere other than where it was dropped.
 * Same reasoning as `weekGeometry.ts`, which owns the pixel half of the same
 * problem — this file owns the RRULE half.
 *
 * ## The rule this file exists to enforce: an edit replaces, it does not collapse
 *
 * A session is a whole recurring series, and a series can run on several days
 * and occupy several spaces. The block on screen is ONE day of ONE lane of it.
 * So dragging the Wednesday block of a Mon/Wed/Fri series to Thursday must
 * produce Mon / THURSDAY / Fri — not "Thursday" alone, which is what a naive
 * rebuild (`buildRRuleString({ days: [dropTarget] })`) produces, and which
 * silently deletes two days of programming.
 *
 * `ScheduleCommandCentre.handleConfirmReschedule` does exactly that naive
 * rebuild today. It was survivable while every drag stopped at a confirmation
 * dialog naming the series. It is not survivable once drags write immediately,
 * which is why this exists.
 *
 * Spaces work the same way: dragging the Lane 2 block of a Lanes 1-4 session
 * onto Lane 6 gives Lanes 1, SIX, 3, 4 — the lane you dragged, and only it.
 */

import {
  timeStringToMinutes,
  minutesToTimeString,
  DAYS,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
} from "./weekGeometry";

export const DAY_CODES = DAYS.map((d) => d.code);

/**
 * Smallest unit the canvas snaps to.
 *
 * 15 rather than the 30 of `SLOT_MINUTES`: a lane sheet is full of :15 and :45
 * boundaries (a 45-minute lesson block, a 6:45 masters start), and a canvas
 * that can only express :00 and :30 cannot represent the spreadsheet it is
 * meant to replace. The slot ROWS stay 30 minutes — they are ruling, not a
 * quantum.
 */
export const SNAP_MINUTES = 15;

/**
 * The same grain in pixels. Every surface that draws a drag in progress uses
 * this — the dnd-kit modifier that steps the dragged block, and the ghost that
 * the rest of a multi-selection follows it with. One constant, so a selection
 * cannot drift apart from the block leading it.
 */
export const SNAP_HEIGHT_PX = (SLOT_HEIGHT_PX * SNAP_MINUTES) / SLOT_MINUTES;

/** A block shorter than this is unclickable, so it could not be dragged back. */
export const MIN_DURATION_MINUTES = 15;

export const MAX_MINUTE = 24 * 60;

/** Rounds a minute-of-day to the canvas grain. */
export function snap(minutes: number, grain = SNAP_MINUTES): number {
  return Math.round(minutes / grain) * grain;
}

export function clampMinute(minutes: number): number {
  return Math.max(0, Math.min(MAX_MINUTE, minutes));
}

// ---------------------------------------------------------------------------
// RRULE day arithmetic
// ---------------------------------------------------------------------------

/** The BYDAY codes of a rule, in the order the rule lists them. `[]` when it has none. */
export function parseByDay(rrule: string): string[] {
  const match = /(?:^|;)BYDAY=([^;]+)/i.exec(rrule);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter((d) => DAY_CODES.includes(d));
}

/** Returns `rrule` with its BYDAY replaced, or added for a weekly rule that had none. */
export function withByDay(rrule: string, days: string[]): string {
  const byDay = `BYDAY=${days.join(",")}`;
  if (/(?:^|;)BYDAY=/i.test(rrule)) {
    return rrule.replace(/(?:^|;)BYDAY=[^;]+/i, (m) => (m.startsWith(";") ? `;${byDay}` : byDay));
  }
  return `${rrule};${byDay}`;
}

/** True for the one-off form (`FREQ=DAILY;COUNT=1`) — its day is dtstart's, not BYDAY's. */
export function isOneOff(rrule: string): boolean {
  return /(?:^|;)COUNT=1(?:;|$)/i.test(rrule);
}

export type DayMoveResult =
  | { kind: "byday"; rrule: string }
  /** A one-off: the rule does not change, the occurrence's own date moves. */
  | { kind: "date"; dayOffset: number }
  /** Nothing sensible to write — the caller refuses the gesture and says why. */
  | { kind: "refused"; reason: string };

/**
 * Moves the day a *single visible block* runs on, leaving every other day of
 * the same series where it is.
 *
 * `fromDayCode` is the day of the block that was dragged, which the caller
 * always knows (it is the column, or the day chip, the block was rendered
 * under). Without it there is no way to tell which of Mon/Wed/Fri was grabbed,
 * and the edit degenerates into the collapse described at the top of the file.
 */
export function moveDay(rrule: string, fromDayCode: string, toDayCode: string): DayMoveResult {
  if (fromDayCode === toDayCode) return { kind: "byday", rrule };

  if (isOneOff(rrule)) {
    const from = DAY_CODES.indexOf(fromDayCode);
    const to = DAY_CODES.indexOf(toDayCode);
    if (from < 0 || to < 0) return { kind: "refused", reason: "Unknown day." };
    return { kind: "date", dayOffset: to - from };
  }

  const byDay = parseByDay(rrule);

  if (byDay.length === 0) {
    // FREQ=DAILY and friends run on every day there is, so "move this one to
    // Thursday" has no expressible meaning — it would have to become a weekly
    // rule, which is a different session rather than a moved one.
    return {
      kind: "refused",
      reason:
        "This session repeats every day, so one day of it cannot be moved on its own. Open it to change how it repeats.",
    };
  }

  if (!byDay.includes(fromDayCode)) {
    return { kind: "refused", reason: "This block's day is not part of its repeat pattern." };
  }

  // Dragging Wednesday onto a Friday the series already runs on would otherwise
  // produce BYDAY=MO,FR,FR. Merging the two is what the gesture means.
  const next = byDay.filter((d) => d !== fromDayCode);
  if (!next.includes(toDayCode)) next.push(toDayCode);
  next.sort((a, b) => DAY_CODES.indexOf(a) - DAY_CODES.indexOf(b));

  return { kind: "byday", rrule: withByDay(rrule, next) };
}

// ---------------------------------------------------------------------------
// Space arithmetic
// ---------------------------------------------------------------------------

/**
 * Replaces one space of a session's set, preserving the others and their order.
 *
 * Returns null when there is nothing to write. A session with no spaces at all
 * — a block sitting in the free-text or "General" column — dragged into a real
 * lane is the one case where "add" is what the gesture meant.
 */
export function moveSpace(
  spaceIds: string[],
  fromSpaceId: string | null,
  toSpaceId: string
): string[] | null {
  if (fromSpaceId === toSpaceId) return null;
  if (spaceIds.length === 0) return [toSpaceId];
  if (!fromSpaceId || !spaceIds.includes(fromSpaceId)) return null;
  // Dropping onto a lane the session already occupies collapses the two, for
  // the same reason as the day case above.
  if (spaceIds.includes(toSpaceId)) return spaceIds.filter((id) => id !== fromSpaceId);
  return spaceIds.map((id) => (id === fromSpaceId ? toSpaceId : id));
}

// ---------------------------------------------------------------------------
// Time arithmetic
// ---------------------------------------------------------------------------

export interface TimeSpan {
  /** HH:MM */
  startTime: string;
  /** HH:MM */
  endTime: string;
}

/** Moves a span to a new start, keeping its duration. Null when it would cross midnight. */
export function moveSpan(span: TimeSpan, newStartMinute: number): TimeSpan | null {
  const duration = timeStringToMinutes(span.endTime) - timeStringToMinutes(span.startTime);
  const start = clampMinute(snap(newStartMinute));
  const end = start + duration;
  if (end > MAX_MINUTE) return null;
  return { startTime: minutesToTimeString(start), endTime: minutesToTimeString(end) };
}

export type ResizeEdge = "start" | "end";

/**
 * Drags one edge of a span. The opposite edge is fixed, and the span never
 * inverts or shrinks below `MIN_DURATION_MINUTES`.
 *
 * Returns null when the drag changed nothing, so a caller can skip the write
 * rather than push a no-op onto the undo stack.
 */
export function resizeSpan(span: TimeSpan, edge: ResizeEdge, newMinute: number): TimeSpan | null {
  const startMin = timeStringToMinutes(span.startTime);
  const endMin = timeStringToMinutes(span.endTime);
  const target = clampMinute(snap(newMinute));

  if (edge === "start") {
    const start = Math.min(target, endMin - MIN_DURATION_MINUTES);
    if (start < 0 || start === startMin) return null;
    return { startTime: minutesToTimeString(start), endTime: span.endTime };
  }

  const end = Math.max(target, startMin + MIN_DURATION_MINUTES);
  if (end > MAX_MINUTE || end === endMin) return null;
  return { startTime: span.startTime, endTime: minutesToTimeString(end) };
}

/**
 * `dtstart` is a literal wall-clock stamp with a "Z" suffix and no instant
 * meaning (see docs/RESUME-timezone-removal.md). Built by concatenation, never
 * by converting a Date — that conversion is the bug the removal existed to end.
 */
export function buildDtstart(dateString: string, startTime: string): string {
  return `${dateString}T${startTime}:00Z`;
}

/** Shifts a YYYY-MM-DD by whole days without going near the runtime's zone. */
export function shiftDateString(dateString: string, days: number): string {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
