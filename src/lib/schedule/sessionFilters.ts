import { minutesOfDayIn, zonedDayOfWeek } from "@/lib/utils/dates";
import type { ExpandedSession } from "@/types/schedule.types";

/**
 * The visitor-facing schedule filters, matching `widget_configs.enabled_filters`
 * (migration 044). An org picks which of these its widget offers.
 */
export const SESSION_FILTER_KEYS = [
  "search",
  "activity",
  "day",
  "time",
  "space",
  "age",
  "week",
] as const;

export type SessionFilterKey = (typeof SESSION_FILTER_KEYS)[number];

export const DEFAULT_ENABLED_FILTERS: SessionFilterKey[] = ["search", "activity", "day", "time"];

export function isSessionFilterKey(value: string): value is SessionFilterKey {
  return (SESSION_FILTER_KEYS as readonly string[]).includes(value);
}

export type TimeBand = "morning" | "afternoon" | "evening";

export const TIME_BANDS: { value: TimeBand; label: string; detail: string }[] = [
  { value: "morning", label: "Morning", detail: "Before noon" },
  { value: "afternoon", label: "Afternoon", detail: "Noon – 5pm" },
  { value: "evening", label: "Evening", detail: "5pm onwards" },
];

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Every filter's current selection. Empty everywhere means "show everything". */
export interface SessionFilterState {
  search: string;
  /** Activity names, as `activityNameOf` produces them. */
  activities: string[];
  /** 0 = Sunday, matching `zonedDayOfWeek`. */
  days: number[];
  times: TimeBand[];
  /** Space names rather than ids: a session carries `spaceNames`, and a name is what a visitor picked. */
  spaces: string[];
  ages: string[];
}

export const EMPTY_FILTER_STATE: SessionFilterState = {
  search: "",
  activities: [],
  days: [],
  times: [],
  spaces: [],
  ages: [],
};

/**
 * What a session is *called* on screen.
 *
 * The schedule views print `templateName ?? scheduleGroupName`, so filtering
 * has to group by the same string — an "Activity" filter offering values a
 * visitor cannot see on any session is worse than no filter at all.
 */
export function activityNameOf(session: ExpandedSession): string {
  return session.templateName ?? session.scheduleGroupName;
}

export function timeBandOf(session: ExpandedSession): TimeBand {
  const minutes = minutesOfDayIn(session.start);
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  return "evening";
}

/** The distinct values the loaded sessions actually offer, sorted for display. */
export interface SessionFilterOptions {
  activities: string[];
  days: number[];
  times: TimeBand[];
  spaces: string[];
  ages: string[];
}

export function deriveFilterOptions(sessions: ExpandedSession[]): SessionFilterOptions {
  const activities = new Set<string>();
  const days = new Set<number>();
  const times = new Set<TimeBand>();
  const spaces = new Set<string>();
  const ages = new Set<string>();

  for (const session of sessions) {
    activities.add(activityNameOf(session));
    days.add(zonedDayOfWeek(session.start));
    times.add(timeBandOf(session));
    for (const space of session.spaceNames) spaces.add(space);
    if (session.ageGroup) ages.add(session.ageGroup);
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return {
    activities: [...activities].sort(collator.compare),
    days: [...days].sort((a, b) => a - b),
    // Chronological, not alphabetical — a morning/afternoon/evening row that
    // reads "Afternoon Evening Morning" looks like a bug.
    times: TIME_BANDS.map((b) => b.value).filter((b) => times.has(b)),
    spaces: [...spaces].sort(collator.compare),
    ages: [...ages].sort(collator.compare),
  };
}

/** Everything a free-text search should match on for one session. */
function searchableText(session: ExpandedSession): string {
  return [
    activityNameOf(session),
    session.scheduleGroupName,
    session.templateName,
    session.departmentName,
    session.facilityName,
    session.locationDetail,
    session.ageGroup,
    session.skillLevel,
    ...session.spaceNames,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Apply a filter state to already-expanded sessions.
 *
 * Every dimension is AND-ed with the others and OR-ed within itself, which is
 * what a visitor means by "Tuesday or Thursday, in the morning". An empty
 * selection for a dimension is "no opinion", never "match nothing" — the
 * alternative makes a freshly-opened filter bar show an empty schedule.
 */
export function filterSessions(
  sessions: ExpandedSession[],
  state: SessionFilterState
): ExpandedSession[] {
  const query = state.search.trim().toLowerCase();
  // Multi-word search is AND-ed across terms, so "water tuesday" narrows
  // rather than widening into everything matching either word.
  const terms = query ? query.split(/\s+/) : [];

  return sessions.filter((session) => {
    if (terms.length > 0) {
      const haystack = searchableText(session);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    if (state.activities.length > 0 && !state.activities.includes(activityNameOf(session))) {
      return false;
    }
    if (state.days.length > 0 && !state.days.includes(zonedDayOfWeek(session.start))) return false;
    if (state.times.length > 0 && !state.times.includes(timeBandOf(session))) return false;
    if (
      state.spaces.length > 0 &&
      !session.spaceNames.some((name) => state.spaces.includes(name))
    ) {
      return false;
    }
    if (state.ages.length > 0 && !(session.ageGroup && state.ages.includes(session.ageGroup))) {
      return false;
    }
    return true;
  });
}

/** How many dimensions are currently narrowing the list — drives the "N active" badge. */
export function activeFilterCount(state: SessionFilterState): number {
  return (
    (state.search.trim() ? 1 : 0) +
    state.activities.length +
    state.days.length +
    state.times.length +
    state.spaces.length +
    state.ages.length
  );
}

/** Parse `widget_configs.enabled_filters` (or a preview query param) into known keys. */
export function parseEnabledFilters(value: string[] | string | null | undefined): SessionFilterKey[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(",");
  return list.map((v) => v.trim()).filter(isSessionFilterKey);
}
