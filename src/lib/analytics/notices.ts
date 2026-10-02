import type { createClient } from "@/lib/supabase/server";
import type { FacilityNotice } from "@/types/app.types";
import { rangeEndInstant, rangeStartInstant, type AnalyticsRange } from "./range";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Status notice history for Analytics › Status history (2026-10-01).
 *
 * Until then a facility's finished notices were a folded "History" list at the
 * bottom of its status page, capped at 20 and one building at a time. The user
 * moved it here: the status page answers "what is wrong now", and "how often
 * was the pool closed this term" is an analysis question, with a period, a
 * facility filter and an export like every other one in this section.
 *
 * ## Which notices are "in" a period
 *
 * Every notice whose window OVERLAPS it — started before the period ended, and
 * not cleared before it began. A closure running from the 30th into the 2nd
 * belongs to both months; filtering on `starts_at` alone would drop it from the
 * second, which is the month somebody asks about.
 *
 * Staff reports that were never published (063, `needs_review`) are left out.
 * They were never true for the public, and a rejected report is not history.
 * Drafts are left out for the same reason.
 */

/** Plenty for a period's history; the page says so if a period has more. */
const MAX_ROWS = 500;

export interface NoticeHistoryResult {
  notices: FacilityNotice[];
  truncated: boolean;
}

export async function fetchNoticeHistory(
  supabase: SupabaseServerClient,
  {
    orgId,
    range,
    facilityId,
    facilityIds,
  }: {
    orgId: string;
    range: AnalyticsRange;
    facilityId?: string | null;
    /** Restrict to the facilities a scoped staffer holds. Empty means unscoped. */
    facilityIds?: string[];
  }
): Promise<NoticeHistoryResult> {
  let query = supabase
    .from("facility_notices")
    // `*` so the 063/064 columns arrive where they exist and the read still
    // works where they do not (migrations here are applied by hand).
    .select("*")
    .eq("org_id", orgId)
    .eq("is_published", true)
    .lt("starts_at", rangeEndInstant(range))
    .or(`ends_at.is.null,ends_at.gte.${rangeStartInstant(range)}`)
    .order("starts_at", { ascending: false })
    // One more than we keep, so `truncated` can tell "more than 500" from
    // "exactly 500". Kept under PostgREST's silent 1000-row cap on purpose.
    .limit(MAX_ROWS + 1);

  if (facilityId) query = query.eq("facility_id", facilityId);
  else if (facilityIds && facilityIds.length > 0) query = query.in("facility_id", facilityIds);

  const { data } = await query;
  const rows = ((data ?? []) as FacilityNotice[]).filter((n) => n.needs_review !== true);
  return { notices: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

/** How long a notice was in force, in minutes. One still running counts to `now`. */
export function noticeDurationMinutes(
  notice: Pick<FacilityNotice, "starts_at" | "ends_at">,
  now: Date = new Date()
): number {
  const start = new Date(notice.starts_at).getTime();
  const end = notice.ends_at ? new Date(notice.ends_at).getTime() : now.getTime();
  return Math.max(0, Math.round((Math.min(end, now.getTime()) - start) / 60_000));
}
