import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapHref } from "@/lib/schedule/commandCentreHref";
import FacilityPicker from "@/components/facilities/FacilityPicker";
import MapEditorClient from "@/components/facility-maps/MapEditorClient";

interface MapPageProps {
  searchParams: Promise<{ facility?: string }>;
}

/**
 * The dedicated floorplan editor — the map visitors see for one building,
 * scoped per facility. Used to be a tab inside the schedule command centre;
 * a floorplan is drawn per building regardless of department, so this page
 * (like the old tab) has no department scope at all.
 */
export default async function MapPage({ searchParams }: MapPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  const [{ data: facilityRows }, { data: spaceRows }] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("spaces").select("id, name, facility_id").eq("org_id", orgId).order("display_order", { ascending: true }),
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];
  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Floorplan</h1>
        <p className="text-gray-500 mt-1">
          The map visitors see for {facility.name}. Drawn per building.
        </p>
      </div>

      <FacilityPicker facilities={facilityRows} activeFacilityId={facility.id} hrefFor={mapHref} />

      {/* Keyed on the facility so switching buildings rebuilds the editor
          rather than leaving the previous building's shapes on canvas. */}
      <MapEditorClient key={facility.id} facilityId={facility.id} spaces={spaces} />
    </div>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-medium text-gray-900 mb-1">No buildings yet</h1>
        <p className="text-sm text-gray-500 mb-4">
          Add a facility first — a floorplan belongs to a building.
        </p>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a facility
        </Link>
      </div>
    </div>
  );
}
