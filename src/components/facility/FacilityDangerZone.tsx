"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import DeleteFacilityDialog from "./DeleteFacilityDialog";
import type { FacilityDeletionImpact } from "@/lib/facilities/deletionImpact";

interface FacilityDangerZoneProps {
  facilityId: string;
  facilityName: string;
  impact: FacilityDeletionImpact;
  /** False for members — the API refuses them too; this just doesn't dangle the button. */
  canDelete: boolean;
}

/**
 * The delete control, kept in its own bordered block below the edit form
 * rather than as another button inside it.
 *
 * Two reasons it lives here and not on the facilities grid: a card in a grid
 * is a click target people hit while scanning, and the edit page is where
 * someone already is when they've decided a building is wrong. Separating it
 * from the form's own buttons also keeps "Save changes" and "Delete" from
 * sitting adjacent, which is how the wrong one gets pressed.
 */
export default function FacilityDangerZone({
  facilityId,
  facilityName,
  impact,
  canDelete,
}: FacilityDangerZoneProps) {
  const [open, setOpen] = useState(false);

  if (!canDelete) return null;

  return (
    <div className="mt-8 rounded-xl border border-red-200 bg-red-50/50 p-6">
      <h2 className="text-sm font-semibold text-red-900">Danger zone</h2>
      <p className="text-sm text-red-800/80 mt-1">
        Deleting this facility also deletes every department, schedule and session inside it.
        There is no undo.
      </p>

      <Button variant="destructive" className="mt-4" onClick={() => setOpen(true)}>
        <Trash2 />
        Delete facility
      </Button>

      <DeleteFacilityDialog
        open={open}
        onOpenChange={setOpen}
        facilityId={facilityId}
        facilityName={facilityName}
        impact={impact}
      />
    </div>
  );
}
