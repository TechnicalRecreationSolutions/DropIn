"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ExternalLink, Info } from "lucide-react";
import type { ExpandedSession, ScheduleTemplate } from "@/types/schedule.types";
import { useWeeklySchedule } from "@/hooks/useWeeklySchedule";
import { getWeekStart, localDateString } from "@/lib/utils/dates";
import { buildRRuleString } from "@/lib/rrule/validate";
import { DEFAULT_APP_TIMEZONE, zonedTimeToUtc } from "@/lib/utils/timezone";
import { DAYS, timeStringToMinutes, minutesToTimeString } from "@/lib/schedule/weekGeometry";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import ScheduleView from "@/components/schedule/ScheduleView";
import {
  ScheduleEditingProvider,
  type AddSessionTarget,
  type EditorTemplate,
  type RescheduleRequest,
  type ScheduleEditingApi,
} from "@/components/schedule/editing/ScheduleEditingContext";
import ScheduleDndProvider from "@/components/schedule/editing/ScheduleDndProvider";
import TemplateRail from "@/components/schedule/editing/TemplateRail";
import CreateSessionDialog, {
  type CreateSessionValues,
} from "@/components/schedule/editing/CreateSessionDialog";
import DuplicateSessionDialog from "@/components/schedule/editing/DuplicateSessionDialog";
import RescheduleConfirmDialog, {
  type RescheduleTarget,
} from "@/components/schedule/editing/RescheduleConfirmDialog";
import DeleteSessionDialog from "@/components/schedule/editing/DeleteSessionDialog";
import MapEditorClient from "@/components/facility-maps/MapEditorClient";
import WidgetConfigurator from "@/components/widget/WidgetConfigurator";
import { NO_DEPARTMENT, isWorkspaceTab, type WorkspaceTab } from "@/lib/schedule/commandCentreHref";
import FacilityBoxes from "./FacilityBoxes";
import ScopePicker from "./ScopePicker";
import SpacesPanel from "./SpacesPanel";
import WorkspaceTabs from "./WorkspaceTabs";
import type { CommandFacility } from "./types";

interface ScheduleCommandCentreProps {
  orgId: string;
  orgSlug: string;
  orgPrimaryColor: string;
  /** Views the org has switched on for its widget/public page — the rest are still editable here, just flagged as off. */
  widgetTemplates: ScheduleTemplate[];
  facilities: CommandFacility[];
  initialFacilityId: string | null;
  /** A real department id, NO_DEPARTMENT, or null. */
  initialDepartmentId: string | null;
  initialScheduleGroupId: string | null;
  initialTab: WorkspaceTab;
}

const ALL_VIEWS: ScheduleTemplate[] = ["grid", "list", "map", "floorplan"];

/**
 * The schedule command centre — the one place a schedule is viewed and
 * built. It replaces the old two-step "open the schedule group, then open
 * its builder" flow: building, schedule, view, and week are all state on
 * this single page, so switching any of them is instant and nothing is
 * hidden behind another route.
 *
 * Crucially the editor is not a look-alike of the widget — it *is* the
 * widget. The same `ScheduleView` the public embed renders is mounted here
 * inside a `ScheduleEditingProvider`, which is what makes the "+" buttons,
 * action menus, and Map drag-and-drop appear. Whatever staff see while
 * editing is, by construction, what visitors will see.
 *
 * Every mutation goes through the same `/api/sessions` endpoints the old
 * builder used and then invalidates the shared `weekly-schedule` query, so
 * all four views reflect a change immediately without refetching per view.
 */
export default function ScheduleCommandCentre({
  orgId,
  orgSlug,
  orgPrimaryColor,
  widgetTemplates,
  facilities,
  initialFacilityId,
  initialDepartmentId,
  initialScheduleGroupId,
  initialTab,
}: ScheduleCommandCentreProps) {
  const queryClient = useQueryClient();

  const [facilityId, setFacilityId] = useState<string | null>(
    () => initialFacilityId ?? facilities[0]?.id ?? null
  );
  const [departmentId, setDepartmentId] = useState<string | null>(initialDepartmentId);
  const [scheduleGroupId, setScheduleGroupId] = useState<string | null>(initialScheduleGroupId);
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [view, setView] = useState<ScheduleTemplate>(widgetTemplates[0] ?? "grid");
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));

  const [createTarget, setCreateTarget] = useState<AddSessionTarget | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [duplicating, setDuplicating] = useState<ExpandedSession | null>(null);
  const [duplicateSubmitting, setDuplicateSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [pendingReschedule, setPendingReschedule] = useState<
    { display: RescheduleTarget; dayCode: string; durationMinutes: number } | null
  >(null);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<ExpandedSession | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const facility = useMemo(
    () => facilities.find((f) => f.id === facilityId) ?? null,
    [facilities, facilityId]
  );
  const scheduleGroup = useMemo(
    () => facility?.scheduleGroups.find((g) => g.id === scheduleGroupId) ?? null,
    [facility, scheduleGroupId]
  );

  // Schedules offered by the schedule tier, narrowed by the department tier.
  const visibleSchedules = useMemo(() => {
    const all = facility?.scheduleGroups ?? [];
    if (departmentId === null) return all;
    if (departmentId === NO_DEPARTMENT) return all.filter((g) => !g.departmentId);
    return all.filter((g) => g.departmentId === departmentId);
  }, [facility, departmentId]);

  // Scope changes two ways, and both have to work.
  //
  // From a chip on this page: local state, mirrored into the URL with
  // replaceState so the state is linkable without a navigation that would
  // cost a round trip.
  //
  // From a link elsewhere pointing at this same route — the sidebar, a
  // breadcrumb, "Open schedule": that's a client-side navigation which does
  // *not* remount this component, so the incoming params have to be adopted
  // explicitly. Without this the sidebar appears to do nothing and the
  // mirror below immediately rewrites the URL back to the old scope.
  //
  // The ref tracks whichever scope was last reconciled, so the two effects
  // don't fight each other.
  const searchParams = useSearchParams();
  const urlScope = [
    searchParams.get("facility"),
    searchParams.get("department"),
    searchParams.get("schedule"),
    searchParams.get("tab"),
  ].join("|");
  const appliedScopeRef = useRef(urlScope);

  useEffect(() => {
    if (urlScope === appliedScopeRef.current) return;
    appliedScopeRef.current = urlScope;

    const [nextFacility, nextDepartment, nextSchedule, nextTab] = urlScope.split("|");
    // Validated the same way the server does, so a hand-edited or stale URL
    // can't put the editor into a scope this org doesn't have.
    const target = facilities.find((f) => f.id === nextFacility) ?? null;
    const departmentValid =
      !!target &&
      target.departments.length > 0 &&
      (nextDepartment === NO_DEPARTMENT ||
        target.departments.some((d) => d.id === nextDepartment));

    setFacilityId(target?.id ?? facilities[0]?.id ?? null);
    setDepartmentId(departmentValid ? nextDepartment : null);
    setScheduleGroupId(
      target?.scheduleGroups.some((g) => g.id === nextSchedule) ? nextSchedule : null
    );
    setTab(isWorkspaceTab(nextTab) ? nextTab : "schedule");
  }, [urlScope, facilities]);

  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of [
      ["facility", facilityId],
      ["department", departmentId],
      ["schedule", scheduleGroupId],
      // Schedule is the default, so it stays out of the URL.
      ["tab", tab === "schedule" ? null : tab],
    ] as const) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url.toString());
    appliedScopeRef.current = [
      facilityId,
      departmentId,
      scheduleGroupId,
      tab === "schedule" ? null : tab,
    ].join("|");
  }, [facilityId, departmentId, scheduleGroupId, tab]);

  // Narrowest scope wins. "No department" has no id to filter on server-side,
  // so it fetches the facility and drops the departmented sessions here.
  const isUndepartmented = departmentId === NO_DEPARTMENT;
  const { data: fetched, isLoading, isError } = useWeeklySchedule({
    facilityId: facilityId ?? undefined,
    departmentId: isUndepartmented ? undefined : (departmentId ?? undefined),
    scheduleGroupId: scheduleGroupId ?? undefined,
    weekStart,
  });

  const sessions = useMemo(
    () =>
      isUndepartmented && !scheduleGroupId
        ? (fetched ?? []).filter((s) => s.departmentId === null)
        : fetched,
    [fetched, isUndepartmented, scheduleGroupId]
  );

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
  }

  function handleFacilitySelect(nextFacilityId: string) {
    setFacilityId(nextFacilityId);
    // Departments and schedules each belong to exactly one facility, so
    // neither pick can survive the switch.
    setDepartmentId(null);
    setScheduleGroupId(null);
  }

  function handleDepartmentSelect(nextDepartmentId: string | null) {
    setDepartmentId(nextDepartmentId);
    // Keep the schedule only if it still lives under the new filter,
    // rather than silently editing something the tiers no longer show.
    const stillVisible =
      nextDepartmentId === null ||
      (nextDepartmentId === NO_DEPARTMENT
        ? !scheduleGroup?.departmentId
        : scheduleGroup?.departmentId === nextDepartmentId);
    if (!stillVisible) setScheduleGroupId(null);
  }

  function handleScheduleSelect(nextScheduleGroupId: string | null) {
    setScheduleGroupId(nextScheduleGroupId);
    // Move the department tier to wherever the schedule actually lives, so
    // the chips always read as a true path to it. Skipped where the facility
    // has no departments and the tier isn't rendered at all.
    const next = facility?.scheduleGroups.find((g) => g.id === nextScheduleGroupId);
    if (next && facility && facility.departments.length > 0) {
      setDepartmentId(next.departmentId ?? NO_DEPARTMENT);
    }
  }

  // A continuous schedule is always-open hours rather than placed sessions,
  // so there is nothing to build into it from here.
  const isContinuous = scheduleGroup?.scheduleType === "continuous";
  const canCreate = !!scheduleGroup && !isContinuous;

  const handleAddSession = useCallback((target: AddSessionTarget) => {
    setCreateError(null);
    setCreateTarget(target);
  }, []);

  const handleReschedule = useCallback(({ session, dayCode, dayLabel, startTime }: RescheduleRequest) => {
    const durationMinutes = (session.end.getTime() - session.start.getTime()) / 60000;
    const endMinutes = timeStringToMinutes(startTime) + durationMinutes;
    setRescheduleError(null);
    setPendingReschedule({
      display: {
        sessionId: session.sessionId,
        templateName: session.templateName,
        scheduleGroupName: session.scheduleGroupName,
        newDayLabel: dayLabel,
        newStartTime: startTime,
        crossesMidnight: endMinutes >= 24 * 60,
      },
      dayCode,
      durationMinutes,
    });
  }, []);

  const editing: ScheduleEditingApi = useMemo(
    () => ({
      templates: scheduleGroup?.templates ?? [],
      spaces: facility?.spaces ?? [],
      canCreate,
      onAddSession: handleAddSession,
      onDuplicate: (session) => {
        setDuplicateError(null);
        setDuplicating(session);
      },
      onReschedule: handleReschedule,
      onDelete: (session) => {
        setDeleteError(null);
        setDeleting(session);
      },
      deletingSessionId: deletingId,
    }),
    [scheduleGroup, facility, canCreate, deletingId, handleAddSession, handleReschedule]
  );

  async function handleConfirmCreate(values: CreateSessionValues) {
    if (!scheduleGroup || values.dayCodes.length === 0 || !values.templateId) return;
    setCreateSubmitting(true);
    setCreateError(null);

    const dtstart = zonedTimeToUtc(values.validFrom, values.startTime, DEFAULT_APP_TIMEZONE).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroup.id,
        template_id: values.templateId,
        rrule: buildRRuleString({ frequency: "weekly", days: values.dayCodes }),
        dtstart,
        dtend_time: values.endTime,
        valid_from: values.validFrom,
        valid_until: values.validUntil,
        space_ids: values.spaceIds,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCreateError(data.error ?? "Could not place this session.");
      setCreateSubmitting(false);
      return;
    }

    setCreateSubmitting(false);
    setCreateTarget(null);
    refresh();
  }

  async function handleConfirmDuplicate(spaceIds: string[], dayCodes: string[]) {
    if (!duplicating || dayCodes.length === 0) return;
    setDuplicateSubmitting(true);
    setDuplicateError(null);

    const startTime = timeOfDay(duplicating.start);
    const endTime = timeOfDay(duplicating.end);
    const validFrom = localDateString();
    const dtstart = zonedTimeToUtc(validFrom, startTime, DEFAULT_APP_TIMEZONE).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Duplicating always stays inside the session's own schedule, which
        // may differ from the current pick when the whole facility is shown.
        schedule_group_id: duplicating.scheduleGroupId,
        template_id: duplicating.templateId,
        rrule: buildRRuleString({ frequency: "weekly", days: dayCodes }),
        dtstart,
        dtend_time: endTime,
        valid_from: validFrom,
        space_ids: spaceIds,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDuplicateError(data.error ?? "Could not duplicate this session.");
      setDuplicateSubmitting(false);
      return;
    }

    setDuplicateSubmitting(false);
    setDuplicating(null);
    refresh();
  }

  async function handleConfirmReschedule() {
    if (!pendingReschedule) return;
    setRescheduleSubmitting(true);
    setRescheduleError(null);

    const { display, dayCode, durationMinutes } = pendingReschedule;
    const endMinutes = timeStringToMinutes(display.newStartTime) + durationMinutes;
    const dtendTime = minutesToTimeString(endMinutes % (24 * 60));

    const validFrom = localDateString();
    const dtstart = zonedTimeToUtc(validFrom, display.newStartTime, DEFAULT_APP_TIMEZONE).toISOString();

    const res = await fetch(`/api/sessions/${display.sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rrule: buildRRuleString({ frequency: "weekly", days: [dayCode] }),
        dtstart,
        dtend_time: dtendTime,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRescheduleError(data.error ?? "Could not move this session.");
      setRescheduleSubmitting(false);
      return;
    }

    setRescheduleSubmitting(false);
    setPendingReschedule(null);
    refresh();
  }

  async function handleConfirmDelete() {
    if (!deleting) return;
    setDeletingId(deleting.sessionId);
    setDeleteError(null);

    const res = await fetch(`/api/sessions?sessionId=${deleting.sessionId}`, { method: "DELETE" });

    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? "Could not remove this session.");
      return;
    }

    setDeleting(null);
    refresh();
  }

  function handleTemplateClick(template: EditorTemplate) {
    // Views without a time axis have no drop position, so a clicked
    // template opens the dialog on the day already in focus.
    const today = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
    handleAddSession({ dayCode: today.code, dayLabel: today.label, template });
  }

  if (facilities.length === 0) return null;

  // Floorplan needs a single facility with a published map behind it.
  const availableViews = ALL_VIEWS.filter(
    (v) => v !== "floorplan" || !!facility?.hasPublishedMap
  );
  const activeView = availableViews.includes(view) ? view : availableViews[0];
  const viewIsOffInWidget = !widgetTemplates.includes(activeView);
  // Map is the only view with a position to drop onto, and there's nothing
  // to drag until the scope narrows to one schedule with templates in it.
  const dragEnabled = activeView === "map" && canCreate && editing.templates.length > 0;

  // The header names the narrowest scope in view, so the panel always says
  // what it's actually showing.
  const departmentLabel =
    departmentId === NO_DEPARTMENT
      ? "No department"
      : (facility?.departments.find((d) => d.id === departmentId)?.name ?? null);
  const headerTitle =
    scheduleGroup?.name ?? departmentLabel ?? facility?.name ?? "Schedule";

  // NO_DEPARTMENT is a filter, not a row — anything that needs a real
  // department id (widget config, space creation) has to reject it.
  const realDepartmentId =
    departmentId && departmentId !== NO_DEPARTMENT ? departmentId : null;

  // "Settings" always edits the narrowest real thing in scope, so one
  // control covers what used to be three pages' worth of edit buttons.
  const scopeSettingsHref = scheduleGroup
    ? scheduleGroup.settingsHref
    : realDepartmentId && facility
      ? `/dashboard/facilities/${facility.id}/departments/${realDepartmentId}/edit`
      : facility
        ? `/dashboard/facilities/${facility.id}/edit`
        : null;
  const scopeSettingsLabel = scheduleGroup
    ? scheduleGroup.name
    : (departmentLabel ?? facility?.name ?? "");

  return (
    <OrgThemeProvider primaryColor={orgPrimaryColor} className="space-y-5">
      <FacilityBoxes
        facilities={facilities}
        selectedFacilityId={facilityId}
        onSelect={handleFacilitySelect}
      />

      {facility && (
        <ScopePicker
          facility={facility}
          departmentId={departmentId}
          selectedSchedule={scheduleGroup}
          visibleSchedules={visibleSchedules}
          onDepartmentChange={handleDepartmentSelect}
          onScheduleChange={handleScheduleSelect}
          settingsHref={scopeSettingsHref}
          settingsLabel={scopeSettingsLabel}
        />
      )}

      {facility && (
        <WorkspaceTabs
          tab={tab}
          onChange={setTab}
          scopeLabel={departmentLabel ?? facility.name}
          facilityName={facility.name}
        />
      )}

      {facility && tab === "spaces" && (
        <SpacesPanel
          facility={facility}
          departmentId={departmentId}
          departmentLabel={departmentLabel}
        />
      )}

      {facility && tab === "map" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            The floorplan visitors see for {facility.name}. Drawn per building, so it ignores the
            department filter above.
          </p>
          {/* Keyed on the facility so switching buildings rebuilds the editor
              rather than leaving the previous building's shapes on canvas. */}
          <MapEditorClient
            key={facility.id}
            facilityId={facility.id}
            spaces={facility.spaces.map((s) => ({ id: s.id, name: s.name }))}
          />
        </div>
      )}

      {facility && tab === "widget" && (
        <WidgetConfigurator
          key={`${facility.id}:${realDepartmentId ?? ""}`}
          orgId={orgId}
          orgSlug={orgSlug}
          facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
          lockedFacilityId={facility.id}
          lockedDepartmentId={realDepartmentId ?? undefined}
        />
      )}

      {/* Hidden rather than unmounted: flipping to Spaces to add Lane 7 and
          back must not lose the week you were on, the layout you were in, or
          refetch the schedule. The other tabs unmount freely — they hold no
          state worth preserving. */}
      <div className={tab === "schedule" ? undefined : "hidden"}>
      <ScheduleDndProvider editing={dragEnabled ? editing : null}>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
        <div className="order-2 lg:order-1 space-y-3">
          <TemplateRail
            templates={editing.templates}
            manageTemplatesHref={scheduleGroup?.manageTemplatesHref ?? null}
            draggable={dragEnabled}
            onTemplateClick={canCreate && !dragEnabled ? handleTemplateClick : undefined}
          />

          {!scheduleGroup && facility && (
            <p className="text-xs text-gray-500 px-1">
              {departmentLabel ?? facility.name} has {visibleSchedules.length}{" "}
              {visibleSchedules.length === 1 ? "schedule" : "schedules"}, all shown together.{" "}
              {visibleSchedules.length > 0 &&
                `Pick ${visibleSchedules.length === 1 ? "it" : "one"} above to start placing sessions.`}
            </p>
          )}

          {isContinuous && (
            <p className="text-xs text-gray-500 px-1">
              This schedule is set up as always-open, so it has no placed sessions. Change its hours
              from <Link href={scheduleGroup.settingsHref} className="text-blue-600 hover:text-blue-700">its settings</Link>.
            </p>
          )}
        </div>

        <div className="order-1 lg:order-2 rounded-xl border border-gray-200 overflow-hidden bg-white">
          <ScheduleHeaderBar
            title={headerTitle}
            view={activeView}
            onChange={setView}
            allowedViews={availableViews}
          />

          {viewIsOffInWidget && (
            <p className="flex items-center gap-2 px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">
                Visitors can&rsquo;t switch to this layout — it&rsquo;s off for your widget.
              </span>
              <Link
                href="/dashboard/widget"
                className="font-medium underline underline-offset-2 shrink-0 inline-flex items-center gap-1"
              >
                Turn on <ExternalLink className="w-3 h-3" />
              </Link>
            </p>
          )}

          <div className="p-3 sm:p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                Loading schedule…
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-16 text-sm text-red-500">
                Could not load this schedule. Please refresh.
              </div>
            ) : (
              <ScheduleEditingProvider value={editing}>
                <ScheduleView
                  template={activeView}
                  sessions={sessions ?? []}
                  weekStart={weekStart}
                  onWeekChange={setWeekStart}
                  facilityId={facilityId ?? undefined}
                />
              </ScheduleEditingProvider>
            )}
          </div>

          {canCreate && (
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60">
              <button
                type="button"
                onClick={() =>
                  handleAddSession({ dayCode: DAYS[0].code, dayLabel: DAYS[0].label })
                }
                disabled={editing.templates.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CalendarPlus className="w-4 h-4" />
                Add a session to {scheduleGroup.name}
              </button>
            </div>
          )}
        </div>
      </div>
      </ScheduleDndProvider>
      </div>

      <CreateSessionDialog
        target={createTarget}
        templates={editing.templates}
        spaces={editing.spaces}
        onCancel={() => {
          setCreateTarget(null);
          setCreateError(null);
        }}
        onConfirm={handleConfirmCreate}
        submitting={createSubmitting}
        error={createError}
      />

      <DuplicateSessionDialog
        open={!!duplicating}
        session={duplicating}
        spaces={editing.spaces}
        onCancel={() => {
          setDuplicating(null);
          setDuplicateError(null);
        }}
        onConfirm={handleConfirmDuplicate}
        submitting={duplicateSubmitting}
        error={duplicateError}
      />

      <RescheduleConfirmDialog
        open={!!pendingReschedule}
        target={pendingReschedule?.display ?? null}
        onCancel={() => {
          setPendingReschedule(null);
          setRescheduleError(null);
        }}
        onConfirm={handleConfirmReschedule}
        submitting={rescheduleSubmitting}
        error={rescheduleError}
      />

      <DeleteSessionDialog
        session={deleting}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
        submitting={!!deletingId}
        error={deleteError}
      />
    </OrgThemeProvider>
  );
}

function timeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
