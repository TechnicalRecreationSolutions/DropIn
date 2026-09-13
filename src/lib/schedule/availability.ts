import type { ExpandedSession } from "@/types/schedule.types";
import { isExclusiveKind, sessionDisplayLabel } from "@/lib/sessions/occupancy";
import { minutesOfDayIn } from "@/lib/utils/dates";

/**
 * The availability calculator (stage 5 of docs/PLAN-internal-view.md) — in
 * **shadow mode**: it computes, and nothing it computes is published.
 *
 * The product's whole premise is that a facility already does this arithmetic by
 * hand. Commonwealth builds a lane-by-time spreadsheet of who has the water,
 * subtracts it from what the pool has, and types the remainder into a public PDF
 * as "Reduced Lanes / 3-4 Lanes / More than 4". This function does the
 * subtraction from the bookings staff have already entered.
 *
 * ### Why shadow mode, and what that means here
 *
 * A published availability number is a **promise**: if it is wrong a patron
 * drives to a full pool. So this runs advisory-only first — staff see their own
 * published claim beside the computed one and watch them agree (or not) for
 * several weeks, on their own data, before anything derives from it. Stage 6 is
 * the separate decision to publish. Nothing in this file reaches a public
 * surface, and the two callers (the command centre's shadow panel and the
 * staff-only deck sheet) are both behind org membership.
 *
 * ### The unit of availability is a `spaces` row
 *
 * "3 lanes available" only comes out of this if lanes are modelled as spaces. A
 * facility that models its pool as one space ("Competition Pool - 25m", which is
 * what `scripts/seed-saanich-pool.mjs` transcribes) gets 1 or 0, because an
 * exclusive claim takes the whole space. That is a real limit on what the
 * calculator can say, not a bug to work around: the alternative is a per-session
 * lane count ("this rental takes 3 of 8"), which migration 046 decision 2
 * deliberately did not build. `blocksWithoutLaneDetail()` below exists so a
 * caller can say so out loud rather than showing a confident "1".
 */

/** A band's occupancy expressed in the words the customer's own legend uses. */
export interface AvailabilityLevel {
  /** Inclusive lower bound of free spaces. */
  min: number;
  /** Inclusive upper bound; `Infinity` for the open-ended top band. */
  max: number;
  label: string;
}

/**
 * Commonwealth's published legend, transcribed from the same PDF as
 * `scripts/seed-saanich-pool.mjs` (RED / BLUE / BLACK).
 *
 * A constant rather than a column, deliberately: in shadow mode these words are
 * read by staff comparing two numbers, and nothing is published from them. The
 * moment stage 6 publishes a label, this becomes an org setting — that is the
 * right time to add the column, and the point of routing every caller through
 * `availabilityLabel()` is that it will be a one-line change.
 */
export const AVAILABILITY_LEGEND: AvailabilityLevel[] = [
  { min: 1, max: 2, label: "Reduced lanes" },
  { min: 3, max: 4, label: "3 or 4 lanes available" },
  { min: 5, max: Infinity, label: "More than 4 lanes available" },
];

/** What a band with nothing left says. Never published — see `suppressed` below. */
export const NO_AVAILABILITY_LABEL = "No lanes available";

export function availabilityLabel(available: number): string {
  if (available <= 0) return NO_AVAILABILITY_LABEL;
  return (
    AVAILABILITY_LEGEND.find((l) => available >= l.min && available <= l.max)?.label ??
    NO_AVAILABILITY_LABEL
  );
}

export interface AvailabilityBand {
  /** Minutes from midnight. May exceed 1440 for a block running past midnight. */
  startMinutes: number;
  endMinutes: number;
  /** How many of the block's own spaces are still free through this whole band. */
  available: number;
  /** The legend's word for `available`. Adjacent bands merge on THIS, not on the number. */
  label: string;
  /** Who is taking the rest, for the staff view. Already audience-gated upstream. */
  takenBy: string[];
}

export interface BlockAvailability {
  /** The residual occurrence this is about. */
  sessionKey: string;
  sessionId: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** What the block publishes today: the number of spaces it claims. */
  claimed: number;
  /** Bands with something left, merged by label. */
  bands: AvailabilityBand[];
  /** Stretches where nothing is left. The block does not exist publicly then (see §4.3). */
  suppressed: { startMinutes: number; endMinutes: number }[];
  /**
   * True when the computed picture disagrees with what the block publishes —
   * fewer lanes in some band, or a stretch with none at all. This is the only
   * flag the shadow panel needs: agreement is the boring case and should stay
   * quiet, week after week, until staff trust it.
   */
  differs: boolean;
}

/** Start/end of an occurrence in minutes from midnight, with midnight-crossing handled. */
function boundsOf(session: ExpandedSession): { start: number; end: number } {
  const start = minutesOfDayIn(session.start);
  const rawEnd = minutesOfDayIn(session.end);
  // A block ending at or before it starts ran past midnight; carry it forward a
  // day rather than producing a negative-length band.
  return { start, end: rawEnd <= start ? rawEnd + 24 * 60 : rawEnd };
}

/**
 * Computes, for each residual (drop-in) block on one day, how much of its own
 * claim is actually free — band by band.
 *
 * The bands are cut at every point where an exclusive claim touching this block
 * starts or ends (§4.1), the arithmetic per band is
 * `block's spaces − those exclusively claimed in that band` (§4.2), stretches
 * with nothing left are split out rather than published as zero (§4.3), and
 * adjacent bands merge when they carry the **same label** rather than the same
 * number (§4.4) — without that last rule a schedule fragments into several rows
 * an hour, which is precisely what the customer's own PDF avoids.
 *
 * `sessions` must be one day's occurrences for one facility, and it must include
 * the *other* schedule groups' bookings: a rental usually lives under a
 * different schedule group than the drop-in block it eats into, so a caller
 * scoped to one group would compute full availability and be confidently wrong.
 */
export function computeDayAvailability(sessions: ExpandedSession[]): BlockAvailability[] {
  const exclusive = sessions.filter((s) => isExclusiveKind(s.occupancyKind));
  const residual = sessions.filter((s) => !isExclusiveKind(s.occupancyKind));

  return residual
    // A block that names no spaces publishes no lane count, so there is nothing
    // to compare and nothing to subtract from. Inventing a denominator (the
    // facility's whole space list, say) would produce a number the block never
    // claimed.
    .filter((block) => block.spaceIds.length > 0)
    .map((block) => {
      const claimedIds = new Set(block.spaceIds);
      const { start: blockStart, end: blockEnd } = boundsOf(block);

      const rivals = exclusive
        .map((claim) => {
          const { start, end } = boundsOf(claim);
          const shared = claim.spaceIds.filter((id) => claimedIds.has(id));
          return { claim, start, end, shared };
        })
        .filter((r) => r.shared.length > 0 && r.start < blockEnd && blockStart < r.end);

      // Cut points: the block's own ends, plus every rival edge strictly inside it.
      const cuts = new Set<number>([blockStart, blockEnd]);
      for (const r of rivals) {
        if (r.start > blockStart && r.start < blockEnd) cuts.add(r.start);
        if (r.end > blockStart && r.end < blockEnd) cuts.add(r.end);
      }
      const edges = [...cuts].sort((a, b) => a - b);

      const raw: AvailabilityBand[] = [];
      for (let i = 0; i < edges.length - 1; i++) {
        const startMinutes = edges[i];
        const endMinutes = edges[i + 1];
        const taken = new Set<string>();
        const takenBy: string[] = [];
        for (const r of rivals) {
          if (r.start < endMinutes && startMinutes < r.end) {
            r.shared.forEach((id) => taken.add(id));
            const name = sessionDisplayLabel(r.claim);
            if (!takenBy.includes(name)) takenBy.push(name);
          }
        }
        const available = claimedIds.size - taken.size;
        raw.push({
          startMinutes,
          endMinutes,
          available,
          label: availabilityLabel(available),
          takenBy,
        });
      }

      // Merge on the label (§4.4). Two bands of 1 and 2 lanes both read "Reduced
      // lanes", and publishing them as two rows would be noise; `available` keeps
      // the lower of the two so the number never overstates what is free.
      const merged: AvailabilityBand[] = [];
      for (const band of raw) {
        const prev = merged[merged.length - 1];
        if (prev && prev.endMinutes === band.startMinutes && prev.label === band.label) {
          prev.endMinutes = band.endMinutes;
          prev.available = Math.min(prev.available, band.available);
          for (const name of band.takenBy) if (!prev.takenBy.includes(name)) prev.takenBy.push(name);
          continue;
        }
        merged.push({ ...band, takenBy: [...band.takenBy] });
      }

      const bands = merged.filter((b) => b.available > 0);
      const suppressed = merged
        .filter((b) => b.available <= 0)
        .map((b) => ({ startMinutes: b.startMinutes, endMinutes: b.endMinutes }));

      return {
        sessionKey: block.key,
        sessionId: block.sessionId,
        label: sessionDisplayLabel(block),
        startMinutes: blockStart,
        endMinutes: blockEnd,
        claimed: claimedIds.size,
        bands,
        suppressed,
        differs: suppressed.length > 0 || bands.some((b) => b.available < claimedIds.size),
      };
    });
}

/**
 * Residual blocks whose availability can only ever be 1 or 0, because they claim
 * a single space.
 *
 * Not an error — it is how a facility that models pool *areas* rather than lanes
 * has its data, and it is what `scripts/seed-saanich-pool.mjs` transcribes. But a
 * shadow panel that renders "1 lane available" there implies a precision the data
 * does not have, so callers surface this instead: the fix is to model lanes as
 * spaces, and that is a decision for the customer, not a default to impose.
 */
export function blocksWithoutLaneDetail(results: BlockAvailability[]): BlockAvailability[] {
  return results.filter((r) => r.claimed === 1);
}

/** "6:00am – 7:30am", for a band whose minutes may run past midnight. */
export function bandTimeLabel(startMinutes: number, endMinutes: number): string {
  return `${clockLabel(startMinutes)} – ${clockLabel(endMinutes)}`;
}

function clockLabel(minutes: number): string {
  const m = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 || 12}:${mm}${suffix}`;
}
