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
import GridSessionCard from "./GridSessionCard";
import CreateSessionDialog, { type CreateSessionTarget, type CreateSessionValues } from "./CreateSessionDialog";
import DuplicateSessionDialog from "./DuplicateSessionDialog";
import type { BuilderTemplate } from "./TemplatePalette";
import { DAYS, dayIndexFromDate } from "./builderShared";
import { DEFAULT_APP_TIMEZONE, zonedTimeToUtc } from "@/lib/utils/timezone";

interface GridBuilderClientProps {
  scheduleGroupId: string;
  spaces: { id: string; name: string }[];
  templates: BuilderTemplate[];
  manageTemplatesHref: string;
  sessions: ExpandedSession[] | undefined;
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
}

/**
 * Weekly grid builder — seven day columns, each a simple flex-stacked list
 * of session cards (no time axis, matching the public WeeklyScheduleGrid).
 * There's no spatial/vertical position to drag onto, so creation happens
 * via each column's "+ Add session" button (same pattern as the List
 * builder, just arranged as columns instead of stacked day sections).
 * The Space builder is where real time-axis drag-and-drop lives.
 */
export default function GridBuilderClient({
  scheduleGroupId,
  spaces,
  templates,
  manageTemplatesHref,
  sessions,
  weekStart,
  onWeekChange,
}: GridBuilderClientProps) {
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

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <WeekNavigator weekStart={weekStart} onWeekChange={onWeekChange} />

        <div className="flex gap-1.5 overflow-x-auto pb-2 mt-3 sm:hidden px-1">
          {days.map((day, i) => (
            <button
              key={i}
              onClick={() => setActiveDayIndex(i)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors",
                activeDayIndex === i
                  ? "text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
              style={activeDayIndex === i ? { backgroundColor: "var(--org-primary, #2563eb)" } : undefined}
            >
              <span>{formatDayShort(day)}</span>
              <span className="font-bold">{day.getDate()}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          <div className={cn("grid gap-1.5", "grid-cols-1 sm:grid-cols-7", "sm:min-w-[900px]")}>
            {days.map((day, dayIndex) => {
              const isMobileHidden = dayIndex !== activeDayIndex;
              const daySessions = sessionsByDay[dayIndex] ?? [];
              const isToday = now.toDateString() === day.toDateString();

              return (
                <div key={dayIndex} className={cn("flex flex-col", isMobileHidden ? "hidden sm:flex" : "flex")}>
                  <div
                    className="flex items-center justify-between gap-1 px-2 py-2 rounded-t-lg text-white text-xs font-bold"
                    style={{ backgroundColor: isToday ? "var(--org-accent, #2563eb)" : "var(--org-primary, #2563eb)" }}
                  >
                    <span className="truncate">
                      <span className="hidden sm:inline">{formatDayShort(day)} {day.getDate()}</span>
                      <span className="sm:hidden">{formatDayFull(day)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateTarget({ dayCode: DAYS[dayIndex].code, dayLabel: DAYS[dayIndex].label });
                        setCreateError(null);
                      }}
                      disabled={templates.length === 0}
                      className="p-0.5 rounded hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={`Add session on ${DAYS[dayIndex].label}`}
                      title="Add session"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div
                    className={cn(
                      "flex-1 p-1.5 flex flex-col gap-1.5 min-h-[56px] rounded-b-lg border border-t-0",
                      isToday ? "border-blue-100" : "border-gray-200"
                    )}
                    style={{ backgroundColor: isToday ? "var(--org-card-bg, #eff6ff)" : "#FBFCFD" }}
                  >
                    {daySessions.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 opacity-70 py-3">No sessions</p>
                    ) : (
                      daySessions.map((session) => (
                        <GridSessionCard
                          key={session.key}
                          session={session}
                          onDuplicate={(s) => { setDuplicating(s); setDuplicateError(null); }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
