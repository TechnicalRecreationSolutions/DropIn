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
