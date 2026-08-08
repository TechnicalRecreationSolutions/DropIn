"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SeasonWithUsage } from "./SeasonsManager";

interface DeleteSeasonDialogProps {
  /** The season being deleted. Null closes the dialog. */
  season: SeasonWithUsage | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

/**
 * Confirms deleting a season.
 *
 * Worth being precise in the copy: `sessions.season_id` is ON DELETE SET NULL
 * (migration 027), so this unassigns sessions rather than deleting any
 * schedule. Staff hesitate to delete anything named after a period their whole
 * schedule sits in, and the honest answer — nothing on the calendar changes —
 * is reassuring, so the dialog says it rather than issuing a generic warning.
 */
export default function DeleteSeasonDialog({ season, onClose, onDeleted }: DeleteSeasonDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!season) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/seasons/${season.id}`, { method: "DELETE" });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete this season.");
      return;
    }

    onDeleted(season.id);
  }

  return (
    <Dialog
      open={!!season}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {season?.name}?</DialogTitle>
          <DialogDescription>
            {season && season.session_count > 0 ? (
              <>
                {season.session_count} {season.session_count === 1 ? "session is" : "sessions are"}{" "}
                assigned to this season. They stay on the schedule exactly as they are — they just
                stop belonging to a season, and you&rsquo;d need to reassign them to group them
                again.
              </>
            ) : (
              <>Nothing is assigned to this season, so nothing else changes.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
            {submitting ? "Deleting…" : "Delete season"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
