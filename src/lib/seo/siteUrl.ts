/**
 * The absolute origin for anything a crawler reads outside a page's <head>:
 * sitemap entries and the robots.txt Sitemap line. Pages get the same value
 * through `metadataBase` in the root layout, with the same fallback, so the
 * two cannot disagree.
 *
 * NEXT_PUBLIC_APP_URL must be the real production URL (docs/DEPLOYMENT.md);
 * the localhost fallback only makes local builds work.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
