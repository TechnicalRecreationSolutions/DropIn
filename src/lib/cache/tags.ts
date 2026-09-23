/**
 * Cache tags shared between a `"use cache"` reader and the route that expires
 * it. One builder per tag, so the two sides can't drift apart on spelling.
 */

/** Anything cached that includes an org's `widget_configs` row. */
export function widgetConfigCacheTag(orgId: string): string {
  return `widget-config:${orgId}`;
}

/**
 * The public directory's listing set (src/lib/directory/listings.ts). One tag
 * for all of it: a facility opting in or out changes the whole list.
 */
export const DIRECTORY_CACHE_TAG = "directory";

/**
 * The public facility page's cached data, keyed by the slug it was looked up
 * by — including a lookup that found nothing. Tagging by slug rather than id is
 * what lets a save expire a cached "not found" (a facility just published, or
 * renamed onto a slug someone had already visited) as well as the entry under
 * a slug the facility is leaving.
 */
export function facilitySlugCacheTag(slug: string): string {
  return `facility-slug:${slug}`;
}

/**
 * A facility's live public notices (migration 060).
 *
 * Separate from `facilitySlugCacheTag` on purpose, and keyed by **id** rather
 * than slug, because the two entries have opposite lifetimes: the page's body
 * is `cacheLife("hours")` and a notice's is `cacheLife("minutes")`. A notice
 * has to reach patrons within a minute of being posted, and the rest of the
 * page does not change often enough to justify re-querying it that often.
 *
 * Expired by every write in `/api/facilities/[facilityId]/notices`.
 *
 * **It cannot be the only freshness mechanism.** The public read policy in 060
 * depends on `NOW()`, so a notice that expires on its own — one with an
 * `ends_at` in the future — is not a write and produces no expiry. The short
 * cache lifetime is what bounds that, which is why it is minutes and not hours.
 */
export function facilityNoticesCacheTag(facilityId: string): string {
  return `facility-notices:${facilityId}`;
}
