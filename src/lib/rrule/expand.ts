import { RRule, RRuleSet } from "rrule";
import type {
  ExpandedSession,
  RangeExpandParams,
  SessionFeatureContent,
} from "@/types/schedule.types";
import type { Database } from "@/types/database.types";

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
  // join-table rows, each carrying its embedded `spaces` object — nullable
  // for the same reason schedule_groups is above: a viewer without RLS
  // access to that specific space (e.g. an anonymous visitor and a space
  // still in Draft) gets the join-table row back with `spaces: null` rather
  // than the row being omitted. Must be filtered, not trusted present.
  session_spaces: { spaces: Pick<SpaceRow, "id" | "name" | "display_order"> | null }[];
  // Null when the session has no template_id, or the template was archived/deleted.
  session_templates: Pick<SessionTemplateRow, "id" | "name" | "color"> | null;
  // session_features is 1:1 (UNIQUE session_id), so PostgREST *should* detect a
  // to-one relationship and embed an object. It falls back to an array when it
  // can't — which is exactly the kind of difference that shows up only against
  // the live database, so both shapes are accepted and normalized below rather
  // than trusted. Absent entirely when the session has never been featured.
  session_features: SessionFeatureRow | SessionFeatureRow[] | null;
};

/** One resolved occurrence's time range, plus whether an exception modified it. */
export interface OccurrenceTime {
  /** Calendar date (YYYY-MM-DD) of the originally-scheduled occurrence, before
   *  any modification — stable identity even if a 'modified' exception shifts
   *  the actual start/end. This is what exception lookups key on. */
  occurrenceDate: string;
  start: Date;
  end: Date;
  isModified: boolean;
  modificationNote: string | null;
}

/**
 * Expands a single recurring session's RRULE into concrete occurrence time
 * ranges within `range`, clamped to the session's valid_from/valid_until
 * bounds, with cancelled occurrences dropped and modified ones substituted.
 * The shared core both expandSessions() (below) and the session-conflict
 * checker (src/lib/sessions/conflicts.ts) build on.
 *
 * `session.dtstart` stores local wall-clock digits directly, with no real
 * instant meaning (see dropin/docs/RESUME-timezone-removal.md) — the exact
 * representation rrule.js itself needs, since its DTSTART arithmetic has no
 * notion of "local time" and just advances by fixed calendar increments.
 * Every value here — DTSTART, the generated occurrences, dtend_time — stays
 * in that same convention throughout; nothing is ever converted to or from a
 * real instant. Read start/end via UTC getters (see rrule/README.md), never
 * via runtime-local ones.
 */
export function expandOccurrenceTimes(
  session: Pick<SessionRow, "id" | "rrule" | "dtstart" | "dtend_time" | "valid_from" | "valid_until">,
  exceptions: SessionExceptionRow[],
  range: RangeExpandParams
): OccurrenceTime[] {
  const { rangeStart, rangeEnd } = range;

  const exceptionMap = new Map<string, SessionExceptionRow>();
  for (const ex of exceptions) {
    if (ex.session_id === session.id) exceptionMap.set(ex.exception_date, ex);
  }

  let rule: RRule;
  try {
    rule = RRule.fromString(`DTSTART:${dtstartLine(session.dtstart)}\n${session.rrule}`);
  } catch {
    // Malformed RRULE — skip silently, log in production
    console.warn(`Skipping session ${session.id}: invalid RRULE "${session.rrule}"`);
    return [];
  }

  const seasonStart = new Date(session.valid_from + "T00:00:00Z");
  const seasonEnd = session.valid_until
    ? new Date(session.valid_until + "T23:59:59Z")
    : null;

  const expandFrom = rangeStart > seasonStart ? rangeStart : seasonStart;
  const expandTo = seasonEnd && rangeEnd > seasonEnd ? seasonEnd : rangeEnd;

  if (expandFrom > expandTo) return [];

  const occurrences = rule.between(expandFrom, expandTo, true);
  const results: OccurrenceTime[] = [];

  for (const start of occurrences) {
    const dateKey = toDateString(start);
    const exception = exceptionMap.get(dateKey);

    // Skip cancelled occurrences entirely
    if (exception?.exception_type === "cancelled") continue;

    // Determine start/end times — use modified times if exception exists
    let occStart = start;
    let end: Date;

    if (exception?.exception_type === "modified" && exception.modified_start && exception.modified_end) {
      occStart = new Date(exception.modified_start);
      end = new Date(exception.modified_end);
    } else {
      end = buildEndTime(occStart, session.dtend_time);
    }

    results.push({
      occurrenceDate: dateKey,
      start: occStart,
      end,
      isModified: exception?.exception_type === "modified",
      modificationNote: exception?.note ?? null,
    });
  }

  return results;
}

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
  const results: ExpandedSession[] = [];

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
      .filter((space) => space !== null)
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));

    // Built once per session rather than per occurrence — a month of a daily
    // session is ~30 occurrences that would otherwise each allocate an
    // identical object.
    const feature = toFeatureContent(session.session_features);

    const occurrences = expandOccurrenceTimes(session, exceptions, params);

    for (const occ of occurrences) {
      results.push({
        key: `${session.id}_${occ.occurrenceDate}`,
        sessionId: session.id,
        orgId: session.org_id,
        start: occ.start,
        end: occ.end,
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
        isModified: occ.isModified,
        modificationNote: occ.modificationNote,
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

/**
 * Builds an RRULE DTSTART line straight from the stored value's own digits —
 * `session.dtstart` already holds local wall-clock date/time with no real
 * instant meaning (see the header comment above), so this is direct
 * formatting, not a conversion.
 */
function dtstartLine(dtstart: string): string {
  const d = new Date(dtstart);
  const y = d.getUTCFullYear();
  const mo = pad2(d.getUTCMonth() + 1);
  const da = pad2(d.getUTCDate());
  const h = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  return `${y}${mo}${da}T${h}${mi}00`;
}

/** Zero-pad a number to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Build the end Date for an occurrence using the session's dtend_time
 * (HH:MM, same wall-clock convention as dtstart). Both occurrenceStart and
 * the result stay in that convention throughout — no conversion.
 */
function buildEndTime(occurrenceStart: Date, dtendTime: string): Date {
  // dtendTime comes from the `dtend_time` TIME column as "HH:MM:SS".
  const [h, m] = dtendTime.slice(0, 5).split(":").map(Number);
  let end = new Date(Date.UTC(
    occurrenceStart.getUTCFullYear(),
    occurrenceStart.getUTCMonth(),
    occurrenceStart.getUTCDate(),
    h, m
  ));
  // Handle edge case: if end is before start, it rolled past midnight.
  if (end < occurrenceStart) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
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
 *
 * Currently unused (no call sites) — kept in the same dtstart convention as
 * expandOccurrenceTimes (local wall-clock digits, no conversion) so it stays
 * correct if it's ever wired up.
 */
export function buildRRuleSet(
  session: Pick<SessionRow, "rrule" | "dtstart" | "valid_from" | "valid_until">,
  cancelledDates: string[]
): RRuleSet {
  const set = new RRuleSet();

  const rule = RRule.fromString(`DTSTART:${dtstartLine(session.dtstart)}\n${session.rrule}`);
  set.rrule(rule);

  for (const dateStr of cancelledDates) {
    set.exdate(new Date(dateStr + "T00:00:00Z"));
  }

  return set;
}
