import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { slugify } from "@/lib/utils/slugify";
import { addressChanged, geocodeAddress } from "@/lib/geo/geocode";

const FacilitySchema = z.object({
  name: z.string().min(1).max(200),
  address_line1: z.string().min(1),
  city: z.string().min(1),
  province: z.string().min(2).max(2),
  postal_code: z.string().min(1),
  country: z.string().default("CA"),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  website_url: z.string().url().optional().nullable(),
  description: z.string().optional().nullable(),
  is_published: z.boolean().default(false),
  /** Opt-in to the public directory (migration 052). Only honoured while published. */
  listed_in_directory: z.boolean().default(false),
  /**
   * Public URLs into the org-media bucket (migration 030). Element 0 is the
   * cover photo — that is what FacilityGridCard and the public page render.
   *
   * Not validated as belonging to this org's folder: storage RLS already
   * decided who could write there, and a URL is only a pointer. Re-deriving
   * ownership from a string here would be a second, weaker check that drifts.
   */
  photo_urls: z.array(z.string().url()).max(8).default([]),
  facilityId: z.string().uuid().optional(), // present on edit
});

/**
 * POST /api/facilities — create or update a facility.
 *
 * Geocodes the address (Nominatim) when it is new or has changed, so the public
 * directory can sort by distance. A failed lookup never fails the save.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // Verify session
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = FacilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { facilityId, ...fields } = parsed.data;
  const isEditing = !!facilityId;

  // Verify org membership
  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) {
    return NextResponse.json({ error: "No organization found" }, { status: 403 });
  }

  // Look the address up only when it could have moved: always on create; on
  // edit, when an address field changed or the row was never looked up by this
  // geocoder (geocoded_at is NULL — which also replaces coordinates the old
  // Mapbox geocoder left behind, some of them wrong). Re-sending an unchanged
  // address on every save is what Nominatim's usage policy asks us not to do.
  let shouldGeocode = true;
  let moved = true;
  if (isEditing) {
    const { data: existing } = await supabase
      .from("facilities")
      .select("address_line1, city, province, postal_code, country, geocoded_at")
      .eq("id", facilityId)
      .eq("org_id", membership.org_id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
    moved = addressChanged(existing, fields);
    shouldGeocode = moved || !existing.geocoded_at;
  }

  // lat/lng only — the location column follows them by trigger (052).
  //
  // When Nominatim is unreachable, geocoded_at is cleared so the next save
  // retries (an unchanged address would otherwise never be looked up again).
  // Coordinates for an address that just changed are cleared too: none is
  // better than a pin at the old address. For an unchanged address they stay.
  const geocode = shouldGeocode ? await geocodeAddress(fields) : null;
  const now = new Date().toISOString();
  const location: { lat?: number | null; lng?: number | null; geocoded_at?: string | null } =
    geocode === null
      ? {}
      : geocode.status === "found"
        ? { lat: geocode.lat, lng: geocode.lng, geocoded_at: now }
        : geocode.status === "not_found"
          ? { lat: null, lng: null, geocoded_at: now }
          : moved
            ? { lat: null, lng: null, geocoded_at: null }
            : { geocoded_at: null };

  const payload = {
    ...fields,
    ...location,
    org_id: membership.org_id,
    slug: slugify(fields.name),
  };

  const table = supabase.from("facilities");

  if (isEditing) {
    const { error } = await table
      .update(payload)
      .eq("id", facilityId)
      .eq("org_id", membership.org_id);

    if (error) {
      return NextResponse.json(
        { error: error.code === "23505" ? "A facility with that name already exists." : "Failed to update facility." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, facilityId });
  }

  const { data: facility, error } = await table.insert(payload).select("id").single();

  if (error) {
    return NextResponse.json(
      { error: error.code === "23505" ? "A facility with that name already exists." : "Failed to create facility." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, facilityId: facility.id });
}
