"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The save half of every organization settings form.
 *
 * `PATCH /api/organizations` takes a subset — every field in its schema is
 * optional — so the General, Contact and Permissions pages each send only what
 * they own. That is what lets one endpoint serve three forms without any of
 * them clobbering a field it does not render, which is exactly what a single
 * whole-object PUT would have done the first time two people had two settings
 * pages open.
 *
 * ## `saving` is reset in a `finally`
 *
 * Under `cacheComponents` a route segment is HIDDEN rather than unmounted when
 * you navigate away, so a form comes back with its state intact. A `saving`
 * flag left true by a thrown fetch is a button that says "Saving…" forever,
 * for the rest of the session, and no reload the person performs will clear it
 * because they never left the page. See `feedback_activity_preserves_form_state`.
 *
 * ## `router.refresh()` on success
 *
 * The org name and logo render in the dashboard chrome, on every public
 * facility page and in the embeddable widget. Without the refresh they stay
 * stale until the next hard load, and the person who just renamed their
 * organization watches the old name sit in the sidebar.
 */
export function useOrgPatch() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Call from any onChange, so "Saved." disappears the moment it stops being true. */
  const touch = () => setSaved(false);

  // Generic rather than `Record<string, unknown>`: an interface declared with
  // named fields (OrgContactValues) has no index signature, so it is NOT
  // assignable to that record type, and the three callers would each have had
  // to spread or cast at the call site to work around a constraint that buys
  // nothing here.
  async function save<T extends object>(patch: T): Promise<boolean> {
    setError(null);
    setSaved(false);
    setSaving(true);

    try {
      const res = await fetch("/api/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save your settings.");
        return false;
      }

      setSaved(true);
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { save, saving, saved, error, touch, setError };
}

/** The field and label classes every organization form shares. */
export const orgFieldClass =
  "w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-muted disabled:text-muted-foreground";

export const orgLabelClass = "block text-sm font-medium text-foreground mb-1";
