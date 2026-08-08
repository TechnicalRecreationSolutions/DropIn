import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { geocodeAddress } from "@/lib/maps/geocode";
import { slugify } from "@/lib/utils/slugify";

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
  facilityId: z.string().uuid().optional(), // present on edit
});

/**
 * POST /api/facilities — create or update a facility.
 * Geocodes the address server-side before writing to DB so lat/lng
 * are always populated when an address is provided.
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

  // Geocode the address
  const coords = await geocodeAddress(
    fields.address_line1,
    fields.city,
    fields.province,
    fields.country
  );

  const payload = {
    ...fields,
    org_id: membership.org_id,
    slug: slugify(fields.name),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    // PostGIS point — only set if we have coords
    ...(coords ? { location: `POINT(${coords.lng} ${coords.lat})` } : {}),
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
