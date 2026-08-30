import Link from "next/link";
import { DoorOpen, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { spacesHref } from "@/lib/schedule/commandCentreHref";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import SpacesPanel from "@/components/space/SpacesPanel";

interface SpacesPageProps {
  searchParams: Promise<{ facility?: string }>;
}

/**
 * The dedicated Spaces page — lanes, courts, studios, scoped to one building
 * at a time. Used to be a tab inside the schedule command centre; now it's
 * its own route so a facility's bookable locations can be managed without
 * detouring through a schedule.
 */
export default async function SpacesPage({ searchParams }: SpacesPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  const [{ data: facilityRows }, { data: spaceRows }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, city, province, is_published, photo_urls")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("spaces")
      .select("id, name, capacity, is_published, facility_id, department_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }),
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];

  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      isPublished: s.is_published,
      departmentId: s.department_id,
    }));

  const facilityCards = facilityRows.map((f) => {
    const count = (spaceRows ?? []).filter((s) => s.facility_id === f.id).length;
    return { ...f, meta: `${count} space${count !== 1 ? "s" : ""}` };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Spaces</h1>
        <p className="text-gray-500 mt-1">
          Bookable locations — lanes, courts, studios — that sessions attach to.
        </p>
      </div>

      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={facility.id}
        hrefFor={spacesHref}
      />

      <SpacesPanel
        facility={{ id: facility.id, name: facility.name, spaces }}
        departmentId={null}
        departmentLabel={null}
      />
    </div>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <DoorOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-medium text-gray-900 mb-1">No buildings yet</h1>
        <p className="text-sm text-gray-500 mb-4">
          Add a facility first — spaces belong to a building.
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
