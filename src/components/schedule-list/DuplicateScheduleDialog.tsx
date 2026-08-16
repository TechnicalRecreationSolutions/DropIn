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
import type { ScheduleListRow } from "./ScheduleListSection";

interface DuplicateScheduleDialogProps {
  row: ScheduleListRow | null;
  onCancel: () => void;
  onConfirm: (name: string, startsOn: string | null, endsOn: string | null) => void;
  submitting: boolean;
}

/**
 * Asks only for what a duplicate actually needs decided up front: a name
 * (defaulted so zero-typing "Duplicate" still works) and dates, since the
 * whole point of duplicating is placing it into a new date range — the copy
 * always lands as a draft, so there's nothing else to ask before it's safe
 * to create. Templates come along automatically (see the duplicate route's
 * header); sessions don't, so there's no session-related choice to make here.
 */
export default function DuplicateScheduleDialog({
  row,
  onCancel,
  onConfirm,
  submitting,
}: DuplicateScheduleDialogProps) {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (row) setName(`${row.name} (Copy)`);
    setStartsOn("");
    setEndsOn("");
  }, [row]);

  if (!row) return null;

  const invalid = !name.trim() || (startsOn && endsOn && endsOn < startsOn);

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate &ldquo;{row.name}&rdquo;</DialogTitle>
          <DialogDescription>
            Creates a new draft schedule with the same activities and settings — dates and sessions
            start fresh.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Start (optional)</label>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-gray-400 mt-5">→</span>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">End (optional)</label>
              <input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          {startsOn && endsOn && endsOn < startsOn && (
            <p className="text-xs text-red-500">End date must be on or after the start date.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(name.trim(), startsOn || null, endsOn || null)}
            disabled={submitting || !!invalid}
          >
            {submitting ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
