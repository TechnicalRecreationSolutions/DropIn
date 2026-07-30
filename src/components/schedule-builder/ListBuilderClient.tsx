"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ExpandedSession } from "@/types/schedule.types";
import { formatDayShort, formatDayFull, localDateString } from "@/lib/utils/dates";
import { buildRRuleString } from "@/lib/rrule/validate";
import { cn } from "@/lib/utils/cn";
import WeekNavigator from "@/components/schedule/WeekNavigator";
import TemplateLegend from "./TemplateLegend";
import ListSessionRow from "./ListSessionRow";
import CreateSessionDialog, { type CreateSessionTarget, type CreateSessionValues } from "./CreateSessionDialog";
import DuplicateSessionDialog from "./DuplicateSessionDialog";
import type { BuilderTemplate } from "./TemplatePalette";
import { DAYS, dayIndexFromDate } from "./builderShared";
import { DEFAULT_APP_TIMEZONE, zonedTimeToUtc } from "@/lib/utils/timezone";

interface ListBuilderClientProps {
  scheduleGroupId: string;
  spaces: { id: string; name: string }[];
  templates: BuilderTemplate[];
  manageTemplatesHref: string;
  sessions: ExpandedSession[] | undefined;
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
}

/**
 * Day-by-day list builder — no spatial drop target exists in a flat list,
 * so creation happens via each day's "+ Add session" button (opening
 * CreateSessionDialog with a template picker) rather than drag-and-drop.
 * The sidebar is a read-only color legend, not a draggable palette.
 */
export default function ListBuilderClient({
  scheduleGroupId,
  spaces,
  templates,
  manageTemplatesHref,
  sessions,
  weekStart,
  onWeekChange,
}: ListBuilderClientProps) {
  const queryClient = useQueryClient();
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => dayIndexFromDate(new Date()));

  const [createTarget, setCreateTarget] = useState<CreateSessionTarget | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [duplicating, setDuplicating] = useState<ExpandedSession | null>(null);
  const [duplicateSubmitting, setDuplicateSubmitting] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const sessionsByDay = useMemo(() => {
    const map: Record<number, ExpandedSession[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    for (const session of sessions ?? []) {
      map[dayIndexFromDate(session.start)].push(session);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return map;
  }, [sessions]);

  async function handleConfirmCreate(values: CreateSessionValues) {
    if (!createTarget || values.dayCodes.length === 0 || !values.templateId) return;
    setCreateSubmitting(true);
    setCreateError(null);

    const dtstart = zonedTimeToUtc(values.validFrom, values.startTime, DEFAULT_APP_TIMEZONE).toISOString();

    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_group_id: scheduleGroupId,
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
      setCreateError(data.error ?? "Could not create this session.");
      setCreateSubmitting(false);
      return;
    }

    setCreateSubmitting(false);
    setCreateTarget(null);
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

  const now = new Date();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
      <TemplateLegend templates={templates} manageTemplatesHref={manageTemplatesHref} />

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

        <div className="flex gap-1.5 overflow-x-auto pb-2 mt-3 sm:hidden px-1">
          {days.map((day, i) => (
            <button
              key={i}
              onClick={() => setActiveDayIndex(i)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors",
                activeDayIndex === i
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              <span>{formatDayShort(day)}</span>
              <span className="font-bold">{day.getDate()}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-6">
          {days.map((day, dayIndex) => {
            const isMobileHidden = dayIndex !== activeDayIndex;
            const daySessions = sessionsByDay[dayIndex] ?? [];
            const isToday = now.toDateString() === day.toDateString();

            return (
              <div key={dayIndex} className={cn(isMobileHidden ? "hidden sm:block" : "block")}>
                <div className={cn(
                  "flex items-center justify-between gap-2 pb-2 border-b-2",
                  isToday ? "border-blue-500" : "border-gray-200"
                )}>
                  <div className="flex items-baseline gap-2">
                    <h3 className={cn("text-sm font-bold", isToday ? "text-blue-600" : "text-gray-900")}>
                      {formatDayFull(day)}
                    </h3>
                    {daySessions.length > 0 && (
                      <span className="text-xs text-gray-400">
                        {daySessions.length} session{daySessions.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCreateTarget({ dayCode: DAYS[dayIndex].code, dayLabel: DAYS[dayIndex].label }); setCreateError(null); }}
                    disabled={templates.length === 0}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add session
                  </button>
                </div>

                {daySessions.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">No sessions scheduled.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 mt-1">
                    {daySessions.map((session) => (
                      <ListSessionRow
                        key={session.key}
                        session={session}
                        onDuplicate={(s) => { setDuplicating(s); setDuplicateError(null); }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CreateSessionDialog
        open={!!createTarget}
        template={null}
        templates={templates}
        spaces={spaces}
        target={createTarget}
        initialStartTime={null}
        onCancel={() => { setCreateTarget(null); setCreateError(null); }}
        onConfirm={handleConfirmCreate}
        submitting={createSubmitting}
        error={createError}
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
    </div>
  );
}
