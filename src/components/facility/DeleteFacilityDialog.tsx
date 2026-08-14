"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FacilityDeletionImpact } from "@/lib/facilities/deletionImpact";

interface DeleteFacilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  facilityName: string;
  impact: FacilityDeletionImpact;
}

/**
 * Confirms deleting a facility, gated on typing the facility's name.
 *
 * The typed confirmation is not ceremony. Unlike every other delete in this
 * app, this one cascades through the whole schedule tree — departments,
 * schedule groups, every session in them, spaces, the facility map and any
 * facility-scoped brochure — and there is no undo and no soft-delete column to
 * recover from. Making the destructive button unreachable until the name is
 * typed exactly is the standard defence, and it costs a careless click nothing
 * but a moment.
 *
 * The counts come from the server (`getFacilityDeletionImpact`) rather than
 * being estimated here, so the dialog names real numbers.
 */
export default function DeleteFacilityDialog({
  open,
  onOpenChange,
  facilityId,
  facilityName,
  impact,
}: DeleteFacilityDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirmation.trim() === facilityName.trim();

  const lines: string[] = [];
  if (impact.departments > 0) lines.push(plural(impact.departments, "department"));
  if (impact.scheduleGroups > 0) lines.push(plural(impact.scheduleGroups, "schedule"));
  if (impact.sessions > 0) lines.push(plural(impact.sessions, "session"));
  if (impact.spaces > 0) lines.push(plural(impact.spaces, "space"));
  if (impact.brochures > 0) lines.push(plural(impact.brochures, "brochure"));

  async function handleDelete() {
    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/facilities/${facilityId}`, { method: "DELETE" });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete this facility.");
      setSubmitting(false);
      return;
    }

    // The sidebar's facility list is React Query cached; without this it keeps
    // showing the deleted building until the next full load.
    queryClient.invalidateQueries({ queryKey: ["nav-tree"] });
    router.push("/dashboard/facilities");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirmation("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {facilityName}?</DialogTitle>
          <DialogDescription>
            {lines.length > 0 ? (
              <>
                This permanently deletes the facility and everything inside it:{" "}
                <span className="font-medium text-gray-900">{formatList(lines)}</span>. This
                cannot be undone.
              </>
            ) : (
              <>
                Nothing is scheduled at this facility yet, so only the facility itself is
                deleted. This cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div>
          <label htmlFor="delete-confirmation" className="block text-sm font-medium text-gray-700 mb-1">
            Type <span className="font-semibold">{facilityName}</span> to confirm
          </label>
          <input
            id="delete-confirmation"
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            placeholder={facilityName}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!confirmed || submitting}
          >
            {submitting ? "Deleting…" : "Delete facility"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "a", "a and b", "a, b and c" — the counts read as a sentence, not a table. */
function formatList(items: string[]) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
