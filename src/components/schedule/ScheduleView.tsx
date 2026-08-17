"use client";

import type { ExpandedSession, ScheduleTemplate } from "@/types/schedule.types";
import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import WeeklyScheduleList from "./WeeklyScheduleList";
import WeeklyScheduleMap from "./WeeklyScheduleMap";
import FloorplanView from "./FloorplanView";

interface ScheduleViewProps {
  template: ScheduleTemplate;
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
  /** Kept for callers that still track a month anchor alongside the week; no current template reads it. */
  month: Date;
  onMonthChange: (newMonth: Date) => void;
  /** Required for "floorplan" — a facility map is scoped to exactly one facility. Falls back to grid without it. */
  facilityId?: string;
}

/**
 * Renders the schedule in whichever template the org has selected.
 * The shared integration point for the widget, public facility page,
 * and dashboard — swap the template here rather than at each call site.
 *
 * Note that this component only *renders*: the range and filters behind
 * `sessions` are the caller's job.
 */
export default function ScheduleView({
  template,
  sessions,
  weekStart,
  onWeekChange,
  facilityId,
}: ScheduleViewProps) {
  switch (template) {
    case "list":
      return <WeeklyScheduleList sessions={sessions} weekStart={weekStart} onWeekChange={onWeekChange} />;
    case "map":
      return <WeeklyScheduleMap sessions={sessions} weekStart={weekStart} onWeekChange={onWeekChange} />;
    case "floorplan":
      if (!facilityId) {
        return <WeeklyScheduleGrid sessions={sessions} weekStart={weekStart} onWeekChange={onWeekChange} />;
      }
      return <FloorplanView facilityId={facilityId} sessions={sessions} />;
    case "grid":
    default:
      return <WeeklyScheduleGrid sessions={sessions} weekStart={weekStart} onWeekChange={onWeekChange} />;
  }
}
