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

/**
 * Rentals and closures take their space outright, so they're drawn hatched,
 * as on the printed deck sheet, rather than tinted like something to join.
 */
export const TAKEN_HATCH = "repeating-linear-gradient(135deg, #e7e7ea 0 8px, #f3f3f4 8px 16px)";

export function isTakenSession(session: ExpandedSession): boolean {
  return session.occupancyKind === "rental" || session.occupancyKind === "closure";
}

/**
 * The full surface of a session block in Map, Grid and Board: text colour,
 * tint and border from getSessionCardStyle, then the hatch for taken space.
 * One helper so the three views can't drift apart.
 */
export function getSessionBlockStyle(session: ExpandedSession, isPast: boolean): CSSProperties {
  if (isTakenSession(session) && !isPast) {
    return { backgroundImage: TAKEN_HATCH, backgroundColor: "#f3f3f4", borderColor: "#d9d9de", color: "#3f3f45" };
  }
  return {
    color: isPast ? "#8b8b92" : "var(--org-text-on-tint, #1e3a5f)",
    ...getSessionCardStyle(session, isPast),
  };
}
