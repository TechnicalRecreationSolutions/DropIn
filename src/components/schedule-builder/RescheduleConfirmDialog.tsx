"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface RescheduleTarget {
  sessionId: string;
  templateName: string | null;
  scheduleGroupName: string;
  newDayLabel: string;
  newStartTime: string; // HH:MM, for display
  crossesMidnight: boolean;
}

interface RescheduleConfirmDialogProps {
  open: boolean;
  target: RescheduleTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
}

/**
 * Confirms a drag-to-reschedule before it's saved. Sessions are whole RRULE
 * series, not per-occurrence rows, so dragging one visual block changes the
 * ENTIRE recurring series' day/time — this is called out explicitly rather
 * than silently mutated, matching how CreateSessionDialog/DuplicateSessionDialog
 * already require an explicit confirm rather than an instant, silent write.
 * A multi-space session's blocks (one per space column) all move together;
 * dragging never changes which spaces a session occupies — that's only done
 * through the create/duplicate/edit dialogs.
 */
export default function RescheduleConfirmDialog({
  open,
  target,
  onCancel,
  onConfirm,
  submitting,
  error,
}: RescheduleConfirmDialogProps) {
  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move &ldquo;{target.templateName ?? target.scheduleGroupName}&rdquo;?</DialogTitle>
          <DialogDescription>
            This moves the entire recurring series to every {target.newDayLabel} at{" "}
            {formatTimeLabel(target.newStartTime)}.
          </DialogDescription>
        </DialogHeader>

        {target.crossesMidnight ? (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            This would push the session past midnight. Choose a different time.
          </p>
        ) : (
          error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting || target.crossesMidnight}>
            {submitting ? "Moving…" : "Move session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatTimeLabel(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}
