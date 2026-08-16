/**
 * Derives the schedule list's five-state status from schedule_groups'
 * two-state `status` column plus its dates and modification timestamps.
 * Nothing here is stored — draft/published/starts_on/ends_on/updated_at/
 * published_at are the only source of truth (see migration 035 for why
 * published_at exists and how it's kept from drifting on ordinary reads).
 */

export type ScheduleListStatus = "unfinished" | "modified" | "active" | "published" | "stored";

export interface ScheduleStatusInput {
  status: "draft" | "published";
  startsOn: string | null;
  endsOn: string | null;
  updatedAt: string;
  publishedAt: string | null;
}

/**
 * `today` is an explicit YYYY-MM-DD string (see lib/utils/dates.ts
 * localDateString) rather than `new Date()` computed inside this function —
 * every row in a list has to compare against the exact same "today", and a
 * caller-supplied value keeps that true without this module reaching for
 * the clock itself.
 */
export function deriveScheduleStatus(sg: ScheduleStatusInput, today: string): ScheduleListStatus {
  if (sg.status === "draft") return "unfinished";

  // A null end is open-ended, i.e. never stored on date grounds alone.
  if (sg.endsOn && sg.endsOn < today) return "stored";

  // Takes priority over active/published: a published schedule that's been
  // touched since is the one staff most need to notice, regardless of
  // whether it's live yet.
  if (sg.publishedAt && sg.updatedAt > sg.publishedAt) return "modified";

  if (!sg.startsOn || sg.startsOn <= today) return "active";

  return "published";
}

export const SCHEDULE_STATUS_META: Record<
  ScheduleListStatus,
  { label: string; className: string }
> = {
  unfinished: { label: "Unfinished", className: "bg-gray-100 text-gray-600 border-gray-200" },
  active: { label: "Active", className: "bg-blue-50 text-blue-700 border-blue-200" },
  modified: { label: "Modified", className: "bg-amber-50 text-amber-700 border-amber-200" },
  published: { label: "Published", className: "bg-green-50 text-green-700 border-green-200" },
  stored: { label: "Stored", className: "bg-gray-50 text-gray-400 border-gray-200" },
};
