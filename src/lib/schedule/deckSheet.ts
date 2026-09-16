import type { ExpandedSession } from "@/types/schedule.types";
import {
  isExclusiveKind,
  occupancyKindLabel,
  sessionDisplayLabel,
  type Disclosure,
  type OccupancyKind,
} from "@/lib/sessions/occupancy";
import { computeDayAvailability, type BlockAvailability } from "@/lib/schedule/availability";
import { formatSessionTime, minutesOfDayIn, sessionDateString } from "@/lib/utils/dates";
import { GRID_START_HOUR, SLOT_MINUTES, packIntoTracks } from "@/lib/schedule/weekGeometry";

/**
 * The deck sheet — spaces as columns, time as rows, one day (stage 4 of
 * docs/PLAN-internal-view.md). This builds the model; `DeckSheet.tsx` renders it.
 *
 * It replaces a hand-built Excel sheet that Commonwealth prints and posts on
 * deck, and its shape is copied from that artifact rather than invented: the
 * grid shows **who has the water**, and the public drop-in schedule is what is
 * left over once those claims are subtracted.
 *
 * Which is why only **exclusive** claims (program / rental / closure) are drawn
 * in the grid. `drop_in` is residual by definition (migration 046, decision 2) —
 * it occupies whatever is not exclusively claimed, so drawing it in a lane
 * column would assert something false about that lane, and it would collide in
 * every cell with the rental it is *supposed* to coexist with. Residual blocks
 * are listed separately instead, with their own times, which is the same
 * division of labour the customer's spreadsheet already uses.
 *
 * This is deliberately **not** a `ScheduleTemplate` value. Those are the views a
 * widget may be configured to show (`widget_configs.allowed_templates`), and
 * this sheet carries holder names and setup notes from `session_internal`. It
 * lives on a staff-only route and there is nothing for a public surface to
 * select, even by query param.
 */

/** Row height of the printed grid, in minutes. Half-hour rows are what the sheet being replaced uses. */
export const DECK_SLOT_MINUTES = SLOT_MINUTES;

/** One space's column. A space with two overlapping claims splits into tracks (see below). */
export interface DeckColumn {
  spaceId: string;
  name: string;
  /** How many side-by-side sub-columns this space needs. Almost always 1. */
  tracks: DeckClaim[][];
}

/** An exclusive claim as the grid draws it. */
export interface DeckClaim {
  /** The occurrence key — unique per session per day. */
  key: string;
  /** Who has it: holder name for staff, else template/schedule name. Never built by the view — see sessionDisplayLabel. */
  label: string;
  kind: OccupancyKind;
  kindLabel: string;
  disclosure: Disclosure;
  timeLabel: string;
  /** Footnote number when this booking carries a staff-only setup note; null otherwise. */
  noteMarker: number | null;
  /** Index into `rows`, and how many rows it covers. */
  startSlot: number;
  slotSpan: number;
}

/** A residual (drop-in) block, or an exclusive claim with no space to draw it in. */
export interface DeckBlock {
  key: string;
  label: string;
  kindLabel: string;
  timeLabel: string;
  spaceNames: string[];
  noteMarker: number | null;
  /**
   * What is actually left of this block once the claims above are subtracted
   * (stage 5). Null for anything the calculator cannot speak to — an exclusive
   * claim, or a block that names no spaces.
   *
   * Shadow mode, on a staff-only sheet: it is printed for the guard on deck, and
   * publishes nothing. It is also the question the sheet exists to answer, since
   * the grid's empty cells are exactly the water this counts.
   */
  availability: BlockAvailability | null;
}

export interface DeckRow {
  /** Minutes from midnight this row starts at. */
  minutes: number;
  /** "6:00am" on the hour, null on the half — the printed sheet only needs the hour to read as a ruler. */
  label: string | null;
  /** True for the top of an hour, which is where the heavier rule is drawn. */
  isHour: boolean;
}

export interface DeckNote {
  marker: number;
  label: string;
  timeLabel: string;
  note: string;
}

export interface DeckSheetModel {
  /** YYYY-MM-DD of the day rendered — carried so a printed sheet can be identified. */
  dateKey: string;
  rows: DeckRow[];
  columns: DeckColumn[];
  /** Drop-in blocks: residual, so they hold "whatever is left" rather than a column. */
  residual: DeckBlock[];
  /** Exclusive claims with no space attached — they cannot be drawn, and must not vanish. */
  unplaced: DeckBlock[];
  /** Setup notes, numbered, staff-only. Empty for any caller who is not an org member. */
  notes: DeckNote[];
  /** True when nothing at all is scheduled — the sheet then prints as an empty ruler rather than nothing. */
  isEmpty: boolean;
}

interface BuildDeckSheetInput {
  /** One day's occurrences, already filtered to the day by the caller. */
  sessions: ExpandedSession[];
  /** Every space at the facility, in display order — including empty ones, which is the point of a printed sheet. */
  spaces: { id: string; name: string }[];
  /** The day being rendered, as a session-Date. */
  day: Date;
}

/** Shortest window the sheet will print, so one booking doesn't become a two-row page. */
const MIN_WINDOW_HOURS = 6;

function floorToSlot(minutes: number): number {
  return Math.floor(minutes / DECK_SLOT_MINUTES) * DECK_SLOT_MINUTES;
}

function ceilToSlot(minutes: number): number {
  return Math.ceil(minutes / DECK_SLOT_MINUTES) * DECK_SLOT_MINUTES;
}

/** Window bounds land on whole hours, so the printed ruler reads 6, 7, 8 rather than 6:30. */
function floorToHour(minutes: number): number {
  return Math.floor(minutes / 60) * 60;
}

function ceilToHour(minutes: number): number {
  return Math.ceil(minutes / 60) * 60;
}

function timeRangeLabel(session: ExpandedSession): string {
  return `${formatSessionTime(session.start)}–${formatSessionTime(session.end)}`;
}

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Builds the printable model for one day at one facility.
 *
 * ### The time window is the day's own span, not the nominal operating day
 *
 * Every other time-axis view here runs 06:00–22:00 (`GRID_START_HOUR`/
 * `GRID_END_HOUR`) and scrolls. A page does not scroll, and the numbers are not
 * close: measured under print media, those 32 half-hour rows make a sheet
 * **1022px tall against the ~740px** a landscape Letter page has after margins,
 * so it prints on two — which puts lane columns on a page the guard isn't
 * holding, the exact failure this stage exists to avoid. `verify-z` measures
 * this, and its failure detail reports the height so a future regression says
 * how far over it is rather than only that it spilled.
 *
 * So the window spans what is actually scheduled — **including the residual
 * blocks**, which are listed rather than drawn but still define when the building
 * is busy — rounded out to whole hours, with a floor of `MIN_WINDOW_HOURS` so a
 * single booking doesn't print a two-row sheet. A 5:30am club booking therefore
 * appears without dragging 16 hours of empty rows along with it; empty hours
 * carry no information for a deck.
 */
export function buildDeckSheet({
  sessions,
  spaces,
  day,
}: BuildDeckSheetInput): DeckSheetModel {
  const visibleSpaces = spaces;
  const visibleSpaceIds = new Set(visibleSpaces.map((s) => s.id));

  const exclusive = sessions.filter((s) => isExclusiveKind(s.occupancyKind));
  const residualSessions = sessions.filter((s) => !isExclusiveKind(s.occupancyKind));

  // Drawn claims are the ones with at least one real space. An exclusive claim
  // with no space at all is unplaced, and belongs in the footnotes instead.
  const drawable = exclusive.filter((s) => s.spaceIds.some((id) => visibleSpaceIds.has(id)));
  const unplacedSessions = exclusive.filter((s) => s.spaceIds.length === 0);

  // Footnote numbers are assigned in the order a reader meets them — down the
  // page, earliest first — so the markers in the grid ascend as the eye moves.
  const noteOrder = [...drawable, ...residualSessions, ...unplacedSessions]
    .filter((s) => !!s.setupNotes?.trim())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const markerByKey = new Map<string, number>();
  noteOrder.forEach((s, i) => markerByKey.set(s.key, i + 1));

  const notes: DeckNote[] = noteOrder.map((s) => ({
    marker: markerByKey.get(s.key)!,
    label: sessionDisplayLabel(s),
    timeLabel: timeRangeLabel(s),
    note: s.setupNotes!.trim(),
  }));

  // ---------------------------------------------------------------- the window
  const spanning = [...drawable, ...residualSessions];
  let windowStart: number;
  let windowEnd: number;

  if (spanning.length === 0) {
    // Nothing scheduled: print a short ruler starting where the day usually
    // does, rather than a blank page or sixteen empty hours.
    windowStart = GRID_START_HOUR * 60;
    windowEnd = windowStart + MIN_WINDOW_HOURS * 60;
  } else {
    windowStart = Math.min(...spanning.map((s) => floorToHour(minutesOfDayIn(s.start))));
    windowEnd = Math.max(...spanning.map((s) => ceilToHour(minutesOfDayIn(s.end))));
    if (windowEnd - windowStart < MIN_WINDOW_HOURS * 60) {
      windowEnd = windowStart + MIN_WINDOW_HOURS * 60;
    }
    // Never past midnight — an occurrence ending at 00:00 reads as 0 minutes, so
    // the ceiling above would otherwise collapse the window.
    windowEnd = Math.min(windowEnd, 24 * 60);
    if (windowEnd <= windowStart) windowEnd = Math.min(24 * 60, windowStart + MIN_WINDOW_HOURS * 60);
  }

  const rows: DeckRow[] = [];
  for (let m = windowStart; m < windowEnd; m += DECK_SLOT_MINUTES) {
    const isHour = m % 60 === 0;
    rows.push({ minutes: m, label: isHour ? hourLabel(m) : null, isHour });
  }

  const slotOf = (minutes: number) => Math.floor((minutes - windowStart) / DECK_SLOT_MINUTES);

  // ---------------------------------------------------------------- the columns
  const columns: DeckColumn[] = visibleSpaces.map((space) => {
    const claims: DeckClaim[] = drawable
      .filter((s) => s.spaceIds.includes(space.id))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((s) => {
        const startSlot = Math.max(0, slotOf(floorToSlot(minutesOfDayIn(s.start))));
        const endSlot = Math.min(rows.length, slotOf(ceilToSlot(minutesOfDayIn(s.end))));
        return {
          key: s.key,
          label: sessionDisplayLabel(s),
          kind: s.occupancyKind,
          kindLabel: occupancyKindLabel(s.occupancyKind),
          disclosure: s.disclosure,
          timeLabel: timeRangeLabel(s),
          noteMarker: markerByKey.get(s.key) ?? null,
          startSlot,
          slotSpan: Math.max(1, endSlot - startSlot),
        };
      });

    // Two exclusive claims on one space is a hard 409 at write time (migration
    // 046) — but imported rows skip that gate, and a sheet that silently drew
    // only one of them would be worse than useless on a pool deck. Packing is
    // done on *slot* ranges rather than real minutes because two claims sharing
    // a row must not share a cell, even where their real times merely touch.
    const tracks = packIntoTracks(claims, (claim) => ({
      start: claim.startSlot,
      end: claim.startSlot + claim.slotSpan,
    }));

    return { spaceId: space.id, name: space.name, tracks: tracks.length > 0 ? tracks : [[]] };
  });

  // Computed from the whole day's sessions, not only from the claims drawn: an
  // exclusive claim still takes a lane away from a drop-in block that claims it,
  // whether or not it ends up drawn on this sheet.
  const availabilityByKey = new Map(
    computeDayAvailability(sessions).map((result) => [result.sessionKey, result])
  );

  const toBlock = (s: ExpandedSession): DeckBlock => ({
    key: s.key,
    label: sessionDisplayLabel(s),
    kindLabel: occupancyKindLabel(s.occupancyKind),
    timeLabel: timeRangeLabel(s),
    spaceNames: s.spaceNames,
    noteMarker: markerByKey.get(s.key) ?? null,
    availability: availabilityByKey.get(s.key) ?? null,
  });

  const sortedByStart = (list: ExpandedSession[]) =>
    [...list].sort((a, b) => a.start.getTime() - b.start.getTime());

  return {
    dateKey: sessionDateString(day),
    rows,
    columns,
    residual: sortedByStart(residualSessions).map(toBlock),
    unplaced: sortedByStart(unplacedSessions).map(toBlock),
    notes,
    isEmpty: drawable.length === 0 && residualSessions.length === 0 && unplacedSessions.length === 0,
  };
}

/**
 * The cell lookup the renderer needs: what to draw at this row, in this track.
 *
 * `"covered"` means a claim above spans through this row, so the renderer must
 * emit no `<td>` at all — a stray empty cell there shifts every later column by
 * one and is the classic way a rowSpan table goes wrong.
 */
export function deckCellAt(track: DeckClaim[], slotIndex: number): DeckClaim | "covered" | null {
  for (const claim of track) {
    if (claim.startSlot === slotIndex) return claim;
    if (slotIndex > claim.startSlot && slotIndex < claim.startSlot + claim.slotSpan) return "covered";
  }
  return null;
}
