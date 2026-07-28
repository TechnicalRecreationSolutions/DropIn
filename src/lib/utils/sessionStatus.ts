import type { ExpandedSession } from "@/types/schedule.types";

/**
 * Whether a session occurrence is currently in progress, already ended, or
 * hasn't started yet, relative to `now`. Shared by WeeklyScheduleGrid,
 * WeeklyScheduleList, and FloorplanView so "On now" means the same thing
 * everywhere rather than three separately-maintained comparisons.
 */
export function getSessionLiveStatus(session: ExpandedSession, now: Date = new Date()) {
  const isToday = now.toDateString() === session.start.toDateString();
  const isLive = isToday && session.start <= now && now < session.end;
  const isPast = session.end < now;
  return { isLive, isPast };
}
