/**
 * Cache tags shared between a `"use cache"` reader and the route that expires
 * it. One builder per tag, so the two sides can't drift apart on spelling.
 */

/** Anything cached that includes an org's `widget_configs` row. */
export function widgetConfigCacheTag(orgId: string): string {
  return `widget-config:${orgId}`;
}
