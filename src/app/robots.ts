import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/siteUrl";

/**
 * Crawlers get the public site: the sales page, /find and facility pages.
 *
 * Kept out:
 *  - /dashboard — staff-only, and the print sheets live under it too;
 *  - /api/ — including the public directory API, which is data, not a page;
 *  - /widget/ — the embed. It exists to be framed on a centre's own site, and
 *    indexing it would compete with that site and with /facility/[slug];
 *  - /callback — the auth redirect.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/widget/", "/callback"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
