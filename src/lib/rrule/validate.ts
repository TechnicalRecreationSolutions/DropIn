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

/** How often a session repeats. "once" is a single-occurrence event, not a series. */
export type RRuleFrequency = "once" | "daily" | "weekly";

/**
 * A single-occurrence rule.
 *
 * Everything in this app is stored as an RRULE, including things that happen
 * exactly once — Halloween Howl, a pool closure, a season launch. Rather than
 * introduce a second representation for "not recurring" (which every consumer,
 * from expandSessions to session_exceptions to the drag handler, would then
 * have to branch on), a one-off is a daily rule capped at one occurrence.
 *
 * `COUNT=1` rather than an UNTIL date, because UNTIL has to be expressed as a
 * UTC instant and would therefore need the session's timezone to be correct —
 * a whole class of off-by-one-day bugs for something that means "just this
 * once". The occurrence lands on DTSTART either way.
 */
export const ONCE_RRULE = "FREQ=DAILY;COUNT=1";

/** True when this rule produces exactly one occurrence. */
export function isOneTimeRRule(rruleStr: string): boolean {
  return /(^|;)COUNT=1(;|$)/.test(rruleStr);
}

/**
 * Converts the RRuleBuilder form values into an RRULE string.
 * Days use iCal two-letter codes: MO TU WE TH FR SA SU
 */
export function buildRRuleString(options: {
  frequency: RRuleFrequency;
  days?: string[]; // iCal day codes — required for weekly
  interval?: number;
}): string {
  const { frequency, days = [], interval = 1 } = options;

  // A one-off ignores days and interval entirely — there is no second
  // occurrence for them to describe.
  if (frequency === "once") return ONCE_RRULE;

  if (frequency === "daily") {
    return interval === 1 ? "FREQ=DAILY" : `FREQ=DAILY;INTERVAL=${interval}`;
  }

  const byDay = days.length > 0 ? `;BYDAY=${days.join(",")}` : "";
  const intervalPart = interval > 1 ? `;INTERVAL=${interval}` : "";
  return `FREQ=WEEKLY${intervalPart}${byDay}`;
}
