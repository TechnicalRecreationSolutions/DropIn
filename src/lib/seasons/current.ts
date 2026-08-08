import type { Database } from "@/types/database.types";
import { localDateString } from "@/lib/utils/dates";

export type Season = Database["public"]["Tables"]["seasons"]["Row"];

/** The subset a picker or a range calculation actually needs. */
export type SeasonSummary = Pick<
  Season,
  "id" | "name" | "slug" | "starts_on" | "ends_on" | "status"
>;

/**
 * Season date handling deliberately works on `YYYY-MM-DD` strings rather than
 * Date objects.
 *
 * `seasons.starts_on` / `ends_on` are DATE columns — calendar days with no
 * time and no zone. Parsing them into a Date attaches the browser's offset,
 * which is how "Fall starts Sep 8" becomes Sep 7 for anyone west of the
 * server. ISO date strings sort and compare lexicographically, so every
 * comparison below is both correct and zone-free. Convert to a Date only at
 * the edge, where something genuinely needs one (week navigation), and
 * convert through the same helper each time.
 */

/** True when `date` (a YYYY-MM-DD string) falls inside the season, inclusive of both ends. */
export function seasonContainsDate(season: SeasonSummary, date: string): boolean {
  return date >= season.starts_on && date <= season.ends_on;
}

/**
 * Resolves which season the app should be looking at. **The one definition of
 * "current season" — never re-derive this inline.**
 *
 * Seasons are allowed to overlap (see the header of migration 027), so `now()`
 * alone does not identify one. The rule, in order:
 *
 *   1. An explicit selection wins, whatever its dates or status — staff working
 *      ahead on next Fall in March must not have the app argue with them.
 *   2. Otherwise the *active* season containing today. Where several overlap
 *      (a year-long period plus the Fall inside it), the one that started most
 *      recently wins: it is the more specific of the two, and specificity is
 *      what someone opening the schedule today means.
 *   3. Otherwise the next active season due to start — between terms, the
 *      useful answer is the one being planned, not the one that just ended.
 *   4. Otherwise none. A season is optional everywhere; nothing may require one.
 *
 * 'planning' and 'archived' seasons are never auto-resolved, only explicitly
 * selected. Auto-landing on a planning season would show staff a half-built
 * period as though it were live.
 */
export function resolveCurrentSeason<T extends SeasonSummary>(
  seasons: T[],
  selectedId?: string | null,
  today: string = localDateString()
): T | null {
  if (selectedId) {
    const selected = seasons.find((s) => s.id === selectedId);
    if (selected) return selected;
    // A stale or hand-edited id falls through to the rule below rather than
    // resolving to nothing, so a dead link still lands somewhere sensible.
  }

  const active = seasons.filter((s) => s.status === "active");

  const containing = active
    .filter((s) => seasonContainsDate(s, today))
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  if (containing.length > 0) return containing[0];

  const upcoming = active
    .filter((s) => s.starts_on > today)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  if (upcoming.length > 0) return upcoming[0];

  return null;
}

/** Sort order for every season list in the UI: newest period first. */
export function sortSeasons<T extends SeasonSummary>(seasons: T[]): T[] {
  return [...seasons].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
}

/**
 * Converts a season's start date into a Date at local midnight, for handing to
 * week navigation. This is the single crossing point from date-string to Date
 * (see the note at the top of this file) — `new Date("2026-09-08")` parses as
 * UTC midnight and would shift the day backwards for western timezones.
 */
export function seasonStartAsDate(season: SeasonSummary): Date {
  const [y, m, d] = season.starts_on.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Sep 8 – Dec 20, 2026", or "Dec 20, 2026 – Jan 4, 2027" when it spans a new year. */
export function formatSeasonRange(season: SeasonSummary): string {
  const start = seasonStartAsDate(season);
  const [ey, em, ed] = season.ends_on.split("-").map(Number);
  const end = new Date(ey, em - 1, ed);

  const sameYear = start.getFullYear() === end.getFullYear();
  const startFmt: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };

  return `${start.toLocaleDateString(undefined, startFmt)} – ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/** How a season relates to today — drives the badge on the picker and the seasons page. */
export type SeasonTiming = "past" | "current" | "upcoming";

export function seasonTiming(season: SeasonSummary, today: string = localDateString()): SeasonTiming {
  if (season.ends_on < today) return "past";
  if (season.starts_on > today) return "upcoming";
  return "current";
}
