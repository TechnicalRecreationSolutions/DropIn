"use client";

import { useState } from "react";
import { useWeeklySchedule } from "@/hooks/useWeeklySchedule";
import WeeklyScheduleGrid from "@/components/schedule/WeeklyScheduleGrid";
import { getWeekStart } from "@/lib/utils/dates";

interface FacilityScheduleClientProps {
  facilityId: string;
}

/**
 * Client boundary for the public facility schedule.
 * Wraps WeeklyScheduleGrid with week-navigation state and TanStack Query data.
 */
export default function FacilityScheduleClient({ facilityId }: FacilityScheduleClientProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const { data: sessions, isLoading, isError } = useWeeklySchedule({ facilityId, weekStart });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
        Loading schedule…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-16 text-red-500 text-sm">
        Could not load schedule. Please try again.
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-sm font-medium">No drop-in sessions this week</p>
        <p className="text-xs mt-1">Try navigating to another week.</p>
      </div>
    );
  }

  return (
    <WeeklyScheduleGrid
      sessions={sessions}
      weekStart={weekStart}
      onWeekChange={setWeekStart}
    />
  );
}
