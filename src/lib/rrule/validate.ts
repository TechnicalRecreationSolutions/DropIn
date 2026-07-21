import { RRule } from "rrule";

/** Returns true if the RRULE string is parseable and valid */
export function isValidRRule(rruleStr: string): boolean {
  try {
    RRule.fromString(rruleStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts the RRuleBuilder form values into an RRULE string.
 * Days use iCal two-letter codes: MO TU WE TH FR SA SU
 */
export function buildRRuleString(options: {
  frequency: "daily" | "weekly";
  days?: string[]; // iCal day codes — required for weekly
  interval?: number;
}): string {
  const { frequency, days = [], interval = 1 } = options;

  if (frequency === "daily") {
    return interval === 1 ? "FREQ=DAILY" : `FREQ=DAILY;INTERVAL=${interval}`;
  }

  const byDay = days.length > 0 ? `;BYDAY=${days.join(",")}` : "";
  const intervalPart = interval > 1 ? `;INTERVAL=${interval}` : "";
  return `FREQ=WEEKLY${intervalPart}${byDay}`;
}
