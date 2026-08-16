import type { createClient } from "@/lib/supabase/server";
import { expandOccurrenceTimes } from "@/lib/rrule/expand";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** How far out an open-ended (valid_until IS NULL) session gets expanded when
 *  compared against another open-ended session — neither can be expanded to
 *  infinity, so the comparison window is capped here instead. */
const MAX_LOOKAHEAD_YEARS = 2;

export interface SessionConflictCandidate {
  /** Null for a session being created — it has no id yet, and therefore no
   *  existing exceptions of its own and nothing to exclude from "other". */
  sessionId: string | null;
  rrule: string;
  dtstart: string;
  dtend_time: string;
  valid_from: string;
  valid_until: string | null;
  spaceIds: string[];
}

/**
 * True double-booking check: do any of this candidate's occurrences overlap
 * in time with another active session that claims at least one of the same
 * spaces? Reuses expandOccurrenceTimes() (src/lib/rrule/expand.ts) for both
 * sides so RRULE parsing and exception handling (cancelled/modified
 * occurrences) are never re-derived here — only the space-matching and
 * pairwise time-overlap logic is new.
 *
 * Returns null when there's no conflict (including when the candidate claims
 * no spaces at all — nothing to double-book).
 */
export async function findSessionConflict(
  supabase: SupabaseServerClient,
  candidate: SessionConflictCandidate
): Promise<{ error: string } | null> {
  if (candidate.spaceIds.length === 0) return null;

  // Other sessions that share at least one of the candidate's spaces.
  const { data: spaceLinks } = await supabase
    .from("session_spaces")
    .select("session_id")
    .in("space_id", candidate.spaceIds);

  const otherSessionIds = Array.from(
    new Set((spaceLinks ?? []).map((r) => r.session_id))
  ).filter((id) => id !== candidate.sessionId);
  if (otherSessionIds.length === 0) return null;

  const { data: otherSessions } = await supabase
    .from("sessions")
    .select("id, schedule_group_id, rrule, dtstart, dtend_time, valid_from, valid_until")
    .in("id", otherSessionIds)
    .eq("is_active", true);
  if (!otherSessions || otherSessions.length === 0) return null;

  // Batched once for every session involved, rather than one query per
  // pairing — expandOccurrenceTimes filters internally by session_id, so
  // handing it the full combined list is safe.
  const allSessionIds = [
    ...(candidate.sessionId ? [candidate.sessionId] : []),
    ...otherSessions.map((s) => s.id),
  ];
  const { data: exceptions } = await supabase
    .from("session_exceptions")
    .select("*")
    .in("session_id", allSessionIds);

  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + MAX_LOOKAHEAD_YEARS);

  const candidateValidFrom = new Date(candidate.valid_from + "T00:00:00Z");
  const candidateValidTo = candidate.valid_until
    ? new Date(candidate.valid_until + "T23:59:59Z")
    : horizon;

  for (const other of otherSessions) {
    const otherValidFrom = new Date(other.valid_from + "T00:00:00Z");
    const otherValidTo = other.valid_until ? new Date(other.valid_until + "T23:59:59Z") : horizon;

    // Intersection of both sessions' date ranges — no point expanding either
    // outside the window where they could possibly both be running.
    const rangeStart = candidateValidFrom > otherValidFrom ? candidateValidFrom : otherValidFrom;
    const rangeEnd = candidateValidTo < otherValidTo ? candidateValidTo : otherValidTo;
    if (rangeStart > rangeEnd) continue;

    const candidateOccurrences = expandOccurrenceTimes(
      {
        id: candidate.sessionId ?? "__candidate__",
        rrule: candidate.rrule,
        dtstart: candidate.dtstart,
        dtend_time: candidate.dtend_time,
        valid_from: candidate.valid_from,
        valid_until: candidate.valid_until,
      },
      exceptions ?? [],
      { rangeStart, rangeEnd }
    );
    if (candidateOccurrences.length === 0) continue;

    const otherOccurrences = expandOccurrenceTimes(other, exceptions ?? [], { rangeStart, rangeEnd });
    if (otherOccurrences.length === 0) continue;

    for (const c of candidateOccurrences) {
      for (const o of otherOccurrences) {
        if (c.start < o.end && o.start < c.end) {
          const { data: scheduleGroup } = await supabase
            .from("schedule_groups")
            .select("name")
            .eq("id", other.schedule_group_id)
            .maybeSingle();

          // o.start is a session occurrence (UTC-getter convention, see
          // rrule/README.md) — pin the formatter to UTC explicitly so the
          // message reads correctly regardless of the server's own runtime
          // zone, rather than reading via the runtime-local getters
          // toLocaleDateString/toLocaleTimeString would otherwise use.
          const conflictDate = o.start.toLocaleDateString("en-CA", { timeZone: "UTC" });
          const conflictTime = o.start.toLocaleTimeString("en-CA", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "UTC",
          });
          return {
            error: `Conflicts with "${scheduleGroup?.name ?? "another schedule"}" — both claim the same space on ${conflictDate} around ${conflictTime}.`,
          };
        }
      }
    }
  }

  return null;
}
