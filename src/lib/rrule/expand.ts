import { RRule, RRuleSet } from "rrule";
import type {
  ExpandedSession,
  RangeExpandParams,
} from "@/types/schedule.types";
import type { Database } from "@/types/database.types";
import {
  hasAnyWindow,
  resolveOperatingWindows,
  type OperatingHoursByDepartment,
  type DepartmentOperatingHours,
} from "@/lib/schedule/operating-hours";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type SessionExceptionRow =
  Database["public"]["Tables"]["session_exceptions"]["Row"];
type ScheduleGroupRow = Database["public"]["Tables"]["schedule_groups"]["Row"];
type FacilityRow = Database["public"]["Tables"]["facilities"]["Row"];
type DepartmentRow = Database["public"]["Tables"]["departments"]["Row"];
type SpaceRow = Database["public"]["Tables"]["spaces"]["Row"];
type SessionTemplateRow = Database["public"]["Tables"]["session_templates"]["Row"];
type TagRow = Database["public"]["Tables"]["tags"]["Row"];
type SessionTemplateLinkRow =
  Database["public"]["Tables"]["session_template_links"]["Row"];

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
  session_spaces: {
    spaces: Pick<SpaceRow, "id" | "name" | "display_order"> | null;
  }[];
  // Null when the session has no template_id, or the template was archived/
  // deleted — and, before migration 050, for every anonymous caller, because
  // session_templates had no public-read policy and PostgREST nulls an embedded
  // resource that RLS filters. That is why the public schedule showed the
  // schedule *group* name on every card. 050 adds the policy; the nullability
  // here is still real for the other two reasons.
  session_templates:
    | (Pick<SessionTemplateRow, "id" | "name" | "color" | "description"> & {
        // Presentation only, both nested one level deeper by PostgREST. The
        // ordering these arrive in is not guaranteed by the embed, so both are
        // sorted on display_order below rather than trusted.
        session_template_tags: {
          display_order: number;
          tags: Pick<TagRow, "id" | "label" | "color"> | null;
        }[];
        session_template_links: Pick<
          SessionTemplateLinkRow,
          "id" | "label" | "url" | "display_order"
        >[];
      })
    | null;
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
  /** Which operating-hours window of that day this occurrence came from
   *  (migration 058). Always 0 for a fixed-time session, and for the first
   *  window of a following one; a department that opens 06:00-12:00 and
   *  16:00-21:00 produces a second occurrence with windowIndex 1.
   *
   *  It exists because `occurrenceDate` alone stopped being unique per
   *  session the moment one date could hold two windows, and that pair is
   *  what ExpandedSession.key is built from. Exception lookups still key on
   *  the date alone — see the cancel/modify note in expandOccurrenceTimes. */
  windowIndex: number;
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
  session: Pick<SessionRow, "id" | "rrule" | "dtstart" | "dtend_time" | "valid_from" | "valid_until"> &
    Partial<Pick<SessionRow, "follows_operating_hours">>,
  exceptions: SessionExceptionRow[],
  range: RangeExpandParams,
  /** The owning department's week (migration 058). Only consulted when
   *  `session.follows_operating_hours` is true. Callers that do not have
   *  hours in hand may omit it — a following session then degrades to its
   *  stored snapshot times rather than disappearing (see `following` below). */
  operatingHours?: DepartmentOperatingHours
): OccurrenceTime[] {
  const { rangeStart, rangeEnd } = range;

  // A session only *follows* hours if it asked to AND there are hours to
  // follow. The distinction below is the whole contract:
  //
  //   * No hours at all (no department, never configured, or every window
  //     deleted) -> NOT following. Falls through to the fixed-time path and
  //     uses the dtstart/dtend_time snapshot. A session that silently
  //     produced zero occurrences forever would be indistinguishable from
  //     one that had been deleted, and staff would have no way to see what
  //     went wrong. Stale beats vanished.
  //   * Hours exist, but this particular weekday has none -> following, and
  //     that day yields NO occurrence. That is a real closed day, and it is
  //     the behaviour the feature is for.
  const following = session.follows_operating_hours === true && hasAnyWindow(operatingHours);

  const exceptionMap = new Map<string, SessionExceptionRow>();
  for (const ex of exceptions) {
    if (ex.session_id === session.id) exceptionMap.set(ex.exception_date, ex);
  }

  let rule: RRule;
  try {
    // A following session's DTSTART time is anchored to midnight, because its
    // stored time component is only a snapshot and must not influence which
    // DAYS come out. It otherwise could: rule.between() clamps on instants,
    // so a snapshot of 21:00 would drop a day whose real hours are squarely
    // inside the range. Midnight can never be clipped that way. Which
    // weekdays the rule generates is unaffected — rrule advances DTSTART by
    // whole calendar increments and BYDAY matches the date, not the clock
    // (see README.md).
    //
    // Day selection for these sessions is therefore date-based, and the
    // *windows* are filtered against the real range afterwards (see
    // `overlapsRange` below) — which is the correct test anyway: a day
    // belongs in the result when one of its open windows overlaps what was
    // asked for, not when an unrelated stored timestamp happens to.
    const anchor = following ? atMidnight(session.dtstart) : session.dtstart;
    rule = RRule.fromString(`DTSTART:${dtstartLine(anchor)}\n${session.rrule}`);
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

  // For a following session the generated occurrences sit at midnight, so the
  // lower bound has to be floored to the start of its day or the first day is
  // lost whenever the caller passes a mid-day rangeStart — which
  // /api/sessions/expand explicitly allows ("an explicit rangeStart is taken
  // literally"). The windows resolved on that day are then filtered against
  // the unfloored bounds, so nothing outside the requested range escapes.
  const generateFrom = following ? startOfUtcDay(expandFrom) : expandFrom;

  const occurrences = rule.between(generateFrom, expandTo, true);
  const results: OccurrenceTime[] = [];

  for (const start of occurrences) {
    const dateKey = toDateString(start);
    const exception = exceptionMap.get(dateKey);

    // Skip cancelled occurrences entirely. For a following session this
    // cancels the whole DATE, every window of it — `session_exceptions` keys
    // on a date and gains no second column here. "Closed Christmas Day" is
    // what staff mean, and cancelling only the morning half of a split day
    // has never been askable.
    if (exception?.exception_type === "cancelled") continue;

    // A modified exception wins outright, and for a following session it also
    // COLLAPSES the date to a single occurrence at the modified times. The
    // alternative — applying the override to each window — would duplicate
    // one stated correction across two blocks, so "on the 14th this runs
    // 09:00-11:00" would produce two identical 09:00-11:00 occurrences on a
    // split day. An explicit time replaces the derived ones entirely; that is
    // what overriding means.
    if (exception?.exception_type === "modified" && exception.modified_start && exception.modified_end) {
      results.push({
        occurrenceDate: dateKey,
        start: new Date(exception.modified_start),
        end: new Date(exception.modified_end),
        isModified: true,
        modificationNote: exception.note ?? null,
        windowIndex: 0,
      });
      continue;
    }

    if (following) {
      // Read the weekday with getUTCDay(), never getDay() — an occurrence is
      // wall-clock digits wearing a meaningless "Z", so the runtime-local
      // getter returns a different weekday off-UTC and would apply the wrong
      // day's hours (src/lib/schedule/operating-hours.ts says more).
      // `dateKey` is the occurrence date a holiday override would be keyed
      // on (059); the weekday is the fallback when no override exists.
      const windows = resolveOperatingWindows(operatingHours, dateKey, start.getUTCDay());

      // Closed that day. No occurrence — not a zero-length one: a patron
      // should not be able to tell "we are shut" from "we are open and
      // nothing is booked".
      for (let i = 0; i < windows.length; i++) {
        const windowStart = atMinutes(start, windows[i].opens);
        const windowEnd = atMinutes(start, windows[i].closes);
        // windowIndex stays the index within the DAY, not within the kept
        // set, so a block's key does not change depending on which range it
        // was fetched in.
        if (windowEnd <= expandFrom || windowStart > expandTo) continue;
        results.push({
          occurrenceDate: dateKey,
          start: windowStart,
          end: windowEnd,
          isModified: false,
          modificationNote: exception?.note ?? null,
          windowIndex: i,
        });
      }
      continue;
    }

    results.push({
      occurrenceDate: dateKey,
      start,
      end: buildEndTime(start, session.dtend_time),
      isModified: false,
      modificationNote: exception?.note ?? null,
      windowIndex: 0,
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
  params: RangeExpandParams,
  /** Operating hours for every department these sessions belong to, keyed by
   *  department id (migration 058). Omitting it does not break anything: a
   *  session that follows hours falls back to its stored snapshot times. The
   *  caller is expected to supply it — /api/sessions/expand does — but a
   *  narrower one-off caller need not learn about hours to stay correct. */
  operatingHours?: OperatingHoursByDepartment
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

    const template = session.session_templates;

    // Built once per session and shared by reference across every occurrence of
    // it, unlike spaceIds/spaceNames which are rebuilt per occurrence below.
    // A 120-day org-wide expand produces tens of thousands of occurrences, and
    // these are read-only presentation data — nothing downstream mutates them
    // in place (applyDisclosure and subtractExclusiveClaims both spread into
    // fresh objects). Keep it that way: a mutation here would reach every
    // occurrence of the session at once.
    const templateTags = (template?.session_template_tags ?? [])
      .filter((row) => row.tags !== null)
      .sort((a, b) => a.display_order - b.display_order)
      .map((row) => ({
        id: row.tags!.id,
        label: row.tags!.label,
        color: row.tags!.color,
      }));

    const templateLinks = (template?.session_template_links ?? [])
      .sort((a, b) => a.display_order - b.display_order)
      .map((link) => ({ id: link.id, label: link.label, url: link.url }));

    const occurrences = expandOccurrenceTimes(
      session,
      exceptions,
      params,
      department ? operatingHours?.get(department.id) : undefined
    );

    for (const occ of occurrences) {
      results.push({
        // The window index is appended only from the SECOND window of a date
        // onward, so every key that existed before migration 058 keeps its
        // exact spelling — this value is a React key, a DOM id
        // (WeeklyScheduleMap) and an analytics dedup token, and silently
        // renaming all of them to buy uniformity would be churn. Uniqueness
        // is what matters, and `_w1` onward provides it.
        key:
          occ.windowIndex === 0
            ? `${session.id}_${occ.occurrenceDate}`
            : `${session.id}_${occ.occurrenceDate}_w${occ.windowIndex}`,
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
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        templateColor: template?.color ?? null,
        templateDescription: template?.description ?? null,
        templateTags,
        templateLinks,
        occupancyKind: session.occupancy_kind,
        disclosure: session.disclosure,
        // Staff-only, and deliberately not sourced from the session row: the
        // caller attaches these from `session_internal` only when the viewer
        // belongs to the owning org (see /api/sessions/expand). Expansion has
        // no business knowing who is asking, so it always produces the safe
        // value and lets the route add to it.
        holderName: null,
        setupNotes: null,
        locationDetail: session.location_detail,
        isModified: occ.isModified,
        modificationNote: occ.modificationNote,
        // The session's own flag, not "did this occurrence get derived times"
        // — a following session whose hours have gone falls back to its
        // snapshot, and the editor still needs to know it is a following
        // session so it can say why dragging it does nothing.
        followsOperatingHours: session.follows_operating_hours === true,
      });
    }
  }

  // Sort chronologically
  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
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
 * The same wall-clock DATE as `dtstart`, at 00:00 — the RRULE anchor for a
 * session that follows operating hours (see the note at the call site).
 * Stays in the stored convention: UTC getters in, Date.UTC out, no conversion.
 */
function atMidnight(dtstart: string): string {
  return startOfUtcDay(new Date(dtstart)).toISOString();
}

/** Midnight at the start of `date`'s own wall-clock day, in the stored
 *  convention (UTC getters in, Date.UTC out — never a conversion). */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * An occurrence date at a given minute-of-day, in the same wall-clock
 * convention as everything else here (`Date.UTC` building digits, not an
 * instant). Used to place a following session inside one operating window.
 */
function atMinutes(occurrenceStart: Date, minutesFromMidnight: number): Date {
  return new Date(
    Date.UTC(
      occurrenceStart.getUTCFullYear(),
      occurrenceStart.getUTCMonth(),
      occurrenceStart.getUTCDate(),
      Math.floor(minutesFromMidnight / 60),
      minutesFromMidnight % 60
    )
  );
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
