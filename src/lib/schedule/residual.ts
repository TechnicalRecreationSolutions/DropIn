import type { ExpandedSession } from "@/types/schedule.types";
import { isExclusiveKind, sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { formatSessionTime } from "@/lib/utils/dates";

/**
 * Residual subtraction — cutting drop-in blocks down to what exclusive claims
 * leave them.
 *
 * This is the rendering half of the rule migration 046 states and
 * `availability.ts` measures: `drop_in` is **residual**, it occupies whatever is
 * not exclusively claimed. Until now that was only ever *computed* — the
 * availability calculator ran in shadow mode and published nothing, so a program
 * booked over a drop-in block left the block drawn at full width and a patron
 * reading the schedule saw water that was not there. This function makes the
 * schedule itself say what the calculator already knew.
 *
 * ### Bands, not halves
 *
 * A block is cut at every point where a claim touching it starts or ends, and
 * each resulting band keeps **only the spaces still free through that whole
 * band**. WaterWalking 9–5 on Lanes 1–6 with Lap Swimming 10:30–12:30 on Lanes
 * 1–3 therefore becomes three occurrences — 9:00–10:30 on six lanes, 10:30–12:30
 * on *three*, 12:30–5:00 on six — rather than two with a hole in the middle.
 * Dropping the middle band is the easy read of "cut it in half" and it is wrong:
 * water walking genuinely continues in Lanes 4–6 while the program runs, and a
 * schedule that hides it sends patrons home for no reason.
 *
 * Bands whose free set is empty are dropped outright. That is §4.3 of the
 * availability design ("the block does not exist publicly then") applied to the
 * schedule rather than to a label: if every lane is claimed there is nothing to
 * publish, and drawing a zero-lane drop-in block is the one error that actually
 * strands someone at a locked door.
 *
 * ### What counts as a rival depends on who is asking, and that is deliberate
 *
 * Rivals are whatever exclusive occurrences the caller can see, so this must run
 * **after** `applyDisclosure`:
 *
 *  - `public` claims (a program) cut, and name themselves.
 *  - `reserved` claims (a rental) cut, and show as "Reserved" — the time and the
 *    spaces survive disclosure precisely so availability stays honest.
 *  - `internal` claims cut **for staff only**, because RLS never sends the row to
 *    an outsider. A patron therefore sees a block uncut on a lane an internal
 *    hold has taken. That is a real gap and not one this function can close from
 *    here: closing it means giving internal bookings a public, anonymous shadow,
 *    which is a migration-046 decision rather than a rendering change. Until
 *    then `internal` is the wrong kind for anything that takes water away from a
 *    published block.
 *
 * ### Derived, never stored
 *
 * Nothing here writes. The DB keeps one 9–5 WaterWalking row; move or delete the
 * program and the block re-flows on the next render with no repair needed. That
 * is the whole reason "residual" is a derived property rather than a column.
 */

export interface SubtractOptions {
  /**
   * Keep a residual occurrence that exclusive claims consume **entirely**,
   * marked as fully claimed rather than removed.
   *
   * The two audiences need opposite things here, which is why this is a
   * parameter rather than a rule:
   *
   *  - A **patron** must not see it. A drop-in block on a lane a rental has
   *    taken outright is an advertisement for water that does not exist, and
   *    removing it is the single most useful thing this whole file does.
   *  - **Staff** must. A booking that vanishes from every view cannot be
   *    clicked, edited, or deleted — the row is still in the database and the
   *    only way to fix it would be to guess it was there. It comes back at its
   *    original times and spaces (so it stays draggable and positioned) with a
   *    `residualSegment` marker naming what swallowed it; the map's track
   *    packing then draws it beside the claim instead of underneath it.
   *
   * Partially-eaten blocks need no such care in either direction: their
   * surviving bands keep the session reachable.
   */
  preserveFullyClaimed?: (session: ExpandedSession) => boolean;
}

/**
 * Half-open range of **absolute occurrence milliseconds** — `Date.getTime()` on
 * the occurrence's own start/end.
 *
 * Deliberately not minutes-from-midnight, which is what `availability.ts` uses.
 * That function is documented as taking "one day's occurrences" and its callers
 * filter to a single day before calling it, so a date-less comparison is safe
 * there. This one is handed a whole week at a time by /api/sessions/expand, and
 * a minutes-only bound made Monday's program cut Sunday's drop-in block — the
 * two overlap perfectly once you throw the date away. Absolute times also make
 * a block running past midnight ordinary rather than a special case.
 */
export interface Interval {
  start: number;
  end: number;
}

/** Absolute start/end of an occurrence. */
function boundsOf(session: ExpandedSession): Interval {
  return { start: session.start.getTime(), end: session.end.getTime() };
}

/** True when two half-open ranges share any time at all. */
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * What `range` has left once every interval in `taken` is removed.
 *
 * Used for the map's per-lane view, where the question is not "how many lanes
 * are free" but "when is *this* lane free" — see `freeIntervalsForSpace`.
 */
export function subtractIntervals(range: Interval, taken: Interval[]): Interval[] {
  const clipped = taken
    .filter((t) => overlaps(range, t))
    .map((t) => ({ start: Math.max(t.start, range.start), end: Math.min(t.end, range.end) }))
    .sort((a, b) => a.start - b.start);

  const out: Interval[] = [];
  let cursor = range.start;
  for (const t of clipped) {
    if (t.start > cursor) out.push({ start: cursor, end: t.start });
    cursor = Math.max(cursor, t.end);
  }
  if (cursor < range.end) out.push({ start: cursor, end: range.end });
  return out;
}

/**
 * When one space is free within one residual block, given every occurrence that
 * could claim it. The map's lane columns need this rather than the band split: a
 * band cut by a claim on Lane 1 must not fragment Lane 4's column, which nothing
 * has touched.
 */
export function freeIntervalsForSpace(
  block: ExpandedSession,
  spaceId: string,
  rivals: ExpandedSession[]
): Interval[] {
  const range = boundsOf(block);
  const taken = rivals
    .filter(
      (r) =>
        isExclusiveKind(r.occupancyKind) &&
        r.sessionId !== block.sessionId &&
        r.spaceIds.includes(spaceId)
    )
    .map(boundsOf);
  return subtractIntervals(range, taken);
}

/** "9:00 AM – 5:00 PM" for the block a slice came out of. */
function blockTimeLabel(block: ExpandedSession): string {
  return formatSessionTime(block.start) + " – " + formatSessionTime(block.end);
}

/** A derived occurrence carries the context its own times no longer show. */
function withSegment(
  block: ExpandedSession,
  band: Interval,
  freeSpaceIds: string[],
  takenBy: string[]
): ExpandedSession {
  const freeSet = new Set(freeSpaceIds);
  const kept = block.spaceIds
    .map((id, i) => (freeSet.has(id) ? i : -1))
    .filter((i) => i >= 0);
  const keptSet = new Set(kept);

  return {
    ...block,
    // Unique per segment: `key` is the React key in every view and the analytics
    // key in SessionModal, so two bands of one block must not collide.
    key: `${block.key}@${band.start}`,
    start: new Date(band.start),
    end: new Date(band.end),
    spaceIds: kept.map((i) => block.spaceIds[i]),
    spaceNames: kept.map((i) => block.spaceNames[i]),
    residualSegment: {
      blockTimeLabel: blockTimeLabel(block),
      isSlice: true,
      takenBy,
      lostSpaceNames: block.spaceNames.filter((_, i) => !keptSet.has(i)),
    },
  };
}

/**
 * Rejoins the bands of one session that are contiguous **within a single space**.
 *
 * A band boundary is a property of the whole block, so a claim on Lane 1 cuts the
 * block for Lane 4 too. In a view with no lane axis that split is the point —
 * each band carries the lanes it genuinely still holds, and the reader sees the
 * reduction. In the map's lane columns it is noise: Lane 4 would show three
 * stacked blocks, 9–10:30, 10:30–12:30, 12:30–5, where nothing happened to it at
 * all.
 *
 * So this is for callers that draw **one space at a time**. Callers with no lane
 * axis must not use it — they would lose the reduction entirely, since a rejoined
 * entry lists the union of the lanes its bands held.
 *
 * Only bands that genuinely **touch** are joined, and only within one session, so
 * a real gap survives: Lane 1's 10:30–12:30, or a stretch where every lane is
 * claimed and no band exists at all.
 */
export function mergeResidualBands(sessions: ExpandedSession[]): ExpandedSession[] {
  const bandsBySession = new Map<string, ExpandedSession[]>();
  const out: ExpandedSession[] = [];

  for (const session of sessions) {
    if (!session.residualSegment) {
      out.push(session);
      continue;
    }
    bandsBySession.set(session.sessionId, [...(bandsBySession.get(session.sessionId) ?? []), session]);
  }

  for (const bands of bandsBySession.values()) {
    const ordered = [...bands].sort((a, b) => a.start.getTime() - b.start.getTime());
    let run: ExpandedSession[] = [];

    const flush = () => {
      if (run.length === 1) out.push(run[0]);
      else if (run.length > 1) out.push(joinRun(run));
      run = [];
    };

    for (const band of ordered) {
      const prev = run[run.length - 1];
      // Same session and truly adjacent — a different day, or a stretch with no
      // lanes left, breaks the run rather than being papered over.
      if (prev && prev.end.getTime() !== band.start.getTime()) flush();
      run.push(band);
    }
    flush();
  }

  return out;
}

/** Collapses one run of touching bands into the entry a reader sees. */
function joinRun(run: ExpandedSession[]): ExpandedSession {
  const first = run[0];
  const last = run[run.length - 1];

  // Union of every lane the block holds at some point in the run, in the order
  // the block itself lists them.
  const unionIds: string[] = [];
  const unionNames: string[] = [];
  for (const band of run) {
    band.spaceIds.forEach((id, i) => {
      if (!unionIds.includes(id)) {
        unionIds.push(id);
        unionNames.push(band.spaceNames[i]);
      }
    });
  }

  return {
    ...first,
    end: last.end,
    spaceIds: unionIds,
    spaceNames: unionNames,
    residualSegment: {
      blockTimeLabel: first.residualSegment!.blockTimeLabel,
      // The joined entry spans this column’s whole stretch again, so its times
      // are once more the ones staff entered — no longer a slice, and draggable.
      isSlice: false,
      // Whatever cut this block did so in *another* column. Naming it here would
      // tell this lane it lost something it never lost.
      takenBy: [],
      lostSpaceNames: [],
    },
  };
}

/**
 * Cuts every residual occurrence in `sessions` down to what the exclusive
 * occurrences in `rivals` leave it, returning exclusive occurrences untouched.
 *
 * `rivals` defaults to `sessions`, which is correct only when the caller holds
 * the whole facility's week. A caller scoped to one schedule group must pass the
 * facility-wide set instead: a rental usually lives under a *different* group
 * than the drop-in block it eats into, so subtracting only within one group
 * computes full availability and is confidently wrong. `/api/sessions/expand`
 * does exactly that, which is why the subtraction lives there and not in a view.
 */
export function subtractExclusiveClaims(
  sessions: ExpandedSession[],
  rivals: ExpandedSession[] = sessions,
  options: SubtractOptions = {}
): ExpandedSession[] {
  const exclusive = rivals.filter((r) => isExclusiveKind(r.occupancyKind));
  const out: ExpandedSession[] = [];

  for (const session of sessions) {
    if (isExclusiveKind(session.occupancyKind)) {
      out.push(session);
      continue;
    }

    // A block naming no spaces has nothing to subtract from — inventing a
    // denominator (the facility's whole space list, say) would cut it by a claim
    // it never overlapped. Same reasoning as computeDayAvailability's filter.
    if (session.spaceIds.length === 0) {
      out.push(session);
      continue;
    }

    const range = boundsOf(session);
    const claimed = new Set(session.spaceIds);
    const contenders = exclusive
      .map((claim) => ({ claim, bounds: boundsOf(claim) }))
      .filter(
        ({ claim, bounds }) =>
          claim.sessionId !== session.sessionId &&
          claim.spaceIds.some((id) => claimed.has(id)) &&
          overlaps(range, bounds)
      );

    if (contenders.length === 0) {
      out.push(session);
      continue;
    }

    // Cut at every rival edge strictly inside the block.
    const cuts = new Set<number>([range.start, range.end]);
    for (const { bounds } of contenders) {
      if (bounds.start > range.start && bounds.start < range.end) cuts.add(bounds.start);
      if (bounds.end > range.start && bounds.end < range.end) cuts.add(bounds.end);
    }
    const edges = [...cuts].sort((a, b) => a - b);

    const bands: { band: Interval; free: string[]; takenBy: string[] }[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const band = { start: edges[i], end: edges[i + 1] };
      const taken = new Set<string>();
      const takenBy: string[] = [];
      for (const { claim, bounds } of contenders) {
        if (!overlaps(band, bounds)) continue;
        for (const id of claim.spaceIds) if (claimed.has(id)) taken.add(id);
        const name = sessionDisplayLabel(claim);
        if (!takenBy.includes(name)) takenBy.push(name);
      }
      const free = session.spaceIds.filter((id) => !taken.has(id));
      if (free.length > 0) bands.push({ band, free, takenBy });
    }

    // Merge neighbours that kept exactly the same spaces, so a block only
    // fragments where something actually changed.
    const merged: typeof bands = [];
    for (const entry of bands) {
      const prev = merged[merged.length - 1];
      const sameSpaces =
        prev &&
        prev.band.end === entry.band.start &&
        prev.free.length === entry.free.length &&
        prev.free.every((id, i) => entry.free[i] === id);
      if (sameSpaces) {
        prev.band.end = entry.band.end;
        for (const name of entry.takenBy) if (!prev.takenBy.includes(name)) prev.takenBy.push(name);
        continue;
      }
      merged.push({ band: { ...entry.band }, free: entry.free, takenBy: [...entry.takenBy] });
    }

    // An untouched block keeps its original identity — same key, no
    // `residualSegment` marker — so the overwhelmingly common case comes out
    // exactly as it did before this function existed.
    if (
      merged.length === 1 &&
      merged[0].band.start === range.start &&
      merged[0].band.end === range.end &&
      merged[0].free.length === session.spaceIds.length
    ) {
      out.push(session);
      continue;
    }

    if (merged.length === 0 && options.preserveFullyClaimed?.(session)) {
      const takenBy: string[] = [];
      for (const { claim } of contenders) {
        const name = sessionDisplayLabel(claim);
        if (!takenBy.includes(name)) takenBy.push(name);
      }
      out.push({
        ...session,
        residualSegment: {
          blockTimeLabel: blockTimeLabel(session),
          isSlice: false,
          takenBy,
          lostSpaceNames: session.spaceNames,
        },
      });
      continue;
    }

    for (const { band, free, takenBy } of merged) {
      out.push(withSegment(session, band, free, takenBy));
    }
  }

  return out;
}
