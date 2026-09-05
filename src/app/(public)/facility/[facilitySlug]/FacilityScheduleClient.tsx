"use client";

import { useMemo, useState } from "react";
import { useTemplateSchedule } from "@/hooks/useScheduleRange";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import { useScheduleAnalytics } from "@/hooks/useScheduleAnalytics";
import ScheduleView from "@/components/schedule/ScheduleView";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import ScheduleFilterBar from "@/components/schedule/ScheduleFilterBar";
import {
  EMPTY_FILTER_STATE,
  filterSessions,
  type SessionFilterKey,
  type SessionFilterState,
} from "@/lib/schedule/sessionFilters";
import type { ScheduleTemplate } from "@/types/schedule.types";

interface FacilityScheduleClientProps {
  orgId: string;
  facilityId: string;
  allowedTemplates: ScheduleTemplate[];
  /** Same `widget_configs.enabled_filters` the embed uses — one setting, both surfaces. */
  enabledFilters: SessionFilterKey[];
}

/**
 * Client boundary for the public facility schedule.
 * Wraps ScheduleView with week-navigation state and TanStack Query data.
 */
export default function FacilityScheduleClient({
  orgId,
  facilityId,
  allowedTemplates,
  enabledFilters,
}: FacilityScheduleClientProps) {
  const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
  const [view, setView] = useState<ScheduleTemplate>(allowedTemplates[0] ?? "grid");
  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: view,
    facilityId,
    weekStart,
    month,
  });

  const [filters, setFilters] = useState<SessionFilterState>(EMPTY_FILTER_STATE);
  const allSessions = useMemo(() => sessions ?? [], [sessions]);
  const visibleSessions = useMemo(() => filterSessions(allSessions, filters), [allSessions, filters]);

  // This page has no embed script fronting it — it fires its own
  // facility_view directly, unlike the widget iframe.
  useScheduleAnalytics({ viewEvent: "facility_view", orgId, facilityId, view });

  return (
    <div className="bg-card">
      <ScheduleHeaderBar
        title="Weekly Schedule"
        view={view}
        onChange={setView}
        allowedViews={allowedTemplates}
      />

      {!isLoading && !isError && allSessions.length > 0 && enabledFilters.length > 0 && (
        <ScheduleFilterBar
          sessions={allSessions}
          matchCount={visibleSessions.length}
          enabled={enabledFilters}
          state={filters}
          onChange={setFilters}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
        />
      )}

      <div className="p-4 sm:p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground/70 text-sm">
            Loading schedule…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 text-red-500 text-sm">
            Could not load schedule. Please try again.
          </div>
        ) : allSessions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground/70">
            <p className="text-sm font-medium">No drop-in sessions this week</p>
            <p className="text-xs mt-1">Try navigating to another week.</p>
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground/70">
            <p className="text-sm font-medium">No sessions match your filters this week</p>
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTER_STATE)}
              className="mt-2 text-xs font-medium underline underline-offset-2"
              style={{ color: "var(--org-primary, #0066CC)" }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ScheduleView
            template={view}
            sessions={visibleSessions}
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
