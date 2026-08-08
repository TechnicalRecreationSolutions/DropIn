import { buildRRuleString } from "@/lib/rrule/validate";

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS = 500;

export interface ImportRow {
  program_name: string;
  sport_category: string;
  activity_type?: string;
  days: string;         // comma-separated: Mon,Wed,Fri
  start_time: string;   // HH:MM
  end_time: string;
  season_start: string; // YYYY-MM-DD
  season_end?: string;
  cost?: string;        // dollars, e.g. "5.00"
  location_detail?: string;
}

export interface ImportPreviewRow extends ImportRow {
  _index: number;
  _errors: string[];
  _rrule: string;
}

const DAY_MAP: Record<string, string> = {
  mon: "MO", tue: "TU", wed: "WE", thu: "TH",
  fri: "FR", sat: "SA", sun: "SU",
  monday: "MO", tuesday: "TU", wednesday: "WE", thursday: "TH",
  friday: "FR", saturday: "SA", sunday: "SU",
};

function parseDays(raw: string): string[] {
  return raw.split(/[,\s]+/)
    .map((d) => DAY_MAP[d.toLowerCase().trim()])
    .filter(Boolean);
}

/**
 * Validates one import row and derives its RRULE.
 *
 * Lives here rather than in the route because /api/import/commit re-runs it.
 * The preview response carries `_errors` and `_rrule`, but those come back from
 * the browser on commit and cannot be trusted — a client that posts
 * `_errors: []` would otherwise have its row written unchecked. Commit
 * recomputes both and ignores whatever the client claimed.
 */
export function validateRow(row: ImportRow, index: number): ImportPreviewRow {
  const errors: string[] = [];

  if (!row.program_name?.trim()) errors.push("program_name is required");
  if (!row.sport_category?.trim()) errors.push("sport_category is required");
  if (!row.days?.trim()) errors.push("days is required (e.g. Mon,Wed,Fri)");
  if (!row.start_time?.match(/^\d{2}:\d{2}$/)) errors.push("start_time must be HH:MM");
  if (!row.end_time?.match(/^\d{2}:\d{2}$/)) errors.push("end_time must be HH:MM");
  if (!row.season_start?.match(/^\d{4}-\d{2}-\d{2}$/)) errors.push("season_start must be YYYY-MM-DD");

  const days = parseDays(row.days ?? "");
  if (days.length === 0 && row.days) errors.push("Could not parse days — use Mon,Tue,Wed etc.");

  const rrule = days.length > 0
    ? buildRRuleString({ frequency: "weekly", days })
    : "";

  return { ...row, _index: index, _errors: errors, _rrule: rrule };
}
