"use client";

import type { ExpandedSession, ScheduleTemplate } from "@/types/schedule.types";
import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import WeeklyScheduleList from "./WeeklyScheduleList";
import WeeklyScheduleMap from "./WeeklyScheduleMap";
import FloorplanView from "./FloorplanView";
import EventCalendarView, { type PrintBranding } from "./EventCalendarView";

interface ScheduleViewProps {
  template: ScheduleTemplate;
  sessions: ExpandedSession[];
  weekStart: Date;
  onWeekChange: (newWeekStart: Date) => void;
  /**
   * Any date inside the month "events" shows. Both this and `weekStart` come
   * from one `useScheduleAnchor`, so the two never disagree about where in the
   * calendar the viewer is.
   */
  month: Date;
  onMonthChange: (newMonth: Date) => void;
  /** Required for "floorplan" — a facility map is scoped to exactly one facility. Falls back to grid without it. */
  facilityId?: string;
  /** Org name/logo for the printed event sheet. Only "events" uses it. */
  printBranding?: PrintBranding;
}

/**
 * Renders the schedule in whichever template the org has selected.
 * The shared integration point for the widget, public facility page,
 * and dashboard — swap the template here rather than at each call site.
 *
 * Note that this component only *renders*: the range and filters behind
 * `sessions` are the caller's job, and the templates disagree about what they
 * need (a week for four of them, a month of `is_event` sessions for "events").
 * Callers get that right by fetching through `useTemplateSchedule` with the
 * same `template` they pass here — passing a week's sessions to the events
 * calendar produces a plausible-looking calendar that's empty after week one.
 */
export default function ScheduleView({
  template,
  sessions,
  weekStart,
  onWeekChange,
  month,
  onMonthChange,
  facilityId,
  printBranding,
}: ScheduleViewProps) {
  switch (template) {
    case "list":
      return <WeeklyScheduleList sessions={sessions} weekStart={weekStart} onWeekChange={onWeekChange} />;
    case "map":
      return <WeeklyScheduleMap sessions={sessions} weekStart={weekStart} onWeekChange={onWeekChange} />;
    case "events":
      return (
        <EventCalendarView
          sessions={sessions}
          month={month}
          onMonthChange={onMonthChange}
          printBranding={printBranding}
        />
      );
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
