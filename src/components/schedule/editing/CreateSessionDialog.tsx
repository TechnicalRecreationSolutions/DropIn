"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { localDateString } from "@/lib/utils/dates";
import { DAYS } from "@/lib/schedule/weekGeometry";
import type { SeasonSummary } from "@/lib/seasons/current";
import type { AddSessionTarget, EditorTemplate } from "./ScheduleEditingContext";

export interface CreateSessionValues {
  templateId: string;
  dayCodes: string[];
  startTime: string;
  endTime: string;
  validFrom: string;
  /** null means the session repeats indefinitely (no season end). */
  validUntil: string | null;
  /** Empty array means no space assigned. More than one means the session occupies all of them at once (e.g. all 4 lanes for Lap Swim). */
  spaceIds: string[];
}

interface CreateSessionDialogProps {
  /** The pending placement — day always, plus space/time/template when the view supplied them. Null closes the dialog. */
  target: AddSessionTarget | null;
  templates: EditorTemplate[];
  spaces: { id: string; name: string }[];
  /** The season being planned, when one is selected. Supplies the date defaults; null means today with no end date. */
  season?: SeasonSummary | null;
  onCancel: () => void;
  onConfirm: (values: CreateSessionValues) => void;
  submitting: boolean;
  error: string | null;
}

/**
 * Creates a new recurring session. One dialog for every entry point: a
 * template dragged onto an exact space and time in Map (everything
 * pre-filled but still adjustable), a day's "+" in Grid/List (template
 * picked here, time entered from scratch), or a template clicked in the
 * rail. Collects everything a session needs — template, spaces, recurrence
 * days, season bounds, start/end time.
 */
export default function CreateSessionDialog({
  target,
  templates,
  spaces,
  season,
  onCancel,
  onConfirm,
  submitting,
  error,
}: CreateSessionDialogProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [validFrom, setValidFrom] = useState(localDateString());
  const [validUntil, setValidUntil] = useState("");
  const [spaceIds, setSpaceIds] = useState<string[]>([]);

  // Reseed every field when the dialog opens for a new placement; once open
  // the form is free-form, so this deliberately keys on the target only.
  useEffect(() => {
    if (!target) return;
    const template = target.template ?? templates[0];
    const start = target.startTime ?? "09:00";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTemplateId(template?.id ?? "");
    setSelectedDays([target.dayCode]);
    setStartTime(start);
    setEndTime(computeEndTime24(start, template?.default_duration_minutes ?? 60));
    setValidFrom(defaultValidFrom(season));
    setValidUntil(season?.ends_on ?? "");
    setSpaceIds(target.spaceId ? [target.spaceId] : (template?.default_space_ids ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  function toggleDay(code: string) {
    setSelectedDays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
  }

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id);
    const picked = templates.find((t) => t.id === id);
    if (picked) {
      setEndTime(computeEndTime24(startTime, picked.default_duration_minutes));
      if (spaceIds.length === 0) setSpaceIds(picked.default_space_ids);
    }
  }

  const draggedTemplate = target.template;
  const dayLabels = DAYS.filter((d) => selectedDays.includes(d.code)).map((d) => d.short).join(", ");
  const daysValid = selectedDays.length > 0;
  const timeValid = endTime > startTime;
  const datesValid = !validUntil || validUntil >= validFrom;
  const canSubmit = daysValid && timeValid && datesValid && !!selectedTemplateId && !!validFrom;

  return (
    <Dialog open={!!target} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draggedTemplate ? `Place "${draggedTemplate.name}"` : "Add session"}</DialogTitle>
          <DialogDescription>
            {target.spaceName ? `${target.spaceName} · ${target.dayLabel}` : target.dayLabel}
          </DialogDescription>
        </DialogHeader>

        {!draggedTemplate && (
          <div>
            <label htmlFor="create-session-template" className="block text-sm font-medium text-gray-700 mb-1">
              Session template
            </label>
            <select
              id="create-session-template"
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.default_duration_minutes} min)</option>
              ))}
            </select>
          </div>
        )}

        {spaces.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Spaces</label>
            <div className="flex gap-1.5 flex-wrap">
              {spaces.map((space) => {
                const selected = spaceIds.includes(space.id);
                return (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => toggleSpace(space.id)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors",
                      selected
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-gray-200 text-gray-600 hover:border-blue-300"
                    )}
                    aria-pressed={selected}
                  >
                    {space.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1">Select every space this session occupies at once (e.g. all 4 lanes for Lap Swim).</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Repeats on</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map((day) => {
              const selected = selectedDays.includes(day.code);
              return (
                <button
                  key={day.code}
                  type="button"
                  onClick={() => toggleDay(day.code)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors",
                    selected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-200 text-gray-600 hover:border-blue-300"
                  )}
                  aria-pressed={selected}
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          {!daysValid && (
            <p className="text-xs text-red-500 mt-1">Select at least one day.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="create-session-start-time" className="block text-sm font-medium text-gray-700 mb-1">
              Start time
            </label>
            <input
              id="create-session-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="create-session-end-time" className="block text-sm font-medium text-gray-700 mb-1">
              End time
            </label>
            <input
              id="create-session-end-time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {!timeValid && (
            <p className="text-xs text-red-500 col-span-2 -mt-2">End time must be after start time.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="create-session-valid-from" className="block text-sm font-medium text-gray-700 mb-1">
              Start date
            </label>
            <input
              id="create-session-valid-from"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="create-session-valid-until" className="block text-sm font-medium text-gray-700 mb-1">
              End date <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id="create-session-valid-until"
              type="date"
              value={validUntil}
              min={validFrom}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {!datesValid && (
            <p className="text-xs text-red-500 col-span-2 -mt-2">End date must be on or after the start date.</p>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Creates one recurring session, every {dayLabels || "…"}, {formatTime12(startTime)}–{formatTime12(endTime)},
          starting {validFrom}{validUntil ? ` through ${validUntil}` : " with no end date"}.
          {season && ` Assigned to ${season.name}.`}
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({
              templateId: selectedTemplateId,
              dayCodes: selectedDays,
              startTime,
              endTime,
              validFrom,
              validUntil: validUntil || null,
              spaceIds,
            })}
            disabled={submitting || !canSubmit}
          >
            {submitting ? "Placing…" : "Place session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The start date a new session gets when a season is selected.
 *
 * Not simply the season's start: mid-way through Fall, dating a brand-new class
 * back to September would make it appear retroactively in weeks that have
 * already happened, since expansion clamps to valid_from. The later of today
 * and the season start is the honest default, and it's still editable below.
 */
function defaultValidFrom(season: SeasonSummary | null | undefined): string {
  const today = localDateString();
  if (!season) return today;
  return season.starts_on > today ? season.starts_on : today;
}

function computeEndTime24(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const totalMinutes = (h * 60 + m + durationMinutes) % (24 * 60);
  const endH = Math.floor(totalMinutes / 60);
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}
