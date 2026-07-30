import type { CSSProperties } from "react";
import type { ExpandedSession } from "@/types/schedule.types";

/**
 * Resolves the background/border color for a session card in the public
 * schedule views, in order: past-session muted state (always wins — "this
 * already happened" outranks branding), then the session's own template
 * color if staff set one, then the org-brand default tint.
 */
export function getSessionCardStyle(session: ExpandedSession, isPast: boolean): CSSProperties {
  if (isPast) {
    return { backgroundColor: "var(--org-card-past-bg)", borderColor: "var(--org-card-past-border)" };
  }
  if (session.templateColor) {
    return {
      backgroundColor: `color-mix(in srgb, ${session.templateColor} 12%, white)`,
      borderColor: `color-mix(in srgb, ${session.templateColor} 40%, white)`,
    };
  }
  return { backgroundColor: "var(--org-card-bg)", borderColor: "var(--org-card-border)" };
}
