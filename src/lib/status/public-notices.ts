import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { facilityNoticesCacheTag } from "@/lib/cache/tags";
import { sortNotices } from "./notices";
import type { FacilityNotice } from "@/types/app.types";

/** What a public surface needs to draw a notice. No `created_by`, no drafts. */
export type PublicNotice = Pick<
  FacilityNotice,
  "id" | "category" | "severity" | "headline" | "body" | "starts_at" | "ends_at"
> & {
  /** NULL when the notice is about the whole facility. */
  space_name: string | null;
};

/**
 * The notices a patron may see at one facility, right now.
 *
 * ## Why this is its own cache entry
 *
 * The public facility page's body is `cacheLife("hours")` — an address and a
 * description do not change often enough to re-query. A closure does. Joining
 * the two would mean either paying for the address every minute or hiding a
 * contamination for an hour, and the second one is the kind of bug that ends a
 * pilot.
 *
 * So: a separate entry, `cacheLife("minutes")`, tagged by facility id. Every
 * write in `/api/facilities/[facilityId]/notices` expires it, which covers
 * posting, editing, publishing and clearing.
 *
 * ## The one thing a tag cannot cover
 *
 * 060's read policy is a `NOW()` comparison, so a notice with a future
 * `ends_at` stops being public **without anything writing to the database**.
 * No write, no tag expiry. The short `cacheLife` is the only thing bounding
 * that staleness, which is exactly why it is minutes — do not lengthen it
 * without giving scheduled expiry another mechanism.
 *
 * ## It trusts RLS, and says so
 *
 * There is no `.eq("is_published", true)` here and no window filter. The
 * anonymous role's policy already applies all three conditions plus the
 * facility's own published state, and re-stating them in the query would make
 * this the second place that has to stay correct. The harness asserts the
 * policy directly (`verify-az`), where a regression is visible rather than
 * masked by a redundant filter.
 */
export async function getPublicNotices(facilityId: string): Promise<PublicNotice[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(facilityNoticesCacheTag(facilityId));

  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from("facility_notices")
    .select("id, category, severity, headline, body, starts_at, ends_at, spaces(name)")
    .eq("facility_id", facilityId);

  // A failed read must not be cached as "nothing is wrong at this facility".
  // Returning [] here would do exactly that for the next `minutes`, which is
  // the worst possible failure mode for this particular feature — so throw and
  // let the page's error boundary say the page could not load.
  if (error) throw new Error(`Could not load facility notices: ${error.message}`);

  const rows = (data ?? []) as unknown as (Omit<PublicNotice, "space_name"> & {
    spaces: { name: string } | null;
  })[];

  return sortNotices(
    rows.map(({ spaces, ...notice }) => ({ ...notice, space_name: spaces?.name ?? null }))
  );
}
