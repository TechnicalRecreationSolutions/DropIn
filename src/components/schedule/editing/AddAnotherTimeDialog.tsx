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
import type { ExpandedSession } from "@/types/schedule.types";
import { DAYS, sessionDayIndex } from "@/lib/schedule/weekGeometry";
import { sessionTimeString } from "@/lib/utils/dates";

export interface AddAnotherTimeValues {
  startTime: string;
  endTime: string;
}

interface AddAnotherTimeDialogProps {
  open: boolean;
  session: ExpandedSession | null;
  onCancel: () => void;
  onConfirm: (values: AddAnotherTimeValues) => void;
  submitting: boolean;
  error: string | null;
}

/**
 * The complement to DuplicateSessionDialog: same schedule, day(s), space(s)
 * and season as the source session — only the time is asked for. Built for
 * the pattern a pool schedule is actually made of, a room running
 * back-to-back blocks all day with just the lane count changing between
 * them, where re-entering the day and space each time (as duplicate-to-a-
 * different-day requires) would be pure friction.
 *
 * Defaults the new start to the source's own end time, so stacking a
 * contiguous next block is the zero-typing case — the far more common one
 * than a genuinely disconnected gap later the same day.
 */
export default function AddAnotherTimeDialog({
  open,
  session,
  onCancel,
  onConfirm,
  submitting,
  error,
}: AddAnotherTimeDialogProps) {
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  useEffect(() => {
    if (!session) return;
    const durationMinutes = Math.round((session.end.getTime() - session.start.getTime()) / 60000);
    const newStart = sessionTimeString(session.end);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartTime(newStart);
    setEndTime(minutesToClock(clockToMinutes(newStart) + durationMinutes));
  }, [session]);

  if (!session) return null;

  const dayLabel = DAYS[sessionDayIndex(session.start)].short;
  const invalid = !startTime || !endTime || startTime >= endTime;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add another time for &ldquo;{session.templateName ?? session.scheduleGroupName}&rdquo;</DialogTitle>
          <DialogDescription>
            Same schedule, {dayLabel}
            {session.spaceNames.length > 0 ? `, and ${session.spaceNames.join(", ")}` : ""} — just a
            different time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">Start</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="text-gray-400 mt-5">→</span>
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">End</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        {startTime && endTime && startTime >= endTime && (
          <p className="text-xs text-red-500">End time must be after start time.</p>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm({ startTime, endTime })} disabled={submitting || invalid}>
            {submitting ? "Adding…" : "Add session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clockToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToClock(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
