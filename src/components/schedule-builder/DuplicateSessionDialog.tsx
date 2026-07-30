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
import type { ExpandedSession } from "@/types/schedule.types";
import { DAYS } from "./builderShared";

interface DuplicateSessionDialogProps {
  open: boolean;
  session: ExpandedSession | null;
  spaces: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (spaceIds: string[], dayCodes: string[]) => void;
  submitting: boolean;
  error: string | null;
}

/**
 * Copies an already-placed session's time/duration/template onto a
 * (possibly different) space and day(s) — the fast path for "same session,
 * different lane" or duplicating a pattern onto more days without
 * re-filling the whole drop-confirm flow from scratch.
 */
export default function DuplicateSessionDialog({
  open,
  session,
  spaces,
  onCancel,
  onConfirm,
  submitting,
  error,
}: DuplicateSessionDialogProps) {
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpaceIds(session.spaceIds);
    const dow = session.start.getDay();
    const dayCode = DAYS[dow === 0 ? 6 : dow - 1].code;
    setSelectedDays([dayCode]);
  }, [session]);

  if (!session) return null;

  function toggleDay(code: string) {
    setSelectedDays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
  }

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate &ldquo;{session.templateName ?? session.scheduleGroupName}&rdquo;</DialogTitle>
          <DialogDescription>
            Same time and duration, placed as a new session on the space and day(s) you choose.
          </DialogDescription>
        </DialogHeader>

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
          {selectedDays.length === 0 && (
            <p className="text-xs text-red-500 mt-1">Select at least one day.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(spaceIds, selectedDays)}
            disabled={submitting || selectedDays.length === 0}
          >
            {submitting ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
