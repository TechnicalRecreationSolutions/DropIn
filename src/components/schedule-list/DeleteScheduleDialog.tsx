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
import type { ScheduleListRow } from "./ScheduleListSection";

interface DeleteScheduleDialogProps {
  row: ScheduleListRow | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}

/**
 * There's no soft-delete/archive column on schedule_groups (see the DELETE
 * route's header) — this removes the schedule and every session under it
 * for good, so the confirmation says exactly that rather than something
 * softer like "archive".
 */
export default function DeleteScheduleDialog({
  row,
  onCancel,
  onConfirm,
  submitting,
}: DeleteScheduleDialogProps) {
  if (!row) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{row.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            This removes the schedule and every session in it{row.sessionsCount > 0 ? ` (${row.sessionsCount} of them)` : ""}.
            It can&rsquo;t be undone. If you just want to reuse this for next season, duplicate it instead.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Deleting…" : "Delete schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
