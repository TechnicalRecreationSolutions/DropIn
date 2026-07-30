"use client";

import { useMemo, useState } from "react";
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import type { ExpandedSession } from "@/types/schedule.types";
import { cn } from "@/lib/utils/cn";
import { localDateString } from "@/lib/utils/dates";
import { buildRRuleString } from "@/lib/rrule/validate";
import TemplatePalette, { type BuilderTemplate } from "./TemplatePalette";
import SpaceColumn from "./SpaceColumn";
import CreateSessionDialog, { type CreateSessionTarget, type CreateSessionValues } from "./CreateSessionDialog";
import RescheduleConfirmDialog, { type RescheduleTarget } from "./RescheduleConfirmDialog";
import DuplicateSessionDialog from "./DuplicateSessionDialog";
import {
  DAYS,
  dayIndexFromDate,
  timeStringToMinutes,
  minutesToTimeString,
  pixelOffsetToStartTime,
  getGridHeightPx,
  GRID_START_HOUR,
  GRID_END_HOUR,
  SLOT_MINUTES,
  type DroppedTemplate,
} from "./builderShared";
import { DEFAULT_APP_TIMEZONE, zonedTimeToUtc } from "@/lib/utils/timezone";

interface SpaceBuilderClientProps {
  scheduleGroupId: string;
  spaces: { id: string; name: string }[];
  templates: BuilderTemplate[];
  manageTemplatesHref: string;
  sessions: ExpandedSession[] | undefined;
}

interface PendingCreate {
  template: DroppedTemplate;
  target: CreateSessionTarget & { spaceId: string; spaceName: string };
  startTime: string;
}

interface PendingReschedule {
  display: RescheduleTarget;
  dayCode: string;
  durationMinutes: number;
}

/**
 * Map (resource-axis) drag-and-drop builder — the builder's equivalent of
 * the public WeeklyScheduleMap: one day at a time, columns are the
 * facility's real spaces, each on a real hour-by-hour time axis. Drag a
 * session template onto an exact time slot within a space to place it, and
 * drag an already-placed block to a new space and/or time to reschedule
 * it. This is the only builder view with real drag-and-drop — Grid and
 * List have no time axis to drop onto. Sessions are passed down from
 * BuilderClient (which owns the single shared useWeeklySchedule fetch also
 * used by the grid/list builder views) rather than fetched here directly.
 * Internal component/BuilderView name stays "Space" for historical reasons.
 */
export default function SpaceBuilderClient({ scheduleGroupId, spaces, templates, manageTemplatesHref, sessions }: SpaceBuilderClientProps) {
  const queryClient = useQueryClient();
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => dayIndexFromDate(new Date()));

  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pendingReschedule, setPendingReschedule] = useState<PendingReschedule | null>(null);
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const [duplicating, setDuplicating] = useState<ExpandedSession | null>(null);
  const [duplicateSubmitting, setDuplicateSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const activeDay = DAYS[activeDayIndex];
  const gridHeightPx = getGridHeightPx(GRID_START_HOUR, GRID_END_HOUR);
  const slotCount = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;

  const sessionsBySpace = useMemo(() => {
    const map = new Map<string, ExpandedSession[]>();
    if (!sessions) return map;
    for (const session of sessions) {
      if (dayIndexFromDate(session.start) !== activeDayIndex) continue;
      for (const spaceId of session.spaceIds) {
        const existing = map.get(spaceId) ?? [];
        existing.push(session);
        map.set(spaceId, existing);
      }
    }
    return map;
  }, [sessions, activeDayIndex]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as
      | { type?: "template"; template?: BuilderTemplate }
      | { type?: "session"; session?: ExpandedSession }
      | undefined;
    const overData = over.data.current as { type?: string; spaceId?: string; spaceName?: string; dayCode?: string } | undefined;

    if (overData?.type !== "space-slot" || !overData.spaceId || !overData.spaceName || !overData.dayCode) return;

    const translatedRect = active.rect.current.translated;
    if (!translatedRect) return;
    const offsetPx = translatedRect.top - over.rect.top;
    const startTime = pixelOffsetToStartTime(offsetPx);
    const dayMeta = DAYS.find((d) => d.code === overData.dayCode);
    if (!dayMeta) return;

    if (activeData?.type === "template" && activeData.template) {
      setCreateError(null);
      setPendingCreate({
        template: {
          id: activeData.template.id,
          name: activeData.template.name,
          color: activeData.template.color,
          defaultDurationMinutes: activeData.template.default_duration_minutes,
          defaultSpaceIds: activeData.template.default_space_ids,
        },
        target: {
          dayCode: overData.dayCode,
          dayLabel: dayMeta.label,
          spaceId: overData.spaceId,
          spaceName: overData.spaceName,
        },
        startTime,
      });
      return;
    }

    if (activeData?.type === "session" && activeData.session) {
      const session = activeData.session;
      const durationMinutes = (session.end.getTime() - session.start.getTime()) / 60000;
      const endMinutes = timeStringToMinutes(startTime) + durationMinutes;
      setRescheduleError(null);
      setPendingReschedule({
        display: {
          sessionId: session.sessionId,
          templateName: session.templateName,
          scheduleGroupName: session.scheduleGroupName,
          newDayLabel: dayMeta.label,
          newStartTime: startTime,
          crossesMidnight: endMinutes >= 24 * 60,
        },
        dayCode: overData.dayCode,
        durationMinutes,
      });
    }
  }

  async function handleConfirmCreate(values: CreateSessionValues) {
    if (!pendingCreate || values.dayCodes.length === 0) return;
    setCreateSubmitting(true);
    setCreateError(null);

    const dtstart = zonedTimeToUtc(values.validFrom, values.startTime, DEFAULT_APP_TIMEZONE).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroupId,
        template_id: pendingCreate.template.id,
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
    setPendingCreate(null);
    queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
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
    queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
  }

  async function handleConfirmDuplicate(spaceIds: string[], dayCodes: string[]) {
    if (!duplicating || dayCodes.length === 0) return;
    setDuplicateSubmitting(true);
    setDuplicateError(null);

    const startTime = `${String(duplicating.start.getHours()).padStart(2, "0")}:${String(duplicating.start.getMinutes()).padStart(2, "0")}`;
    const endTime = `${String(duplicating.end.getHours()).padStart(2, "0")}:${String(duplicating.end.getMinutes()).padStart(2, "0")}`;

    const validFrom = localDateString();
    const dtstart = zonedTimeToUtc(validFrom, startTime, DEFAULT_APP_TIMEZONE).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroupId,
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
    queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <TemplatePalette
          templates={templates}
          manageTemplatesHref={manageTemplatesHref}
        />

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
            {DAYS.map((day, i) => (
              <button
                key={day.code}
                onClick={() => setActiveDayIndex(i)}
                className={cn(
                  "flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-colors",
                  activeDayIndex === i
                    ? "text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
                style={activeDayIndex === i ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
              >
                {day.short}
              </button>
            ))}
          </div>

          <h3 className="text-sm font-bold text-gray-900 mt-3 mb-3">{activeDay.label}</h3>

          <div className="overflow-x-auto">
            <div className="flex gap-3 min-w-max">
              {spaces.map((space) => (
                <SpaceColumn
                  key={space.id}
                  spaceId={space.id}
                  spaceName={space.name}
                  dayCode={activeDay.code}
                  sessions={sessionsBySpace.get(space.id) ?? []}
                  heightPx={gridHeightPx}
                  slotCount={slotCount}
                  onDuplicate={(session) => { setDuplicating(session); setDuplicateError(null); }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <CreateSessionDialog
        open={!!pendingCreate}
        template={pendingCreate?.template ?? null}
        templates={templates}
        spaces={spaces}
        target={pendingCreate?.target ?? null}
        initialStartTime={pendingCreate?.startTime ?? null}
        initialSpaceIds={pendingCreate ? [pendingCreate.target.spaceId] : undefined}
        onCancel={() => { setPendingCreate(null); setCreateError(null); }}
        onConfirm={handleConfirmCreate}
        submitting={createSubmitting}
        error={createError}
      />

      <RescheduleConfirmDialog
        open={!!pendingReschedule}
        target={pendingReschedule?.display ?? null}
        onCancel={() => { setPendingReschedule(null); setRescheduleError(null); }}
        onConfirm={handleConfirmReschedule}
        submitting={rescheduleSubmitting}
        error={rescheduleError}
      />

      <DuplicateSessionDialog
        open={!!duplicating}
        session={duplicating}
        spaces={spaces}
        onCancel={() => { setDuplicating(null); setDuplicateError(null); }}
        onConfirm={handleConfirmDuplicate}
        submitting={duplicateSubmitting}
        error={duplicateError}
      />
    </DndContext>
  );
}
