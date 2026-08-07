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
import type { ExpandedSession } from "@/types/schedule.types";

interface DeleteSessionDialogProps {
  /** The occurrence whose whole series is up for deletion. Null closes the dialog. */
  session: ExpandedSession | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error: string | null;
}

/**
 * Confirms removing a recurring session. Sessions are whole RRULE series
 * rather than per-occurrence rows, so deleting the block you clicked
 * removes every future occurrence too — spelled out here rather than left
 * to a browser `confirm()`, which can't say that and can't show an error
 * when the delete fails.
 */
export default function DeleteSessionDialog({
  session,
  onCancel,
  onConfirm,
  submitting,
  error,
}: DeleteSessionDialogProps) {
  if (!session) return null;

  const label = session.templateName ?? session.scheduleGroupName;

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove &ldquo;{label}&rdquo;?</DialogTitle>
          <DialogDescription>
            This removes the entire recurring series from {session.scheduleGroupName}, not just this
            week&rsquo;s occurrence. It can&rsquo;t be undone.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Removing…" : "Remove series"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
