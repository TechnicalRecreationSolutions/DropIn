import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityGridCard from "@/components/facilities/FacilityGridCard";
import Streamed from "@/components/ui/streamed";

/**
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * Note that the Suspense boundary below has to live *inside* this page. The
 * one in the dashboard layout covers a fresh page load, but when navigating
 * here from a sibling route the shared layout is the entry point and anything
 * above it has already rendered — a boundary up there would never fire.
 */
export const instant = true;

type FacilityRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  province: string;
  is_published: boolean;
  photo_urls: string[];
  departments: { id: string }[];
  schedule_groups: { id: string }[];
};

export default function FacilitiesPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
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

      <Suspense fallback={<FacilitiesGridSkeleton />}>
        <Streamed className="space-y-6">
          <FacilitiesGrid />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function FacilitiesGrid() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: facilities } = await supabase
    .from("facilities")
    .select(
      "id, slug, name, city, province, is_published, photo_urls, departments(id), schedule_groups(id)"
    )
    .eq("org_id", orgContext.org.id)
    .order("created_at", { ascending: false }) as unknown as { data: FacilityRow[] | null };

  const gridFacilities = (facilities ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    city: f.city,
    province: f.province,
    is_published: f.is_published,
    photo_urls: f.photo_urls,
    department_count: f.departments.length,
    schedule_count: f.schedule_groups.length,
  }));

  if (gridFacilities.length === 0) {
    return (
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
    );
  }

  // Rendered here rather than in a client component. This used to be a
  // grid/map toggle, and the map half plotted the org's own buildings with
  // mapbox-gl — the same library the cross-org search page used. A centre with
  // a handful of sites does not need them plotted geographically, and keeping
  // that view meant keeping a paid dependency, its token, address geocoding on
  // every save, and two extra origins in the CSP. With the toggle gone there is
  // no client state left to hold: FacilityGridCard is a plain link.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {gridFacilities.map((facility) => (
        <FacilityGridCard key={facility.id} facility={facility} />
      ))}
    </div>
  );
}

function FacilitiesGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-56 rounded-xl" />
      ))}
    </div>
  );
}
