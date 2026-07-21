import { RRule } from "rrule";

/**
 * Converts an RRULE string into a human-readable description.
 * Examples:
 *   "FREQ=WEEKLY;BYDAY=MO,WE,FR" → "Every Mon, Wed, Fri"
 *   "FREQ=DAILY"                 → "Every day"
 *   "FREQ=WEEKLY;BYDAY=SA,SU"   → "Every Sat, Sun"
 */
export function formatRRule(rruleStr: string, dtstart: string): string {
  try {
    const rule = RRule.fromString(
      `DTSTART:${new Date(dtstart).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\n${rruleStr}`
    );
    return rule.toText();
  } catch {
    return rruleStr;
  }
}

/**
 * Returns the next N upcoming occurrences for display in the dashboard.
 */
export function getUpcomingOccurrences(
  rruleStr: string,
  dtstart: string,
  count = 5
): Date[] {
  try {
    const rule = RRule.fromString(
      `DTSTART:${new Date(dtstart).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\n${rruleStr}`
    );
    return rule.all((_, i) => i < count);
  } catch {
    return [];
  }
}
