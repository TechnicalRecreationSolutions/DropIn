"use client";

import { useState } from "react";
import { useTemplateSchedule } from "@/hooks/useScheduleRange";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import { useScheduleAnalytics } from "@/hooks/useScheduleAnalytics";
import ScheduleView from "@/components/schedule/ScheduleView";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface FacilityScheduleClientProps {
  orgId: string;
  facilityId: string;
  allowedTemplates: ScheduleTemplate[];
}

/**
 * Client boundary for the public facility schedule.
 * Wraps ScheduleView with week-navigation state and TanStack Query data.
 */
export default function FacilityScheduleClient({ orgId, facilityId, allowedTemplates }: FacilityScheduleClientProps) {
  const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
  const [view, setView] = useState<ScheduleTemplate>(allowedTemplates[0] ?? "grid");
  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: view,
    facilityId,
    weekStart,
    month,
  });

  // This page has no embed script fronting it — it fires its own
  // facility_view directly, unlike the widget iframe.
  useScheduleAnalytics({ viewEvent: "facility_view", orgId, facilityId, view });

  return (
    <div className="bg-white">
      <ScheduleHeaderBar
        title="Weekly Schedule"
        view={view}
        onChange={setView}
        allowedViews={allowedTemplates}
      />

      <div className="p-4 sm:p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
            Loading schedule…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 text-red-500 text-sm">
            Could not load schedule. Please try again.
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm font-medium">No drop-in sessions this week</p>
            <p className="text-xs mt-1">Try navigating to another week.</p>
          </div>
        ) : (
          <ScheduleView
            template={view}
            sessions={sessions ?? []}
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            month={month}
            onMonthChange={setMonth}
            facilityId={facilityId}
          />
        )}
      </div>
    </div>
  );
}
