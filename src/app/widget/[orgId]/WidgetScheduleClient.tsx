"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWeeklySchedule } from "@/hooks/useWeeklySchedule";
import ScheduleView from "@/components/schedule/ScheduleView";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import { getWeekStart } from "@/lib/utils/dates";
import type { ScheduleTemplate } from "@/types/schedule.types";

const queryClient = new QueryClient();

interface WidgetScheduleClientProps {
  orgId: string;
  facilityId?: string;
  departmentId?: string;
  theme: "light" | "dark";
  allowedTemplates: ScheduleTemplate[];
}

function ScheduleInner({ orgId, facilityId, departmentId, theme, allowedTemplates }: WidgetScheduleClientProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [view, setView] = useState<ScheduleTemplate>(allowedTemplates[0] ?? "grid");
  const { data: sessions, isLoading, isError } = useWeeklySchedule({ orgId, facilityId, departmentId, weekStart });

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

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200">
      <ScheduleHeaderBar title="Schedule" view={view} onChange={setView} allowedViews={allowedTemplates} />

      {isLoading ? (
        <div className={`flex items-center justify-center py-12 text-sm ${mutedClass}`}>
          Loading schedule…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-12 text-sm text-red-400">
          Could not load schedule. Please try again.
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <div className={`text-center py-12 text-sm ${mutedClass}`}>
          No drop-in sessions scheduled this week.
        </div>
      ) : (
        <div className="p-3 sm:p-4">
          <ScheduleView
            template={view}
            sessions={sessions}
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            facilityId={facilityId}
          />
        </div>
      )}
    </div>
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
