import { createPublicClient } from "@/lib/supabase/public";
import { cacheLife } from "next/cache";

/**
 * Everything the public org surface needs about an organization, in one cached
 * unit — shared by the layout, the events page, and (when Phase D lands) the
 * brochure route.
 *
 * Same shape and reasoning as `getFacilityPageData`: identical for every
 * visitor, so it's cached rather than re-queried per request, and it uses the
 * cookie-free public client because a cached function may not read request
 * data. Calling it from several places in one render costs one query set, not
 * several — which is the point of putting it here rather than inlining it.
 *
 * Reads `organizations_public`, never `organizations`. The base table is
 * members-only (migration 026) because it carries contact and billing columns
 * and RLS cannot restrict columns; the view is the world-readable projection
 * and only exposes active orgs.
 */
export async function getOrgPublicData(orgSlug: string) {
  "use cache";
  cacheLife("hours");

  const supabase = createPublicClient();

  const { data: org } = await supabase
    .from("organizations_public")
    .select("id, name, slug, description, logo_url, website_url, city, province")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!org) return null;

  // The org-wide widget config row (both scope columns NULL) — the same row
  // the embeddable widget falls back to, so a visitor arriving here sees the
  // org's own colours rather than a Dropin-blue page.
  const { data: widgetConfig } = await supabase
    .from("widget_configs")
    .select("primary_color")
    .eq("org_id", org.id)
    .is("facility_id", null)
    .is("department_id", null)
    .maybeSingle();

  return { org, primaryColor: widgetConfig?.primary_color ?? "#0066CC" };
}

/**
 * The org's published buildings, for the org landing page.
 *
 * Split from `getOrgPublicData` rather than folded into it: the events page and
 * the layout never need this list, and a cached function is cached as a whole —
 * merging them would make every org page pay for a query only one of them reads.
 */
export async function getOrgFacilities(orgId: string) {
  "use cache";
  cacheLife("hours");

  const supabase = createPublicClient();

  const { data } = await supabase
    .from("facilities")
    .select("id, name, slug, city, province")
    .eq("org_id", orgId)
    .eq("is_published", true)
    .order("name");

  return data ?? [];
}
