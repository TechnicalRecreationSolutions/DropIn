"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTemplateSchedule } from "@/hooks/useScheduleRange";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import { useScheduleAnalytics } from "@/hooks/useScheduleAnalytics";
import ScheduleView from "@/components/schedule/ScheduleView";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import ScheduleScopeFilters from "@/components/schedule/ScheduleScopeFilters";
import {
  describeSelection,
  initialSelection,
  resolveSchedules,
  singleFacilityId,
  type ScopeLevel,
  type ScopeSchedule,
  type ScopeSelection,
} from "@/lib/schedule/scopeSelection";
import ScheduleFilterBar from "@/components/schedule/ScheduleFilterBar";
import PrintableSchedule, { PrintScheduleButton } from "@/components/schedule/PrintableSchedule";
import {
  EMPTY_FILTER_STATE,
  filterSessions,
  type SessionFilterKey,
  type SessionFilterState,
} from "@/lib/schedule/sessionFilters";
import type { ScheduleTemplate } from "@/types/schedule.types";

const queryClient = new QueryClient();

/** The org's first configured filter entry — where the switcher opens. */
export interface WidgetFirstScope {
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
  /** Every schedule the org's filter entries reach (page.tsx's buildScopeTree).
   *  Non-empty, it drives the data instead of the facilityId/departmentId props
   *  above; with two or more, visitors get the Facility / Department /
   *  Schedule switcher. */
  scopeTree?: ScopeSchedule[];
  /** Where the switcher opens — the first configured entry. Also the data
   *  scope when the entries reach no live schedule at all. */
  firstScope?: WidgetFirstScope;
  /** Switcher levels where visitors may tick several (migration 065). */
  multiSelectLevels?: ScopeLevel[];
  /** Heading in the coloured bar — the org's widget_configs.custom_title, or "Schedule". */
  title?: string;
  /** Which general filters the org offers visitors (widget_configs.enabled_filters). */
  enabledFilters?: SessionFilterKey[];
  /** Whether the filter section starts collapsed (widget_configs.filters_collapsed, migration 066). */
  filtersCollapsed?: boolean;
  /** Whether visitors get a Print button (widget_configs.allow_print, migration 051). */
  allowPrint?: boolean;
  /** Printed above the title — whose schedule this is, once it's off the website. */
  printSubtitle?: string | null;
}

function ScheduleInner({
  orgId,
  facilityId,
  departmentId,
  theme,
  allowedTemplates,
  scopeTree = [],
  firstScope,
  multiSelectLevels = [],
  title = "Schedule",
  enabledFilters = [],
  filtersCollapsed = false,
  allowPrint = false,
  printSubtitle,
}: WidgetScheduleClientProps) {
  const { weekStart, month, setWeekStart, setMonth } = useScheduleAnchor();
  const [view, setView] = useState<ScheduleTemplate>(allowedTemplates[0] ?? "grid");
  // The visitor's picks, resolved to the exact schedules they cover and asked
  // for by id — so a pick can never reach outside the region the org
  // configured (see lib/schedule/scopeSelection.ts). A lone schedule still
  // drives the data; it is only the switcher that needs two to mean anything.
  const switchable = scopeTree.length > 1;
  const [selection, setSelection] = useState(() => initialSelection(scopeTree, firstScope));
  const scheduleIds = useMemo(
    () => resolveSchedules(scopeTree, selection).map((s) => s.id).sort().join(","),
    [scopeTree, selection]
  );

  const treeDriven = scopeTree.length > 0;
  // Entries that reach no live schedule fall back to the first one's own
  // scope, which is what the embed did before there was a tree.
  const scopedFacilityId = treeDriven
    ? (singleFacilityId(scopeTree, selection) ?? undefined)
    : (firstScope?.facilityId ?? facilityId);

  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: view,
    orgId,
    facilityId: treeDriven ? undefined : scopedFacilityId,
    departmentId: treeDriven ? undefined : firstScope ? (firstScope.departmentId ?? undefined) : departmentId,
    scheduleGroupId: treeDriven ? scheduleIds : (firstScope?.scheduleGroupId ?? undefined),
    weekStart,
    month,
  });

  // The general filters (activity/day/time/…) narrow the week that's already
  // loaded, rather than re-querying: `sessions` is one week of expanded
  // occurrences, and the filter bar's own options are derived from it.
  const [filters, setFilters] = useState<SessionFilterState>(EMPTY_FILTER_STATE);

  // Filters are named after one schedule's activities and spaces; carried to
  // another they would match nothing and read as an empty week. Same as the
  // landing hero.
  function changeSelection(next: ScopeSelection) {
    setSelection(next);
    setFilters(EMPTY_FILTER_STATE);
  }
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

  const canPrint = allowPrint && !isLoading && !isError && visibleSessions.length > 0;

  return (
    <>
      {/* Not overflow-hidden: a filter's checkbox list opens below its button
          and may reach past the card. The header rounds its own top corners. */}
      <div className="rounded-xl border border-gray-200 print:hidden">
        <ScheduleHeaderBar
          title={title}
          view={view}
          onChange={setView}
          allowedViews={allowedTemplates}
          scopeControl={
            switchable ? (
              <ScheduleScopeFilters
                tree={scopeTree}
                selection={selection}
                onChange={changeSelection}
                multi={multiSelectLevels}
                dark={isDark}
              />
            ) : undefined
          }
          actions={canPrint ? <PrintScheduleButton onTint={isDark} /> : undefined}
          dark={isDark}
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
            defaultCollapsed={filtersCollapsed}
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
          // Tall enough for an open filter list to fit: the iframe is sized to
          // its content, so a short message here would crop the list.
          <div className={`text-center py-12 min-h-72 text-sm ${mutedClass}`}>
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
        ) : view === "floorplan" && !scopedFacilityId ? (
          // A floor map is one building's. With several ticked, ScheduleView
          // would quietly draw the grid instead, under a "Floorplan" toggle.
          <div className={`text-center py-12 text-sm ${mutedClass}`}>
            The floorplan shows one building at a time. Pick one facility above to see its map.
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
      {canPrint && (
        <PrintableSchedule
          title={title}
          subtitle={printSubtitle}
          weekStart={weekStart}
          sessions={visibleSessions}
          totalCount={allSessions.length}
          filters={filters}
          // The whole path, minus the "All …" levels: an entry's own label
          // can be just "All schedules", which says nothing on paper.
          scopeLabel={switchable ? describeSelection(scopeTree, selection) || null : null}
        />
      )}
    </>
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
