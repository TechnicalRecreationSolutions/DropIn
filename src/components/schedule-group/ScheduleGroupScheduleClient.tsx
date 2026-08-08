"use client";

import { useState } from "react";
import WeeklyScheduleGrid from "@/components/schedule/WeeklyScheduleGrid";
import { useWeeklySchedule } from "@/hooks/useScheduleRange";
import { getWeekStart } from "@/lib/utils/dates";
import type { ExpandedSession } from "@/types/schedule.types";

interface ScheduleGroupScheduleClientProps {
  scheduleGroupId: string;
}

/**
 * Scoped weekly grid for a single schedule group — this is the "how this
 * shows on the widget" preview for staff building a schedule from scratch,
 * reusing the same grid/data pipeline the public widget renders from.
 */
export default function ScheduleGroupScheduleClient({ scheduleGroupId }: ScheduleGroupScheduleClientProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: sessions, isLoading, isError, refetch } = useWeeklySchedule({ scheduleGroupId, weekStart });

  async function handleDeleteSession(session: ExpandedSession) {
    const label = session.templateName ?? session.scheduleGroupName;
    if (!confirm(`Remove the recurring "${label}" session? This cannot be undone.`)) return;

    setDeletingId(session.sessionId);
    await fetch(`/api/sessions?sessionId=${session.sessionId}`, { method: "DELETE" });
    setDeletingId(null);
    refetch();
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 flex items-center justify-center text-gray-400 text-sm">
        Loading schedule…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-red-500 text-sm">
        Could not load schedule. Please refresh.
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        <p className="font-medium text-sm">No sessions yet</p>
        <p className="text-xs mt-1">Use &quot;Add data&quot; above to define recurring times.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <p className="text-xs text-gray-400 mb-3">Tap a session to view details or remove its recurring series.</p>

      <WeeklyScheduleGrid
        sessions={sessions}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        onDeleteSession={handleDeleteSession}
        deletingSessionId={deletingId}
      />
    </div>
  );
}
