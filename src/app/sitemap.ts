import type { MetadataRoute } from "next";
import { getDirectoryListings } from "@/lib/directory/listings";
import { SITE_URL } from "@/lib/seo/siteUrl";

/**
 * The public pages worth finding, plus every facility in the directory.
 *
 * Only *listed* facilities (migration 052). A published but unlisted facility
 * still has an indexable page — the centre published it for its own site —
 * but this sitemap is Dropin promoting it, and that is what listing opts in
 * to. The list is the same cached read /find uses, so a facility save
 * refreshes both.
 *
 * No lastModified on facilities: the directory contract carries no
 * timestamp, and a made-up one is worse for crawlers than none.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/find`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // A failed read drops the facilities for this revalidation rather than
  // failing the sitemap; the next one (a minute later) puts them back.
  const listings = await getDirectoryListings().catch((err: unknown) => {
    console.error("[sitemap]", err instanceof Error ? err.message : err);
    return [];
  });

  return [
    ...pages,
    ...listings.map((f) => ({
      url: `${SITE_URL}${f.path}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
