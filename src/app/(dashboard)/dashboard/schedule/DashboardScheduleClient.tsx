"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import WeeklyScheduleGrid from "@/components/schedule/WeeklyScheduleGrid";
import { useWeeklySchedule } from "@/hooks/useWeeklySchedule";
import { getWeekStart } from "@/lib/utils/dates";
import type { ExpandedSession } from "@/types/schedule.types";

interface DashboardScheduleClientProps {
  orgId: string;
}

export default function DashboardScheduleClient({ orgId }: DashboardScheduleClientProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: sessions, isLoading, isError, refetch } = useWeeklySchedule({ orgId, weekStart });

  async function handleDeleteSession(session: ExpandedSession) {
    if (!confirm(`Remove all "${session.scheduleGroupName}" sessions? This cannot be undone.`)) return;

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
        <p className="font-medium text-sm">No sessions this week</p>
        <p className="text-xs mt-1">Navigate to another week or add a new session.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      {/* Delete-session controls shown above grid */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from(new Map(sessions.map((s) => [s.sessionId, s])).values()).map((session) => (
          <button
            key={session.sessionId}
            onClick={() => handleDeleteSession(session)}
            disabled={deletingId === session.sessionId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            {deletingId === session.sessionId ? "Removing…" : `Remove "${session.scheduleGroupName}"`}
          </button>
        ))}
      </div>

      <WeeklyScheduleGrid
        sessions={sessions}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
      />
    </div>
  );
}
