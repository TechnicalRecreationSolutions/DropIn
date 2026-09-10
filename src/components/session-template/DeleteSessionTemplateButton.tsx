"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteSessionTemplateButtonProps {
  templateId: string;
  templateName: string;
}

/**
 * The Delete action on the Session templates page's rows.
 *
 * A plain confirm, not DeleteFacilityDialog's typed one: the API archives the
 * template (is_active=false) rather than dropping the row, and sessions already
 * placed from it keep their own settings — so the only thing lost is the
 * template's place in the list and the command centre's template rail.
 */
export default function DeleteSessionTemplateButton({ templateId, templateName }: DeleteSessionTemplateButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/session-templates/${templateId}`, { method: "DELETE" });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete this template.");
      setSubmitting(false);
      return;
    }

    setOpen(false);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${templateName}`}
        className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
      >
        <Trash2 />
        <span className="hidden sm:inline">Delete</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (submitting) return;
          if (!next) setError(null);
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {templateName}?</DialogTitle>
            <DialogDescription>
              It will no longer appear here or in the schedule builder. Sessions already placed from
              it stay on the schedule, unchanged.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? "Deleting…" : "Delete template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
