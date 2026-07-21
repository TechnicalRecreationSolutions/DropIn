import { RRule, RRuleSet } from "rrule";
import type {
  ExpandedSession,
  WeekExpandParams,
} from "@/types/schedule.types";
import type { Database } from "@/types/database.types";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type SessionExceptionRow =
  Database["public"]["Tables"]["session_exceptions"]["Row"];
type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];
type FacilityRow = Database["public"]["Tables"]["facilities"]["Row"];

export type SessionWithRelations = SessionRow & {
  programs: ProgramRow & {
    facilities: Pick<FacilityRow, "id" | "name">;
  };
};

/**
 * Expands an array of recurring sessions into concrete occurrences
 * for the given week range, applying exceptions (cancellations/modifications).
 *
 * Sessions store an iCal RRULE string. This function:
 *   1. Parses the RRULE with the rrule package
 *   2. Clamps expansion to the session's valid_from/valid_until season bounds
 *   3. Filters out cancelled exceptions
 *   4. Substitutes modified times for modified exceptions
 *   5. Returns a flat list of ExpandedSession objects ready for the grid
 */
export function expandSessions(
  sessions: SessionWithRelations[],
  exceptions: SessionExceptionRow[],
  params: WeekExpandParams
): ExpandedSession[] {
  const { weekStart, weekEnd } = params;
  const results: ExpandedSession[] = [];

  // Index exceptions by session_id + date for O(1) lookup
  const exceptionMap = new Map<string, SessionExceptionRow>();
  for (const ex of exceptions) {
    exceptionMap.set(`${ex.session_id}_${ex.exception_date}`, ex);
  }

  for (const session of sessions) {
    const program = session.programs;
    const facility = program.facilities;

    // Parse the RRULE string
    let rule: RRule;
    try {
      rule = RRule.fromString(
        `DTSTART:${formatDtstart(session.dtstart)}\n${session.rrule}`
      );
    } catch {
      // Malformed RRULE — skip silently, log in production
      console.warn(`Skipping session ${session.id}: invalid RRULE "${session.rrule}"`);
      continue;
    }

    // Clamp expansion range to the session's season bounds
    const seasonStart = new Date(session.valid_from + "T00:00:00Z");
    const seasonEnd = session.valid_until
      ? new Date(session.valid_until + "T23:59:59Z")
      : null;

    const expandFrom = weekStart > seasonStart ? weekStart : seasonStart;
    const expandTo =
      seasonEnd && weekEnd > seasonEnd ? seasonEnd : weekEnd;

    if (expandFrom > expandTo) continue;

    // Get all occurrences in the week range
    const occurrences = rule.between(expandFrom, expandTo, true);

    for (const occurrence of occurrences) {
      const dateKey = toDateString(occurrence);
      const exKey = `${session.id}_${dateKey}`;
      const exception = exceptionMap.get(exKey);

      // Skip cancelled occurrences entirely
      if (exception?.exception_type === "cancelled") continue;

      // Determine start/end times — use modified times if exception exists
      let start: Date;
      let end: Date;

      if (exception?.exception_type === "modified" && exception.modified_start && exception.modified_end) {
        start = new Date(exception.modified_start);
        end = new Date(exception.modified_end);
      } else {
        start = occurrence;
        end = buildEndTime(occurrence, session.dtend_time);
      }

      results.push({
        key: `${session.id}_${dateKey}`,
        sessionId: session.id,
        programId: program.id,
        orgId: session.org_id,
        start,
        end,
        programName: program.name,
        sportCategory: program.sport_category,
        activityType: program.activity_type,
        costCents: program.cost_cents,
        costNotes: program.cost_notes,
        ageGroup: program.age_group,
        skillLevel: program.skill_level,
        maxParticipants: program.max_participants,
        facilityId: facility.id,
        facilityName: facility.name,
        locationDetail: session.location_detail,
        source: session.source,
        lastSyncedAt: session.last_synced_at,
        isModified: exception?.exception_type === "modified",
        modificationNote: exception?.note ?? null,
      });
    }
  }

  // Sort chronologically
  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Format a TIMESTAMPTZ string to the DTSTART format rrule expects: YYYYMMDDTHHmmssZ */
function formatDtstart(dtstart: string): string {
  return new Date(dtstart)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Build the end Date for an occurrence using the session's dtend_time (HH:MM:SS) */
function buildEndTime(occurrenceStart: Date, dtendTime: string): Date {
  const [hours, minutes] = dtendTime.split(":").map(Number);
  const end = new Date(occurrenceStart);
  end.setUTCHours(hours, minutes, 0, 0);
  // Handle edge case: if end is before start, it rolled past midnight
  if (end < occurrenceStart) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  return end;
}

/** Format a Date to YYYY-MM-DD for exception key matching */
function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Builds an RRuleSet that excludes exception dates.
 * Used when you need an rrule-native representation for display purposes
 * (e.g. showing "next 5 occurrences" in the dashboard editor).
 */
export function buildRRuleSet(
  session: Pick<SessionRow, "rrule" | "dtstart" | "valid_from" | "valid_until">,
  cancelledDates: string[]
): RRuleSet {
  const set = new RRuleSet();

  const rule = RRule.fromString(
    `DTSTART:${formatDtstart(session.dtstart)}\n${session.rrule}`
  );
  set.rrule(rule);

  for (const dateStr of cancelledDates) {
    set.exdate(new Date(dateStr + "T00:00:00Z"));
  }

  return set;
}
