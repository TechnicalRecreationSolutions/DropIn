import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
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
 * The address is stored as text and never geocoded; see the note at the payload
 * below for why coordinates stopped having a reader.
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

  // No geocoding. Coordinates existed for one reader: the Mapbox pin map on the
  // cross-org search page, which was the aggregator product. Dropin is a tool a
  // centre uses to publish its own schedule, so nothing plots facilities against
  // each other on a map, and an address is displayed as text.
  //
  // The lat/lng/location columns are left in place rather than migrated away —
  // they cost nothing empty, and dropping them is the kind of irreversible step
  // that should wait until the shape of the product has settled.
  const payload = {
    ...fields,
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
