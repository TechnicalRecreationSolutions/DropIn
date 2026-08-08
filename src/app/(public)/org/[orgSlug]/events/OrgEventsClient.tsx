"use client";

import { useTemplateSchedule } from "@/hooks/useScheduleRange";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import ScheduleView from "@/components/schedule/ScheduleView";

interface OrgEventsClientProps {
  orgId: string;
  orgName: string;
  logoUrl: string | null;
}

/**
 * Client boundary for the org-wide event calendar.
 *
 * Fixed to the `events` template — there is no view switcher here, unlike the
 * facility page and the widget. Those surfaces offer whichever layouts the org
 * enabled in `widget_configs.allowed_templates`, because they are *the
 * schedule* and a visitor may reasonably want it as a grid or a list. This URL
 * is the event calendar specifically; a toggle that turned it into a weekly
 * grid of every session in every building would be a different page under the
 * same address.
 *
 * That's also why this page is not gated on `allowed_templates` containing
 * "events". That setting governs which layouts the *widget's* switcher offers,
 * not whether a dedicated org URL exists. An org with no events sees the
 * calendar's own empty state, which is honest and keeps the URL stable rather
 * than 404-ing a page that will start working the moment someone flips a
 * toggle.
 *
 * Renders the same `ScheduleView` the widget and dashboard mount, with no
 * editing provider above it — so it is read-only by construction rather than
 * by a second, forkable component.
 */
export default function OrgEventsClient({ orgId, orgName, logoUrl }: OrgEventsClientProps) {
  const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: "events",
    orgId,
    weekStart,
    month,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-400">
        Loading events…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-red-500">
        Could not load events. Please try again.
      </div>
    );
  }

  // Note there is no empty short-circuit here. The calendar owns its own empty
  // state, below its month navigator, so a visitor landing on a quiet month can
  // still page to a busy one.
  return (
    <ScheduleView
      template="events"
      sessions={sessions ?? []}
      weekStart={weekStart}
      onWeekChange={setWeekStart}
      month={month}
      onMonthChange={setMonth}
      printBranding={{ name: orgName, logoUrl }}
    />
  );
}
