"use client";

import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";

/**
 * The submit row shared by the organization forms: one button, one error, one
 * confirmation, always in the same place.
 *
 * `role="alert"` on the error and `role="status"` on the confirmation, because
 * a form that silently succeeded is a form a screen-reader user has to go
 * hunting through to find out whether it worked. The confirmation is a word
 * rather than a toast — a toast that has already faded is indistinguishable
 * from one that never fired.
 *
 * Rendered only when the viewer can edit. A save button that is permanently
 * disabled says "try again later"; its absence, next to disabled fields, says
 * what is actually true.
 */
export default function SaveBar({
  saving,
  saved,
  error,
  canEdit,
  label = "Save changes",
}: {
  saving: boolean;
  saved: boolean;
  error: string | null;
  canEdit: boolean;
  label?: string;
}) {
  return (
    <>
      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? "Saving…" : label}
          </Button>
          {saved && (
            <span role="status" className="text-body text-success">
              Saved.
            </span>
          )}
        </div>
      )}
    </>
  );
}
