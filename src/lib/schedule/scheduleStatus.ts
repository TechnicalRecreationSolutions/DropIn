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
  unfinished: { label: "Unfinished", className: "border-transparent bg-muted text-foreground" },
  active: { label: "Active", className: "border-transparent bg-brand-subtle text-brand-strong" },
  modified: { label: "Modified", className: "border-transparent bg-warning-subtle text-warning" },
  published: { label: "Published", className: "border-transparent bg-success-subtle text-success" },
  stored: { label: "Stored", className: "border-transparent bg-muted text-muted-foreground" },
};
