"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus, Eye, ExternalLink, Info, Printer } from "lucide-react";
import type { ExpandedSession, ScheduleTemplate } from "@/types/schedule.types";
import {
  useTemplateSchedule,
  SCHEDULE_RANGE_KEY,
  type ScheduleAudience,
} from "@/hooks/useScheduleRange";
import { useScheduleAnchor } from "@/hooks/useScheduleAnchor";
import { localDateString, parseDate, getWeekStart, sessionTimeString } from "@/lib/utils/dates";
import { buildRRuleString } from "@/lib/rrule/validate";
import { DAYS, timeStringToMinutes, minutesToTimeString, sessionDayIndex } from "@/lib/schedule/weekGeometry";
import { NO_DEPARTMENT, commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { deriveScheduleStatus } from "@/lib/schedule/scheduleStatus";
import { getSportCategory } from "@/lib/utils/sport-categories";
import { RESERVED_PUBLIC_LABEL } from "@/lib/sessions/occupancy";
import ScheduleListSection, { type ScheduleListRow } from "@/components/schedule-list/ScheduleListSection";
import OrgThemeProvider from "@/components/schedule/OrgThemeProvider";
import ScheduleHeaderBar from "@/components/schedule/ScheduleHeaderBar";
import AudienceToggle from "./AudienceToggle";
import StaffClaimsPanel from "./StaffClaimsPanel";
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
import AddAnotherTimeDialog, {
  type AddAnotherTimeValues,
} from "@/components/schedule/editing/AddAnotherTimeDialog";
import RescheduleConfirmDialog, {
  type RescheduleTarget,
} from "@/components/schedule/editing/RescheduleConfirmDialog";
import DeleteSessionDialog from "@/components/schedule/editing/DeleteSessionDialog";
import OverrideWeekDialog, {
  type OverrideWeekValues,
} from "@/components/schedule/editing/OverrideWeekDialog";
import WeekListPanel from "./WeekListPanel";
import WeekReviewBar from "./WeekReviewBar";
import type { CommandFacility } from "./types";

interface ScheduleCommandCentreProps {
  orgId: string;
  orgPrimaryColor: string;
  /** Views the org has switched on for its widget/public page — the rest are still editable here, just flagged as off. */
  widgetTemplates: ScheduleTemplate[];
  facilities: CommandFacility[];
}

const ALL_VIEWS: ScheduleTemplate[] = ["grid", "list", "map", "board", "floorplan"];

/** Which audience this browser last looked at the schedule as (AudienceToggle). */
const AUDIENCE_KEY = "dropin:schedule:audience";

/**
 * The schedule command centre — the one place a schedule is viewed and
 * built. Building, department, and schedule scope are no longer state on
 * this page at all: they come entirely from the sidebar (`?facility=`,
 * `?department=`, `?schedule=`), read straight off the URL. This page only
 * still owns `week` — which week's editor is open, if any. Spaces, the
 * floorplan editor, and the widget configurator each moved to their own
 * dedicated routes (`/dashboard/spaces`, `/dashboard/map`,
 * `/dashboard/widget`) rather than living here as tabs.
 *
 * This page is week-first: once a schedule is selected, it lands on a list
 * of weeks (`WeekListPanel`) rather than a single continuous navigator.
 * Clicking a week opens that week in the same editor as before.
 *
 * Crucially the editor is not a look-alike of the widget — it *is* the
 * widget. The same `ScheduleView` the public embed renders is mounted here
 * inside a `ScheduleEditingProvider`, which is what makes the "+" buttons,
 * action menus, and Map drag-and-drop appear. Whatever staff see while
 * editing is, by construction, what visitors will see.
 *
 * Every mutation goes through the same `/api/sessions` endpoints the old
 * builder used and then invalidates the shared schedule-range query, so every
 * view reflects a change immediately without refetching per view.
 */
export default function ScheduleCommandCentre({
  orgId,
  orgPrimaryColor,
  widgetTemplates,
  facilities,
}: ScheduleCommandCentreProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  // Scope is derived straight from the URL on every render — it can only
  // change by navigating in from the sidebar (there's no picker on this page
  // anymore to change it locally), so there's nothing to keep in sync. This
  // replicates the same validation page.tsx does server-side: a stale or
  // hand-edited URL falls back rather than showing an empty editor.
  const facilityParam = searchParams.get("facility");
  const departmentParam = searchParams.get("department");
  const scheduleParam = searchParams.get("schedule");

  const facility = useMemo(
    () => facilities.find((f) => f.id === facilityParam) ?? facilities[0] ?? null,
    [facilities, facilityParam]
  );
  const scheduleGroup = useMemo(
    () => facility?.scheduleGroups.find((g) => g.id === scheduleParam) ?? null,
    [facility, scheduleParam]
  );

  // The schedule-management list shown once a building is picked but before
  // (or after clearing) a specific schedule — same rows/actions as the
  // Overview page's ScheduleListSection, just scoped to this facility's
  // department filter instead of the Overview's whole-facility view.
  const manageableSchedules = useMemo(() => {
    if (!facility) return [];
    if (!departmentParam) return facility.scheduleGroups;
    if (departmentParam === NO_DEPARTMENT) return facility.scheduleGroups.filter((g) => !g.departmentId);
    return facility.scheduleGroups.filter((g) => g.departmentId === departmentParam);
  }, [facility, departmentParam]);

  const today = localDateString();
  const scheduleListRows: ScheduleListRow[] = useMemo(
    () =>
      manageableSchedules.map((g) => {
        const sport = getSportCategory(g.sportCategory);
        return {
          id: g.id,
          name: g.name,
          typeLabel: sport?.label ?? g.sportCategory,
          typeIcon: sport?.icon ?? "🎯",
          departmentName: g.departmentName,
          startsOn: g.startsOn,
          endsOn: g.endsOn,
          sessionsCount: g.sessionsCount,
          scheduleStatus: deriveScheduleStatus(
            {
              status: g.status,
              startsOn: g.startsOn,
              endsOn: g.endsOn,
              updatedAt: g.updatedAt,
              publishedAt: g.publishedAt,
            },
            today
          ),
          editHref: commandCentreHref({
            facilityId: facility!.id,
            departmentId: g.departmentId ?? undefined,
            scheduleGroupId: g.id,
          }),
          previewHref: `/facility/${facility!.slug}`,
        };
      }),
    [manageableSchedules, facility, today]
  );

  const newScheduleHref =
    facility && departmentParam && departmentParam !== NO_DEPARTMENT
      ? `/dashboard/facilities/${facility.id}/departments/${departmentParam}/schedule-groups/new`
      : facility
        ? `/dashboard/facilities/${facility.id}/schedule-groups/new`
        : "/dashboard/facilities";

  // `week` is the only scope this page still owns locally — it switches
  // instantly (no navigation) and is mirrored into the URL so it's
  // linkable/refresh-safe, same reasoning the old facility/department/
  // schedule mirroring used.
  const [weekParam, setWeekParam] = useState<string | null>(searchParams.get("week"));
  const [view, setView] = useState<ScheduleTemplate>(widgetTemplates[0] ?? "grid");
  // Staff view ↔ Patron view (see AudienceToggle). Starts on "staff" to match
  // the server-rendered markup, since localStorage isn't readable there; the
  // effect below restores a remembered choice once, on the client — the same
  // shape SessionForm uses for its last-schedule memory.
  const [audience, setAudience] = useState<ScheduleAudience>("staff");
  // `weekParam` (URL-mirrored) is the one source of truth for which week is
  // open — this hook is only still needed for `month`, which every current
  // template ignores but ScheduleView's props still require (see its doc
  // comment). The editor's actual week is derived from `weekParam` below.
  const { month, setMonth } = useScheduleAnchor();
  const editorWeekStart = weekParam ? getWeekStart(parseDate(weekParam)) : getWeekStart(new Date());

  // The printable deck sheet (stage 4) is a *day*, and this page is week-shaped.
  // Opening it on today only makes sense while today is in the week on screen;
  // for any other week the first day of that week is the honest default.
  const deckSheetHref = useMemo(() => {
    if (!facility) return "/dashboard/schedule/deck";
    const today = new Date();
    const inThisWeek = getWeekStart(today).getTime() === editorWeekStart.getTime();
    const day = localDateString(inThisWeek ? today : editorWeekStart);
    return `/dashboard/schedule/deck?facility=${facility.id}&date=${day}`;
  }, [facility, editorWeekStart]);

  const [createTarget, setCreateTarget] = useState<AddSessionTarget | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [duplicating, setDuplicating] = useState<ExpandedSession | null>(null);
  const [duplicateSubmitting, setDuplicateSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [addingTime, setAddingTime] = useState<ExpandedSession | null>(null);
  const [addTimeSubmitting, setAddTimeSubmitting] = useState(false);
  const [addTimeError, setAddTimeError] = useState<string | null>(null);

  const [pendingReschedule, setPendingReschedule] = useState<
    { display: RescheduleTarget; dayCode: string; durationMinutes: number } | null
  >(null);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<ExpandedSession | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [overriding, setOverriding] = useState<ExpandedSession | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // `schedule` stays in the tracked key purely so switching schedules from
  // the sidebar resets `week` back to its URL default even when it doesn't
  // literally appear in the new URL (e.g. two schedules' bare "?schedule="
  // links look identical to `week` otherwise).
  const urlState = [scheduleParam, searchParams.get("week")].join("|");
  const appliedStateRef = useRef(urlState);

  useEffect(() => {
    if (urlState === appliedStateRef.current) return;
    appliedStateRef.current = urlState;
    const [, nextWeek] = urlState.split("|");
    setWeekParam(nextWeek || null);
  }, [urlState]);

  // Restore the remembered audience once, on the client. Deliberately not
  // mirrored into the URL like `week`: a link someone shares should open on the
  // real schedule, not on whatever lens the sender happened to be using.
  useEffect(() => {
    if (localStorage.getItem(AUDIENCE_KEY) === "public") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAudience("public");
    }
  }, []);

  function handleAudienceChange(next: ScheduleAudience) {
    setAudience(next);
    localStorage.setItem(AUDIENCE_KEY, next);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (weekParam) url.searchParams.set("week", weekParam);
    else url.searchParams.delete("week");
    window.history.replaceState(null, "", url.toString());
    appliedStateRef.current = [scheduleParam, weekParam].join("|");
  }, [weekParam, scheduleParam]);

  // Which view is actually on screen has to be settled before the fetch, not
  // after it: a `view` that silently fell back (floorplan without a published
  // map) would otherwise fetch for the view the user *asked* for rather than
  // the one they get.
  const availableViews = ALL_VIEWS.filter(
    (v) => v !== "floorplan" || !!facility?.hasPublishedMap
  );
  const activeView = availableViews.includes(view) ? view : availableViews[0];

  // A continuous schedule is always-open hours rather than placed sessions,
  // so there is nothing to build into it, and no week editor makes sense.
  const isContinuous = scheduleGroup?.scheduleType === "continuous";
  const canCreate = !!scheduleGroup && !isContinuous;
  const inWeekEditor = !!scheduleGroup && !isContinuous && !!weekParam;

  // Only the week editor fetches a week's sessions — the list above it does
  // its own lighter, per-window fetch (WeekListPanel).
  const { data: sessions, isLoading, isError } = useTemplateSchedule({
    template: activeView,
    facilityId: inWeekEditor ? (facility?.id ?? undefined) : undefined,
    scheduleGroupId: inWeekEditor ? (scheduleGroup?.id ?? undefined) : undefined,
    weekStart: editorWeekStart,
    month,
    audience,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: [SCHEDULE_RANGE_KEY] });
  }

  function handleSelectWeek(nextWeekStart: Date) {
    setWeekParam(localDateString(nextWeekStart));
  }

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
      // Scoped to the schedule's own department — a schedule under Aquatics
      // should only offer pool spaces, not every space in the building (e.g.
      // a tennis court). Spaces with no department of their own stay
      // available to every schedule in the facility, mirroring SpacesPanel.
      spaces: (facility?.spaces ?? []).filter(
        (s) => s.departmentId === null || s.departmentId === (scheduleGroup?.departmentId ?? null)
      ),
      // Not filtered by department: a bulkhead is a property of the building,
      // so every schedule in it sees the same set of states (migration 048,
      // decision 3).
      configurations: facility?.configurations ?? [],
      canCreate,
      canDuplicate: true,
      onAddSession: handleAddSession,
      onDuplicate: (session) => {
        setDuplicateError(null);
        setDuplicating(session);
      },
      onAddAnotherTime: (session) => {
        setAddTimeError(null);
        setAddingTime(session);
      },
      onReschedule: handleReschedule,
      onDelete: (session) => {
        setDeleteError(null);
        setDeleting(session);
      },
      onOverrideWeek: (session) => {
        setOverrideError(null);
        setOverriding(session);
      },
      deletingSessionId: deletingId,
    }),
    [scheduleGroup, facility, canCreate, deletingId, handleAddSession, handleReschedule]
  );

  async function handleConfirmCreate(values: CreateSessionValues) {
    // A one-off has no day codes to check — its day is `validFrom`. Keeping the
    // old guard would have made "Just once" silently do nothing.
    if (!scheduleGroup || !values.templateId) return;
    if (!values.once && values.dayCodes.length === 0) return;
    setCreateSubmitting(true);
    setCreateError(null);

    // dtstart's digits are the literal local wall-clock time (see
    // dropin/docs/RESUME-timezone-removal.md) — direct construction, not a
    // conversion.
    const dtstart = `${values.validFrom}T${values.startTime}:00Z`;

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroup.id,
        template_id: values.templateId,
        rrule: values.once
          ? buildRRuleString({ frequency: "once" })
          : buildRRuleString({ frequency: "weekly", days: values.dayCodes }),
        dtstart,
        dtend_time: values.endTime,
        valid_from: values.validFrom,
        valid_until: values.validUntil,
        space_ids: values.spaceIds,
        // Inherited from the dragged/selected template (migration 047) unless
        // overridden in the dialog. Sent explicitly rather than left to the
        // column defaults, which is what previously turned a rental placed from
        // the rail into a public drop-in.
        occupancy_kind: values.occupancyKind,
        disclosure: values.disclosure,
        // Only sent when there is one, so an empty field on a public drop-in
        // doesn't create an empty sidecar row.
        ...(values.holderName.trim() ? { holder_name: values.holderName } : {}),
      }),
    });

    const created = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCreateError(created.error ?? "Could not place this session.");
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

    const startTime = sessionTimeString(duplicating.start);
    const endTime = sessionTimeString(duplicating.end);
    const validFrom = localDateString();
    const dtstart = `${validFrom}T${startTime}:00Z`;

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Duplicating always stays inside the session's own schedule, which
        // may differ from the current pick when the whole facility is shown.
        schedule_group_id: duplicating.scheduleGroupId,
        template_id: duplicating.templateId,
        // Inherited deliberately: a copy of a rental is still a rental, and
        // without these the new row would take the column defaults and come
        // back as a *public drop-in* — publishing a booking staff had marked
        // withheld. The holder name is not copied: session_internal belongs to
        // the original booking, and a duplicate is a different one.
        occupancy_kind: duplicating.occupancyKind,
        disclosure: duplicating.disclosure,
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

  async function handleConfirmAddTime({ startTime, endTime }: AddAnotherTimeValues) {
    if (!addingTime) return;
    setAddTimeSubmitting(true);
    setAddTimeError(null);

    const validFrom = localDateString();
    const dtstart = `${validFrom}T${startTime}:00Z`;
    // Same single day the clicked occurrence falls on — the source
    // session's fuller weekly pattern (if it repeats on more than one day)
    // isn't available on an expanded occurrence, and guessing it would
    // silently add days nobody asked for. See AddAnotherTimeDialog's header.
    const dayCode = DAYS[sessionDayIndex(addingTime.start)].code;

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: addingTime.scheduleGroupId,
        template_id: addingTime.templateId,
        // Same reasoning as the duplicate path above — another time for the
        // same booking must not silently become a public one.
        occupancy_kind: addingTime.occupancyKind,
        disclosure: addingTime.disclosure,
        rrule: buildRRuleString({ frequency: "weekly", days: [dayCode] }),
        dtstart,
        dtend_time: endTime,
        valid_from: validFrom,
        space_ids: addingTime.spaceIds,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddTimeError(data.error ?? "Could not add this time.");
      setAddTimeSubmitting(false);
      return;
    }

    setAddTimeSubmitting(false);
    setAddingTime(null);
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
    const dtstart = `${validFrom}T${display.newStartTime}:00Z`;

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

  async function handleConfirmOverride(values: OverrideWeekValues) {
    if (!overriding) return;
    setOverrideSubmitting(true);
    setOverrideError(null);

    const res = await fetch(`/api/sessions/${overriding.sessionId}/exceptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Derived from the clicked occurrence's own date, not the view's
        // anchor state, so the right week is targeted regardless of where the
        // anchor currently sits.
        weekStart: localDateString(getWeekStart(overriding.start)),
        action: values.action,
        startTime: values.startTime,
        endTime: values.endTime,
        note: values.note,
      }),
    });

    setOverrideSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setOverrideError(data.error ?? "Could not update this week.");
      return;
    }

    setOverriding(null);
    refresh();
  }

  function handleTemplateClick(template: EditorTemplate) {
    // Views without a time axis have no drop position, so a clicked
    // template opens the dialog on the day already in focus.
    const todayDay = DAYS[new Date().getDay()];
    handleAddSession({ dayCode: todayDay.code, dayLabel: todayDay.label, template });
  }

  if (facilities.length === 0) return null;

  const viewIsOffInWidget = !widgetTemplates.includes(activeView);
  // Map is the only view with a position to drop onto, and there's nothing
  // to drag until the scope narrows to one schedule with templates in it.
  const dragEnabled = activeView === "map" && canCreate && editing.templates.length > 0;

  return (
    <OrgThemeProvider primaryColor={orgPrimaryColor} className="space-y-5">
      <>
        {!scheduleGroup ? (
          <ScheduleListSection
            orgId={orgId}
            facilityName={facility?.name ?? ""}
            rows={scheduleListRows}
            newScheduleHref={newScheduleHref}
            emptyMessage={departmentParam ? "Nothing matches the selected filters." : undefined}
          />
        ) : isContinuous ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {scheduleGroup.name} is set up as always-open, so it has no placed sessions. Change
              its hours from{" "}
              <Link href={scheduleGroup.settingsHref} className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
                its settings
              </Link>
              .
            </p>
          </div>
        ) : !weekParam ? (
          <WeekListPanel
            scheduleGroup={scheduleGroup}
            facilityId={facility!.id}
            onSelectWeek={handleSelectWeek}
          />
        ) : (
          <ScheduleDndProvider editing={dragEnabled ? editing : null}>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setWeekParam(null)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                All weeks
              </button>

              <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
                <div className="order-2 lg:order-1 space-y-3">
                  <TemplateRail
                    templates={editing.templates}
                    manageTemplatesHref={scheduleGroup.manageTemplatesHref}
                    draggable={dragEnabled}
                    onTemplateClick={canCreate && !dragEnabled ? handleTemplateClick : undefined}
                  />
                </div>

                <div className="order-1 lg:order-2 rounded-xl border border-border overflow-hidden bg-card">
                  <WeekReviewBar scheduleGroupId={scheduleGroup.id} weekStart={editorWeekStart} />

                  {/* Shadow mode (stage 5). Scoped to the facility rather than this
                      schedule group on purpose — the rentals eating into a drop-in
                      block live under other groups. Staff view only; it publishes
                      nothing, which is why it renders regardless of `audience`. */}
                  <StaffClaimsPanel facilityId={facility.id} weekStart={editorWeekStart} />

                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/30">
                    <AudienceToggle value={audience} onChange={handleAudienceChange} />
                    <div className="flex items-center gap-3">
                      {audience === "public" && (
                        <p className="text-xs text-muted-foreground">
                          Editing is off while you look as a patron.
                        </p>
                      )}
                      {/* The deck sheet is one day, not a week, so this opens on
                          today when today is in the week being edited and on the
                          week's first day otherwise — never on a day outside the
                          week someone is looking at. */}
                      <Link
                        href={deckSheetHref}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print deck sheet
                      </Link>
                    </div>
                  </div>

                  {audience === "public" && (
                    <p className="flex items-center gap-2 px-4 py-2 text-xs text-blue-900 bg-blue-50 border-b border-blue-100">
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Exactly what a patron sees. Withheld names show as
                        &ldquo;{RESERVED_PUBLIC_LABEL},&rdquo; staff-only sessions are gone, and a
                        week nobody has approved yet looks empty here because it is empty for them.
                      </span>
                    </p>
                  )}

                  <ScheduleHeaderBar
                    title={scheduleGroup.name}
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
                      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground/70">
                        Loading schedule…
                      </div>
                    ) : isError ? (
                      <div className="flex items-center justify-center py-16 text-sm text-red-500">
                        Could not load this schedule. Please refresh.
                      </div>
                    ) : (
                      /* Patron view passes null, which is the read-only shape
                         the widget and public facility page already render —
                         the context is nullable for exactly that reason.
                         Offering drag, duplicate or delete over a redacted,
                         partial week would invite staff to edit what they can
                         only half see. */
                      <ScheduleEditingProvider value={audience === "public" ? null : editing}>
                        <ScheduleView
                          template={activeView}
                          sessions={sessions ?? []}
                          weekStart={editorWeekStart}
                          onWeekChange={handleSelectWeek}
                          month={month}
                          onMonthChange={setMonth}
                          facilityId={facility?.id}
                        />
                      </ScheduleEditingProvider>
                    )}
                  </div>

                  {canCreate && (
                    <div className="px-4 py-3 border-t border-border bg-muted/60">
                      <button
                        type="button"
                        onClick={() =>
                          handleAddSession({ dayCode: DAYS[0].code, dayLabel: DAYS[0].label })
                        }
                        disabled={editing.templates.length === 0}
                        className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <CalendarPlus className="w-4 h-4" />
                        Add a session to {scheduleGroup.name}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScheduleDndProvider>
        )}
      </>

      <CreateSessionDialog
        target={createTarget}
        templates={editing.templates}
        spaces={editing.spaces}
        configurations={editing.configurations}
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
        configurations={editing.configurations}
        onCancel={() => {
          setDuplicating(null);
          setDuplicateError(null);
        }}
        onConfirm={handleConfirmDuplicate}
        submitting={duplicateSubmitting}
        error={duplicateError}
      />

      <AddAnotherTimeDialog
        open={!!addingTime}
        session={addingTime}
        onCancel={() => {
          setAddingTime(null);
          setAddTimeError(null);
        }}
        onConfirm={handleConfirmAddTime}
        submitting={addTimeSubmitting}
        error={addTimeError}
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

      <OverrideWeekDialog
        session={overriding}
        onCancel={() => {
          setOverriding(null);
          setOverrideError(null);
        }}
        onConfirm={handleConfirmOverride}
        submitting={overrideSubmitting}
        error={overrideError}
      />
    </OrgThemeProvider>
  );
}
