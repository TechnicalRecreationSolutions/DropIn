import type { createClient } from "@/lib/supabase/server";
import { expandOccurrenceTimes } from "@/lib/rrule/expand";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** One side of an org-wide conflict — enough to show it and to resubmit the
 *  session through POST /api/sessions if the manager reassigns its space. */
export interface ConflictParticipant {
  sessionId: string;
  scheduleGroupId: string;
  scheduleGroupName: string;
  scheduleGroupStatus: "draft" | "published";
  facilityId: string;
  departmentId: string | null;
  rrule: string;
  dtstart: string;
  dtendTime: string;
  validFrom: string;
  validUntil: string | null;
  spaceIds: string[];
  spaceNames: string[];
}

export interface OrgConflict {
  /** `${lower session id}_${higher session id}` — matches the ordering
   *  session_conflict_dismissals enforces via its CHECK constraint. */
  key: string;
  sessionA: ConflictParticipant;
  sessionB: ConflictParticipant;
  /** Every space the pair shares an overlapping occurrence in — usually one,
   *  but a multi-space session can collide with the same other session more
   *  than once. */
  spaceIds: string[];
  spaceNames: string[];
  /** Earliest overlapping occurrence found, for display only. */
  occurrenceDate: string;
  occurrenceTime: string;
  dismissed: boolean;
  dismissalId: string | null;
  dismissalNote: string | null;
}

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

/** Shape of findOrgConflicts()'s one nested select — the generated Database
 *  types don't model PostgREST embeds, so this is described explicitly and
 *  cast once, the same pattern used elsewhere (see getOrgContext). */
interface OrgSessionRow {
  id: string;
  rrule: string;
  dtstart: string;
  dtend_time: string;
  valid_from: string;
  valid_until: string | null;
  schedule_groups: {
    id: string;
    name: string;
    status: "draft" | "published";
    facility_id: string;
    department_id: string | null;
  } | null;
  session_spaces: { space_id: string; spaces: { id: string; name: string } | null }[];
}

/** How far out an org-wide scan looks, same rationale as MAX_LOOKAHEAD_YEARS
 *  above — open-ended sessions can't be expanded to infinity. */
const ORG_SCAN_LOOKAHEAD_YEARS = 2;

function toParticipant(s: OrgSessionRow): ConflictParticipant {
  const spaces = s.session_spaces.filter((link) => link.spaces !== null);
  return {
    sessionId: s.id,
    scheduleGroupId: s.schedule_groups!.id,
    scheduleGroupName: s.schedule_groups!.name,
    scheduleGroupStatus: s.schedule_groups!.status,
    facilityId: s.schedule_groups!.facility_id,
    departmentId: s.schedule_groups!.department_id,
    rrule: s.rrule,
    dtstart: s.dtstart,
    dtendTime: s.dtend_time,
    validFrom: s.valid_from,
    validUntil: s.valid_until,
    spaceIds: spaces.map((link) => link.space_id),
    spaceNames: spaces.map((link) => link.spaces!.name),
  };
}

/**
 * Org-wide conflict scan for the /dashboard/conflicts manager and the
 * Overview's "Conflicts" stat card — every active session, draft schedules
 * included (a schedule that isn't published yet can still be built wrong,
 * and imported sessions land as drafts having skipped findSessionConflict()
 * entirely, see /api/import/commit/route.ts).
 *
 * Reuses expandOccurrenceTimes() for the actual overlap math, same as
 * findSessionConflict() above, but compares every pair of sessions sharing a
 * space rather than one candidate against the rest — there's no write-time
 * gate stopping a conflict from existing here; the whole point is finding
 * ones that already got in (via import, or a row edited directly).
 *
 * On-demand, not backed by a persisted table — see migration 039's header
 * for why. session_conflict_dismissals is the one piece of state this
 * function does read, to mark pairs staff have already reviewed.
 */
export async function findOrgConflicts(
  supabase: SupabaseServerClient,
  orgId: string
): Promise<OrgConflict[]> {
  const { data: sessionRows } = await supabase
    .from("sessions")
    .select(
      `id, rrule, dtstart, dtend_time, valid_from, valid_until,
       schedule_groups!inner ( id, name, status, facility_id, department_id ),
       session_spaces ( space_id, spaces ( id, name ) )`
    )
    .eq("org_id", orgId)
    .eq("is_active", true);

  const sessions = ((sessionRows ?? []) as unknown as OrgSessionRow[]).filter(
    (s) => s.schedule_groups !== null
  );
  if (sessions.length < 2) return [];

  const { data: exceptionRows } = await supabase
    .from("session_exceptions")
    .select("*")
    .in("session_id", sessions.map((s) => s.id));
  const exceptions = exceptionRows ?? [];

  // Bucket sessions by shared space — only sessions that could possibly
  // collide (same space) are ever compared against each other.
  const bySpace = new Map<string, { spaceName: string; sessions: OrgSessionRow[] }>();
  for (const s of sessions) {
    for (const link of s.session_spaces) {
      if (!link.spaces) continue;
      const bucket = bySpace.get(link.space_id) ?? { spaceName: link.spaces.name, sessions: [] };
      bucket.sessions.push(s);
      bySpace.set(link.space_id, bucket);
    }
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setFullYear(horizon.getFullYear() + ORG_SCAN_LOOKAHEAD_YEARS);

  const conflictsByPair = new Map<string, OrgConflict>();

  for (const [spaceId, bucket] of bySpace) {
    const list = bucket.sessions;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const pairKey = a.id < b.id ? `${a.id}_${b.id}` : `${b.id}_${a.id}`;

        const existing = conflictsByPair.get(pairKey);
        if (existing) {
          if (!existing.spaceIds.includes(spaceId)) {
            existing.spaceIds.push(spaceId);
            existing.spaceNames.push(bucket.spaceName);
          }
          continue;
        }

        const aFrom = new Date(a.valid_from + "T00:00:00Z");
        const aTo = a.valid_until ? new Date(a.valid_until + "T23:59:59Z") : horizon;
        const bFrom = new Date(b.valid_from + "T00:00:00Z");
        const bTo = b.valid_until ? new Date(b.valid_until + "T23:59:59Z") : horizon;

        const rangeStart = [today, aFrom, bFrom].reduce((x, y) => (x > y ? x : y));
        const rangeEnd = aTo < bTo ? aTo : bTo;
        if (rangeStart > rangeEnd) continue;

        const aOcc = expandOccurrenceTimes(a, exceptions, { rangeStart, rangeEnd });
        if (aOcc.length === 0) continue;
        const bOcc = expandOccurrenceTimes(b, exceptions, { rangeStart, rangeEnd });
        if (bOcc.length === 0) continue;

        let firstOverlapStart: Date | null = null;
        outer: for (const oa of aOcc) {
          for (const ob of bOcc) {
            if (oa.start < ob.end && ob.start < oa.end) {
              firstOverlapStart = oa.start;
              break outer;
            }
          }
        }
        if (!firstOverlapStart) continue;

        conflictsByPair.set(pairKey, {
          key: pairKey,
          sessionA: toParticipant(a.id < b.id ? a : b),
          sessionB: toParticipant(a.id < b.id ? b : a),
          spaceIds: [spaceId],
          spaceNames: [bucket.spaceName],
          occurrenceDate: firstOverlapStart.toLocaleDateString("en-CA", { timeZone: "UTC" }),
          occurrenceTime: firstOverlapStart.toLocaleTimeString("en-CA", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "UTC",
          }),
          dismissed: false,
          dismissalId: null,
          dismissalNote: null,
        });
      }
    }
  }

  const conflicts = Array.from(conflictsByPair.values());
  if (conflicts.length === 0) return [];

  const { data: dismissalRows } = await supabase
    .from("session_conflict_dismissals")
    .select("id, session_a_id, session_b_id, note")
    .eq("org_id", orgId);

  const dismissalMap = new Map(
    (dismissalRows ?? []).map((d) => [`${d.session_a_id}_${d.session_b_id}`, d])
  );

  for (const c of conflicts) {
    const d = dismissalMap.get(c.key);
    if (d) {
      c.dismissed = true;
      c.dismissalId = d.id;
      c.dismissalNote = d.note;
    }
  }

  // Active (undismissed) conflicts first, earliest occurrence first within
  // each group.
  conflicts.sort((x, y) => {
    if (x.dismissed !== y.dismissed) return x.dismissed ? 1 : -1;
    return x.occurrenceDate.localeCompare(y.occurrenceDate);
  });

  return conflicts;
}
