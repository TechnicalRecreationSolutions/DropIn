"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWeeklySchedule } from "@/hooks/useWeeklySchedule";
import WeeklyScheduleGrid from "@/components/schedule/WeeklyScheduleGrid";
import { getWeekStart } from "@/lib/utils/dates";

const queryClient = new QueryClient();

interface WidgetScheduleClientProps {
  orgId: string;
  facilityId?: string;
  theme: "light" | "dark";
}

function ScheduleInner({ orgId, facilityId, theme }: WidgetScheduleClientProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const { data: sessions, isLoading, isError } = useWeeklySchedule({ orgId, facilityId, weekStart });

  // Notify parent frame of height changes for auto-resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      window.parent.postMessage(
        { type: "dropin:resize", height: document.documentElement.scrollHeight },
        "*"
      );
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const isDark = theme === "dark";
  const mutedClass = isDark ? "text-gray-400" : "text-gray-400";

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-12 text-sm ${mutedClass}`}>
        Loading schedule…
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`flex items-center justify-center py-12 text-sm text-red-400`}>
        Could not load schedule. Please try again.
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className={`text-center py-12 text-sm ${mutedClass}`}>
        No drop-in sessions scheduled this week.
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

/**
 * Widget client boundary — wraps its own QueryClientProvider so the
 * widget page is fully self-contained (no parent Providers needed).
 */
export default function WidgetScheduleClient(props: WidgetScheduleClientProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ScheduleInner {...props} />
    </QueryClientProvider>
  );
}
