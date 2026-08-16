import type { ExpandedSession } from "@/types/schedule.types";
import { nowAsSessionTime } from "@/lib/utils/dates";

/**
 * Whether a session occurrence is currently in progress, already ended, or
 * hasn't started yet, relative to `now`. Shared by WeeklyScheduleGrid,
 * WeeklyScheduleList, and FloorplanView so "On now" means the same thing
 * everywhere rather than three separately-maintained comparisons.
 *
 * `now` must be in the same convention as `session.start`/`.end` (local
 * wall-clock digits in the UTC slots) — default via `nowAsSessionTime()`,
 * never a plain `new Date()`, and compare with UTC getters throughout.
 */
export function getSessionLiveStatus(session: ExpandedSession, now: Date = nowAsSessionTime()) {
  const isToday =
    now.getUTCFullYear() === session.start.getUTCFullYear() &&
    now.getUTCMonth() === session.start.getUTCMonth() &&
    now.getUTCDate() === session.start.getUTCDate();
  const isLive = isToday && session.start <= now && now < session.end;
  const isPast = session.end < now;
  return { isLive, isPast };
}
