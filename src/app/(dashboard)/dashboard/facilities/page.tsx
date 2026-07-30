import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, MapPin } from "lucide-react";
import FacilitiesGridClient from "./FacilitiesGridClient";

type FacilityRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  province: string;
  is_published: boolean;
  photo_urls: string[];
  lat: number | null;
  lng: number | null;
  departments: { id: string }[];
  schedule_groups: { id: string }[];
};

export default async function FacilitiesPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: facilities } = await supabase
    .from("facilities")
    .select(
      "id, slug, name, city, province, is_published, photo_urls, lat, lng, departments(id), schedule_groups(id)"
    )
    .eq("org_id", orgContext.org.id)
    .order("created_at", { ascending: false }) as unknown as { data: FacilityRow[] | null };

  const gridFacilities = (facilities ?? []).map((f) => ({
    id: f.id,
    slug: f.slug,
    name: f.name,
    city: f.city,
    province: f.province,
    is_published: f.is_published,
    photo_urls: f.photo_urls,
    lat: f.lat,
    lng: f.lng,
    department_count: f.departments.length,
    schedule_count: f.schedule_groups.length,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facilities</h1>
          <p className="text-gray-500 mt-1">Physical locations where your schedules run.</p>
        </div>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add facility
        </Link>
      </div>

      {gridFacilities.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No facilities yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Add a facility to start building your schedule.
          </p>
          <Link
            href="/dashboard/facilities/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add your first facility
          </Link>
        </div>
      ) : (
        <FacilitiesGridClient facilities={gridFacilities} />
      )}
    </div>
  );
}
