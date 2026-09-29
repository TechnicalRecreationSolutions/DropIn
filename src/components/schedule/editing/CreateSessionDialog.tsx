"use client";

import { useEffect, useState } from "react";
import {
  OCCUPANCY_KINDS,
  DISCLOSURE_OPTIONS,
  occupancyKindLabel,
  type OccupancyKind,
  type Disclosure,
} from "@/lib/sessions/occupancy";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Banner } from "@/components/ui/banner";
import { cn } from "@/lib/utils/cn";
import { localDateString } from "@/lib/utils/dates";
import { DAYS } from "@/lib/schedule/weekGeometry";
import type { AddSessionTarget, EditorTemplate } from "./ScheduleEditingContext";
import { LabelWithInfo } from "@/components/ui/info-tip";

export interface CreateSessionValues {
  templateId: string;
  /**
   * True when this is a single-occurrence session (`FREQ=DAILY;COUNT=1`).
   * `dayCodes` is then irrelevant — the date is `validFrom`.
   */
  once: boolean;
  dayCodes: string[];
  startTime: string;
  endTime: string;
  validFrom: string;
  /** null means the session repeats indefinitely (no end date). */
  validUntil: string | null;
  /** Seeded from the chosen template (migration 047), overridable here. */
  occupancyKind: OccupancyKind;
  disclosure: Disclosure;
  /** Staff-only holder name, for a one-off booking with no template of its own. */
  holderName: string;
  /** Empty array means no space assigned. More than one means the session occupies all of them at once (e.g. all 4 lanes for Lap Swim). */
  spaceIds: string[];
}

interface CreateSessionDialogProps {
  /** The pending placement — day always, plus space/time/template when the view supplied them. Null closes the dialog. */
  target: AddSessionTarget | null;
  templates: EditorTemplate[];
  spaces: { id: string; name: string }[];
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
 * days, date bounds, start/end time.
 */
export default function CreateSessionDialog({
  target,
  templates,
  spaces,
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
  const [once, setOnce] = useState(false);
  const [occupancyKind, setOccupancyKind] = useState<OccupancyKind>("drop_in");
  const [disclosure, setDisclosure] = useState<Disclosure>("public");
  const [holderName, setHolderName] = useState("");

  // Reseed every field when the dialog opens for a new placement; once open
  // the form is free-form, so this deliberately keys on the target only.
  useEffect(() => {
    if (!target) return;
    const template = target.template ?? templates[0];
    const start = target.startTime ?? "09:00";
    // A dated target came from a month cell — one specific day, not a range.
    const dated = !!target.date;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTemplateId(template?.id ?? "");
    setSelectedDays([target.dayCode]);
    setStartTime(start);
    setEndTime(computeEndTime24(start, template?.default_duration_minutes ?? 60));
    setValidFrom(dated ? target.date! : localDateString());
    setValidUntil(dated ? target.date! : "");
    setSpaceIds(target.spaceId ? [target.spaceId] : (template?.default_space_ids ?? []));
    setOnce(dated);
    // The template is what makes a rental arrive as a rental. Without this the
    // fast path took the column defaults and quietly published a booking staff
    // had marked withheld on the template they just dragged.
    setOccupancyKind(template?.occupancy_kind ?? "drop_in");
    setDisclosure(template?.disclosure ?? "public");
    setHolderName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;

  function toggleDay(code: string) {
    setSelectedDays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
  }

  // Headings over the pills once a building has two states to tell apart
  // (migration 048); one unlabelled group — the picker as it was — otherwise.

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id);
    const picked = templates.find((t) => t.id === id);
    if (picked) {
      setEndTime(computeEndTime24(startTime, picked.default_duration_minutes));
      if (spaceIds.length === 0) setSpaceIds(picked.default_space_ids);
      setOccupancyKind(picked.occupancy_kind);
      setDisclosure(picked.disclosure);
    }
  }

  const draggedTemplate = target.template;
  const dayLabels = DAYS.filter((d) => selectedDays.includes(d.code)).map((d) => d.short).join(", ");
  // A one-off has no weekday pattern to validate — its day is the date field.
  const daysValid = once || selectedDays.length > 0;
  const timeValid = endTime > startTime;
  const datesValid = once || !validUntil || validUntil >= validFrom;
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
            <label htmlFor="create-session-template" className="block text-sm font-medium text-foreground mb-1">
              Session template
            </label>
            <NativeSelect
              id="create-session-template"
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.default_duration_minutes} min)</option>
              ))}
            </NativeSelect>
          </div>
        )}

        {/* What the template said this is (migration 047), stated rather than
            re-asked. A rental dragged from the rail needs no clicks here; the
            summary line is what makes "patrons won't see the name" visible at
            placement time instead of being a property nobody looked at. The
            override is a details disclosure so the common case stays one drag. */}
        <div className="rounded-banner bg-muted p-3">
          <p className="text-xs text-foreground">
            <span className="font-semibold">{occupancyKindLabel(occupancyKind)}</span>
            {" · patrons see "}
            <span className="font-semibold">
              {DISCLOSURE_OPTIONS.find((o) => o.value === disclosure)?.label.toLowerCase()}
            </span>
          </p>

          {disclosure !== "public" && (
            <div className="mt-2">
              <label
                htmlFor="create-session-holder"
                className="block text-xs font-medium text-foreground mb-1"
              >
                Who has this space <span className="font-normal text-muted-foreground">(staff only)</span>
              </label>
              <Input
                id="create-session-holder"
                type="text"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="e.g. Island Swimming"
              />
            </div>
          )}

          <details className="mt-2">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              Change for this session only
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex gap-1.5 flex-wrap">
                {OCCUPANCY_KINDS.map((kind) => {
                  const selected = occupancyKind === kind.value;
                  return (
                    <button
                      key={kind.value}
                      type="button"
                      onClick={() => {
                        setOccupancyKind(kind.value);
                        setDisclosure(kind.defaultDisclosure);
                      }}
                      className={cn(
                        "px-2 py-1 rounded-full text-xs font-medium border transition-colors",
                        selected
                          ? "border-brand bg-brand-subtle text-brand-strong"
                          : "border-input text-muted-foreground hover:bg-muted"
                      )}
                      aria-pressed={selected}
                    >
                      {kind.label}
                    </button>
                  );
                })}
              </div>
              <NativeSelect
                value={disclosure}
                onChange={(e) => setDisclosure(e.target.value as Disclosure)}
                aria-label="What patrons see"
              >
                {DISCLOSURE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Patrons see: {option.label}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">Only affects this session, not the template.</p>
            </div>
          </details>
        </div>

        {spaces.length > 0 && (
          <div>
            <LabelWithInfo className="block text-sm font-medium text-foreground" info="Select every space this session uses at once, e.g. all 4 lanes for Lap Swim.">Spaces</LabelWithInfo>
            <div className="flex gap-1.5 flex-wrap">
              {spaces.map((space) => {
                const selected = spaceIds.includes(space.id);
                return (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => toggleSpace(space.id)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      selected
                        ? "border-brand bg-brand-subtle text-brand-strong"
                        : "border-input text-muted-foreground hover:bg-muted"
                    )}
                    aria-pressed={selected}
                  >
                    {space.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Repeats</label>
          <div className="flex gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => setOnce(false)}
              aria-pressed={!once}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                !once ? "border-brand bg-brand-subtle text-brand-strong" : "border-input text-muted-foreground hover:bg-muted"
              )}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setOnce(true)}
              aria-pressed={once}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                once ? "border-brand bg-brand-subtle text-brand-strong" : "border-input text-muted-foreground hover:bg-muted"
              )}
            >
              Just once
            </button>
          </div>
        </div>

        {/* Day chips are meaningless for a one-off — the day it happens on is
            the date below, not a weekday pattern. */}
        {!once && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Repeats on</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map((day) => {
              const selected = selectedDays.includes(day.code);
              return (
                <button
                  key={day.code}
                  type="button"
                  onClick={() => toggleDay(day.code)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    selected
                      ? "border-brand bg-brand-subtle text-brand-strong"
                      : "border-input text-muted-foreground hover:bg-muted"
                  )}
                  aria-pressed={selected}
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          {!daysValid && (
            <p className="text-xs text-destructive mt-1">Select at least one day.</p>
          )}
        </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="create-session-start-time" className="block text-sm font-medium text-foreground mb-1">
              Start time
            </label>
            <Input
              id="create-session-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="create-session-end-time" className="block text-sm font-medium text-foreground mb-1">
              End time
            </label>
            <Input
              id="create-session-end-time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          {!timeValid && (
            <p className="text-xs text-destructive col-span-2 -mt-2">End time must be after start time.</p>
          )}
        </div>

        {once ? (
          <div>
            <label htmlFor="create-session-valid-from" className="block text-sm font-medium text-foreground mb-1">
              Date
            </label>
            <Input
              id="create-session-valid-from"
              type="date"
              value={validFrom}
              // A one-off's window is the single day it happens on, so the two
              // dates move together and only one is shown.
              onChange={(e) => {
                setValidFrom(e.target.value);
                setValidUntil(e.target.value);
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="create-session-valid-from" className="block text-sm font-medium text-foreground mb-1">
                Start date
              </label>
              <Input
                id="create-session-valid-from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="create-session-valid-until" className="block text-sm font-medium text-foreground mb-1">
                End date <span className="font-normal text-muted-foreground/70">(optional)</span>
              </label>
              <Input
                id="create-session-valid-until"
                type="date"
                value={validUntil}
                min={validFrom}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
            {!datesValid && (
              <p className="text-xs text-destructive col-span-2 -mt-2">End date must be on or after the start date.</p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {once
            ? `Creates a single session on ${validFrom || "…"}, ${formatTime12(startTime)}–${formatTime12(endTime)}.`
            : `Creates one recurring session, every ${dayLabels || "…"}, ${formatTime12(startTime)}–${formatTime12(endTime)}, starting ${validFrom}${validUntil ? ` through ${validUntil}` : " with no end date"}.`}
        </p>

        {error && (
          <Banner variant="error">{error}</Banner>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({
              templateId: selectedTemplateId,
              once,
              dayCodes: selectedDays,
              startTime,
              endTime,
              validFrom,
              // A one-off's window is exactly its own day, so it never carries
              // an end date the way a recurring placement does.
              validUntil: once ? validFrom : (validUntil || null),
              spaceIds,
              occupancyKind,
              disclosure,
              holderName,
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
