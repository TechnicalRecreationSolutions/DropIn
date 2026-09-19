import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { DIRECTORY_CACHE_TAG } from "@/lib/cache/tags";
import { getSportCategory } from "@/lib/utils/sport-categories";
import type { DirectoryFacility } from "./types";

/**
 * Hard ceiling on one directory read. v1 hands the whole listed set to the
 * caller and filters in memory, which is right for dozens of centres and wrong
 * for thousands. Hitting this is the signal to move search into Postgres (the
 * `location` column is already kept for it, migration 052), not to raise it.
 */
const MAX_LISTINGS = 1000;

/**
 * Every facility in the public directory, fully shaped. Identical for every
 * caller, so it is cached and shared: traffic on /find or the API costs no
 * database reads beyond one refresh a minute.
 *
 * Uses the cookie-free public client, so RLS answers as a resident would.
 * Listed means `is_published AND listed_in_directory` (migration 052), and the
 * owning organization must be active — `organizations_public` only returns
 * active orgs, so a pending or suspended org's buildings drop out here — and
 * verified (`is_verified`, migration 057).
 *
 * `POST /api/facilities` and `DELETE /api/facilities/[id]` expire the tag, so
 * opting in or out shows at once. A schedule being published or ended changes
 * a facility's sports and is picked up by the one-minute revalidation instead.
 */
export async function getDirectoryListings(): Promise<DirectoryFacility[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(DIRECTORY_CACHE_TAG);

  const supabase = createPublicClient();

  const { data: facilities, error } = await supabase
    .from("facilities")
    .select(
      "id, slug, name, description, address_line1, city, province, postal_code, lat, lng, phone, website_url, photo_urls, org_id"
    )
    .eq("is_published", true)
    .eq("listed_in_directory", true)
    .order("name")
    .limit(MAX_LISTINGS);

  // Thrown rather than returned empty: an empty directory would be cached and
  // served as if no centre were listed.
  if (error) throw new Error(`directory: facilities read failed: ${error.message}`);
  if (!facilities?.length) return [];
  if (facilities.length === MAX_LISTINGS) {
    console.warn(`[directory] hit the ${MAX_LISTINGS}-facility ceiling; move search into Postgres`);
  }

  const facilityIds = facilities.map((f) => f.id);
  const orgIds = [...new Set(facilities.map((f) => f.org_id))];

  // A schedule that ended yesterday or earlier no longer advertises its sport.
  // Dates are wall-clock (migration 034 removed time zones) and this runs in
  // UTC, so allow one day of slack rather than hide a schedule on its last day.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [groupsRes, orgsRes] = await Promise.all([
    supabase
      .from("schedule_groups")
      .select("facility_id, sport_category")
      .in("facility_id", facilityIds)
      .eq("status", "published")
      .or(`ends_on.is.null,ends_on.gte.${cutoff}`),
    supabase
      .from("organizations_public")
      .select("id, name, logo_url, is_verified")
      .in("id", orgIds),
  ]);
  if (groupsRes.error) throw new Error(`directory: schedule groups read failed: ${groupsRes.error.message}`);
  if (orgsRes.error) throw new Error(`directory: organizations read failed: ${orgsRes.error.message}`);

  const sportsByFacility = new Map<string, Set<string>>();
  for (const g of groupsRes.data ?? []) {
    const set = sportsByFacility.get(g.facility_id) ?? new Set<string>();
    set.add(g.sport_category);
    sportsByFacility.set(g.facility_id, set);
  }
  const orgsById = new Map((orgsRes.data ?? []).map((o) => [o.id, o]));

  return facilities.flatMap((f): DirectoryFacility[] => {
    const org = orgsById.get(f.org_id);
    // Unverified orgs stay out: listing is Dropin vouching that this account
    // really runs the centre it names (migration 057).
    if (!org?.name || !org.is_verified) return [];

    const sports = [...(sportsByFacility.get(f.id) ?? [])]
      .map((id) => ({ id, label: getSportCategory(id)?.label ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [
      {
        id: f.id,
        slug: f.slug,
        name: f.name,
        description: f.description,
        address: {
          line1: f.address_line1,
          city: f.city,
          province: f.province,
          postalCode: f.postal_code,
        },
        location: f.lat !== null && f.lng !== null ? { lat: f.lat, lng: f.lng } : null,
        phone: f.phone,
        websiteUrl: f.website_url,
        photoUrl: f.photo_urls?.[0] ?? null,
        organization: { name: org.name, logoUrl: org.logo_url },
        sports,
        path: `/facility/${f.slug}`,
      },
    ];
  });
}
