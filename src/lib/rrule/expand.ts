import { RRule, RRuleSet } from "rrule";
import type {
  ExpandedSession,
  RangeExpandParams,
  SessionFeatureContent,
} from "@/types/schedule.types";
import type { Database } from "@/types/database.types";
import { zonedDateString, zonedTimeToUtc } from "@/lib/utils/timezone";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type SessionExceptionRow =
  Database["public"]["Tables"]["session_exceptions"]["Row"];
type ScheduleGroupRow = Database["public"]["Tables"]["schedule_groups"]["Row"];
type FacilityRow = Database["public"]["Tables"]["facilities"]["Row"];
type DepartmentRow = Database["public"]["Tables"]["departments"]["Row"];
type SpaceRow = Database["public"]["Tables"]["spaces"]["Row"];
type SessionTemplateRow = Database["public"]["Tables"]["session_templates"]["Row"];
type SessionFeatureRow = Database["public"]["Tables"]["session_features"]["Row"];

export type SessionWithRelations = SessionRow & {
  // Nullable: an embedded PostgREST filter (e.g. schedule_groups.department_id=eq...)
  // that doesn't match still returns the session row with schedule_groups: null,
  // rather than omitting the row entirely.
  schedule_groups: (ScheduleGroupRow & {
    facilities: Pick<FacilityRow, "id" | "name">;
    departments: Pick<DepartmentRow, "id" | "name"> | null;
  }) | null;
  // Empty array when the session has no spaces attached. PostgREST nests the
  // join-table rows, each carrying its embedded `spaces` object.
  session_spaces: { spaces: Pick<SpaceRow, "id" | "name" | "display_order"> }[];
  // Null when the session has no template_id, or the template was archived/deleted.
  session_templates: Pick<SessionTemplateRow, "id" | "name" | "color"> | null;
  // session_features is 1:1 (UNIQUE session_id), so PostgREST *should* detect a
  // to-one relationship and embed an object. It falls back to an array when it
  // can't — which is exactly the kind of difference that shows up only against
  // the live database, so both shapes are accepted and normalized below rather
  // than trusted. Absent entirely when the session has never been featured.
  session_features: SessionFeatureRow | SessionFeatureRow[] | null;
};

/**
 * Expands an array of recurring sessions into concrete occurrences for the
 * given date range, applying exceptions (cancellations/modifications).
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
  params: RangeExpandParams
): ExpandedSession[] {
  const { rangeStart, rangeEnd } = params;
  const results: ExpandedSession[] = [];

  // Index exceptions by session_id + date for O(1) lookup
  const exceptionMap = new Map<string, SessionExceptionRow>();
  for (const ex of exceptions) {
    exceptionMap.set(`${ex.session_id}_${ex.exception_date}`, ex);
  }

  for (const session of sessions) {
    const scheduleGroup = session.schedule_groups;
    // An embedded PostgREST filter (e.g. schedule_groups.department_id=eq...)
    // that doesn't match still returns the session row, but with
    // schedule_groups: null — skip it rather than crash.
    if (!scheduleGroup) continue;

    const facility = scheduleGroup.facilities;
    const department = scheduleGroup.departments;

    const attachedSpaces = session.session_spaces
      .map((row) => row.spaces)
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));

    // Built once per session rather than per occurrence — a month of a daily
    // session is ~30 occurrences that would otherwise each allocate an
    // identical object.
    const feature = toFeatureContent(session.session_features);

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

    const expandFrom = rangeStart > seasonStart ? rangeStart : seasonStart;
    const expandTo =
      seasonEnd && rangeEnd > seasonEnd ? seasonEnd : rangeEnd;

    if (expandFrom > expandTo) continue;

    // Get all occurrences in the requested range
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
        end = buildEndTime(occurrence, session.dtend_time, session.timezone);
      }

      results.push({
        key: `${session.id}_${dateKey}`,
        sessionId: session.id,
        orgId: session.org_id,
        start,
        end,
        timezone: session.timezone,
        scheduleGroupId: scheduleGroup.id,
        scheduleGroupName: scheduleGroup.name,
        sportCategory: scheduleGroup.sport_category,
        activityType: scheduleGroup.activity_type,
        costCents: scheduleGroup.cost_cents,
        costNotes: scheduleGroup.cost_notes,
        ageGroup: scheduleGroup.age_group,
        skillLevel: scheduleGroup.skill_level,
        maxParticipants: scheduleGroup.max_participants,
        facilityId: facility.id,
        facilityName: facility.name,
        departmentId: department?.id ?? null,
        departmentName: department?.name ?? null,
        spaceIds: attachedSpaces.map((s) => s.id),
        spaceNames: attachedSpaces.map((s) => s.name),
        templateId: session.session_templates?.id ?? null,
        templateName: session.session_templates?.name ?? null,
        templateColor: session.session_templates?.color ?? null,
        // Read straight off the session row rather than through a join — the
        // occurrence only needs the id, so that a duplicate keeps the source
        // session's season instead of inheriting whatever is selected now.
        seasonId: session.season_id,
        isEvent: session.is_event,
        inBrochure: session.in_brochure,
        feature,
        locationDetail: session.location_detail,
        isModified: exception?.exception_type === "modified",
        modificationNote: exception?.note ?? null,
      });
    }
  }

  // Sort chronologically
  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Normalizes the embedded session_features row into the camelCase shape the
 * views consume, accepting either an object or a single-element array (see the
 * note on SessionWithRelations.session_features).
 */
function toFeatureContent(
  embedded: SessionFeatureRow | SessionFeatureRow[] | null | undefined
): SessionFeatureContent | null {
  const row = Array.isArray(embedded) ? (embedded[0] ?? null) : (embedded ?? null);
  if (!row) return null;
  return {
    title: row.title,
    summary: row.summary,
    description: row.description,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    eventCategory: row.event_category,
    accentColor: row.accent_color,
  };
}

/** Format a TIMESTAMPTZ string to the DTSTART format rrule expects: YYYYMMDDTHHmmssZ */
function formatDtstart(dtstart: string): string {
  return new Date(dtstart)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Build the end Date for an occurrence using the session's dtend_time
 * (HH:MM, wall-clock in the session's timezone). occurrenceStart is a UTC
 * instant, so dtend_time must be converted through the same timezone rather
 * than assumed to already be UTC — otherwise the result drifts from the
 * start time by the zone's UTC offset.
 */
function buildEndTime(occurrenceStart: Date, dtendTime: string, timeZone: string): Date {
  // dtendTime comes from the `dtend_time` TIME column as "HH:MM:SS";
  // zonedTimeToUtc expects "HH:MM".
  const time = dtendTime.slice(0, 5);
  const dateStr = zonedDateString(occurrenceStart, timeZone);
  let end = zonedTimeToUtc(dateStr, time, timeZone);
  // Handle edge case: if end is before start, it rolled past midnight
  if (end < occurrenceStart) {
    const nextDay = new Date(occurrenceStart.getTime() + 24 * 60 * 60 * 1000);
    end = zonedTimeToUtc(zonedDateString(nextDay, timeZone), time, timeZone);
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
