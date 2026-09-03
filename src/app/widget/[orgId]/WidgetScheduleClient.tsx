"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTemplateSchedule } from "@/hooks/useScheduleRange";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import { useScheduleAnalytics } from "@/hooks/useScheduleAnalytics";
import ScheduleView from "@/components/schedule/ScheduleView";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import type { ScheduleTemplate } from "@/types/schedule.types";

const queryClient = new QueryClient();

/** One entry in a multi-schedule widget's visitor-facing filter. */
export interface WidgetScope {
  id: string;
  label: string;
  facilityId: string;
  departmentId: string | null;
  scheduleGroupId: string | null;
}

interface WidgetScheduleClientProps {
  orgId: string;
  facilityId?: string;
  departmentId?: string;
  theme: "light" | "dark";
  allowedTemplates: ScheduleTemplate[];
  /** When 2+ entries, the widget shows a facility/department/schedule filter and this list
   *  drives the data scope instead of the fixed facilityId/departmentId props above. */
  scopes?: WidgetScope[];
}

function ScheduleInner({ orgId, facilityId, departmentId, theme, allowedTemplates, scopes = [] }: WidgetScheduleClientProps) {
  const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
  const [view, setView] = useState<ScheduleTemplate>(allowedTemplates[0] ?? "grid");
  // A lone configured scope still has to drive the data — it's only the
  // *picker UI* that needs 2+ options to mean anything. Falling back to the
  // plain facilityId/departmentId props whenever there's exactly one scope
  // would silently un-scope the embed instead of applying the org's one
  // configured filter.
  const filterable = scopes.length > 1;
  const [selectedScopeId, setSelectedScopeId] = useState<string>(scopes[0]?.id ?? "");
  const activeScope = scopes.length > 0 ? (scopes.find((s) => s.id === selectedScopeId) ?? scopes[0]) : undefined;

  const scopedFacilityId = activeScope ? activeScope.facilityId : facilityId;
  const scopedDepartmentId = activeScope ? (activeScope.departmentId ?? undefined) : departmentId;
  const scopedScheduleGroupId = activeScope?.scheduleGroupId ?? undefined;

  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: view,
    orgId,
    facilityId: scopedFacilityId,
    departmentId: scopedDepartmentId,
    scheduleGroupId: scopedScheduleGroupId,
    weekStart,
    month,
  });

  // viewEvent is null here — widget.js already fires widget_view once per
  // embed load from the parent page; this hook only needs to report
  // template switches and time-on-widget, not a second initial view.
  useScheduleAnalytics({ viewEvent: null, orgId, facilityId: scopedFacilityId, view });

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
  const mutedClass = isDark ? "text-muted-foreground/70" : "text-muted-foreground/70";

  return (
    <div className="rounded-xl overflow-hidden border border-border">
      <ScheduleHeaderBar
        title={activeScope?.label ?? "Schedule"}
        view={view}
        onChange={setView}
        allowedViews={allowedTemplates}
        scopeOptions={filterable ? scopes.map((s) => ({ id: s.id, label: s.label })) : undefined}
        activeScopeId={activeScope?.id}
        onScopeChange={setSelectedScopeId}
      />

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
            sessions={sessions ?? []}
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            month={month}
            onMonthChange={setMonth}
            facilityId={scopedFacilityId}
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
