"use client";

import { useEffect, useState } from "react";
import { CalendarOff, Clock, RotateCcw } from "lucide-react";
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
import { getWeekStart } from "@/lib/utils/dates";
import type { ExpandedSession } from "@/types/schedule.types";

export type WeekOverrideAction = "cancel" | "modify" | "clear";

export interface OverrideWeekValues {
  action: WeekOverrideAction;
  startTime?: string;
  endTime?: string;
  note?: string | null;
}

interface OverrideWeekDialogProps {
  /**
   * The session block clicked. The week overridden is derived from this
   * occurrence's own start date (getWeekStart), NOT whatever week the
   * surrounding view happens to be anchored to — the Events tab renders a
   * whole month at once, so its view-level anchor is very often a different
   * week than the specific card someone clicked.
   */
  session: ExpandedSession | null;
  onCancel: () => void;
  onConfirm: (values: OverrideWeekValues) => void;
  submitting: boolean;
  error: string | null;
}

/**
 * Overrides one week of a recurring session — cancel it, give it different
 * hours, or revert an earlier override — without touching the RRULE that
 * governs every other week. Every date the API ends up writing to is
 * computed server-side from the session's own pattern (see
 * POST /api/sessions/[sessionId]/exceptions); this dialog only collects the
 * action and, for 'modify', the wall-clock hours to apply.
 */
export default function OverrideWeekDialog({
  session,
  onCancel,
  onConfirm,
  submitting,
  error,
}: OverrideWeekDialogProps) {
  const [action, setAction] = useState<WeekOverrideAction>("cancel");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!session) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAction("cancel");
    setNote("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [session]);

  if (!session) return null;

  const label = session.templateName ?? session.scheduleGroupName;
  const weekStart = getWeekStart(session.start);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = `${weekStart.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override &ldquo;{label}&rdquo;</DialogTitle>
          <DialogDescription>
            For the week of {weekLabel} only — every other week of this recurring session keeps
            running exactly as scheduled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <OptionCard
            icon={CalendarOff}
            active={action === "cancel"}
            onClick={() => setAction("cancel")}
            title="Cancel this week"
            hint="Hidden from the schedule for this week only — e.g. a holiday closure."
          />
          <OptionCard
            icon={Clock}
            active={action === "modify"}
            onClick={() => setAction("modify")}
            title="Different hours this week"
            hint="e.g. shortened holiday hours."
          />
          <OptionCard
            icon={RotateCcw}
            active={action === "clear"}
            onClick={() => setAction("clear")}
            title="Revert to normal schedule"
            hint="Removes any override already set for this week."
          />
        </div>

        {action === "modify" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="End time">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        {action !== "clear" && (
          <Field label="Note" hint={`Shown publicly, e.g. “Closed for Family Day”.`}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              className={inputClass}
            />
          </Field>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                action,
                startTime: action === "modify" ? startTime : undefined,
                endTime: action === "modify" ? endTime : undefined,
                note: action === "clear" ? null : note || null,
              })
            }
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}

function OptionCard({
  icon: Icon,
  active,
  onClick,
  title,
  hint,
}: {
  icon: typeof CalendarOff;
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "w-full text-left rounded-lg border-2 p-3 transition-colors flex items-start gap-3",
        active ? "border-blue-600 bg-blue-50" : "border-border hover:border-blue-300"
      )}
    >
      <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", active ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/70")} />
      <span>
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
      </span>
    </button>
  );
}
