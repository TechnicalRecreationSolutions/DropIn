"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const queryClient = new QueryClient();

/** One entry in a multi-schedule widget's visitor-facing filter. */
export interface WidgetScope {
  id: string;
  label: string;
  facilityId: string;
  departmentId: string | null;
  scheduleGroupId: string | null;
  /** "Aquatic Centre › Aquatics › Lane Swim" — what the label alone can't say. */
  context?: string | null;
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
  /** Heading in the coloured bar — the org's widget_configs.custom_title, or "Schedule". */
  title?: string;
  /** Which general filters the org offers visitors (widget_configs.enabled_filters). */
  enabledFilters?: SessionFilterKey[];
}

function ScheduleInner({
  orgId,
  facilityId,
  departmentId,
  theme,
  allowedTemplates,
  scopes = [],
  title = "Schedule",
  enabledFilters = [],
}: WidgetScheduleClientProps) {
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

  // The general filters (activity/day/time/…) narrow the week that's already
  // loaded, rather than re-querying: `sessions` is one week of expanded
  // occurrences, and the filter bar's own options are derived from it.
  const [filters, setFilters] = useState<SessionFilterState>(EMPTY_FILTER_STATE);
  const allSessions = useMemo(() => sessions ?? [], [sessions]);
  const visibleSessions = useMemo(
    () => filterSessions(allSessions, filters),
    [allSessions, filters]
  );

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
  // Explicit grey, not a token: this renders inside the embed iframe, where the
  // dashboard's `.dark` class never exists, so a token would resolve to its
  // light value and put dark grey text on a dark-themed widget.
  const mutedClass = isDark ? "text-gray-400" : "text-gray-400";

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200">
      <ScheduleHeaderBar
        title={title}
        view={view}
        onChange={setView}
        allowedViews={allowedTemplates}
        scopeOptions={
          filterable
            ? scopes.map((s) => ({ id: s.id, label: s.label, context: s.context ?? undefined }))
            : undefined
        }
        activeScopeId={activeScope?.id}
        onScopeChange={setSelectedScopeId}
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
          dark={isDark}
        />
      )}

      {isLoading ? (
        <div className={`flex items-center justify-center py-12 text-sm ${mutedClass}`}>
          Loading schedule…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-12 text-sm text-red-400">
          Could not load schedule. Please try again.
        </div>
      ) : allSessions.length === 0 ? (
        <div className={`text-center py-12 text-sm ${mutedClass}`}>
          No drop-in sessions scheduled this week.
        </div>
      ) : visibleSessions.length === 0 ? (
        // Distinct from the empty week above: the week has sessions, the
        // filters just hid all of them, and saying so is the difference
        // between "nothing here" and "you filtered it out".
        <div className={`text-center py-12 text-sm ${mutedClass}`}>
          <p>No sessions match your filters this week.</p>
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
        // A landmark around the schedule itself, so a screen reader can jump
        // past the header and filters to the sessions.
        <div className="p-3 sm:p-4" role="region" aria-label="Schedule">
          <ScheduleView
            template={view}
            sessions={visibleSessions}
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
