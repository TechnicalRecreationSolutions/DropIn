import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { departmentsHref } from "@/lib/schedule/commandCentreHref";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import DepartmentsPanel from "@/components/department/DepartmentsPanel";

interface DepartmentsPageProps {
  searchParams: Promise<{ facility?: string }>;
}

/**
 * The dedicated Departments page — groups of related schedules within a
 * building, scoped to one facility at a time. Departments used to have their
 * own detail page under facilities/[facilityId]/departments/[departmentId],
 * which is now a redirect into the schedule command centre; this is where
 * their name/description/publish state and deletion are actually managed,
 * matching Spaces and Sessions each getting their own top-level route.
 */
export default async function DepartmentsPage({ searchParams }: DepartmentsPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  const [{ data: facilityRows }, { data: departmentRows }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, city, province, is_published, photo_urls")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name, description, is_published, facility_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }),
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];

  const departments = (departmentRows ?? [])
    .filter((d) => d.facility_id === facility.id)
    .map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      is_published: d.is_published,
    }));

  const facilityCards = facilityRows.map((f) => {
    const count = (departmentRows ?? []).filter((d) => d.facility_id === f.id).length;
    return { ...f, meta: `${count} department${count !== 1 ? "s" : ""}` };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Departments</h1>
        <p className="text-gray-500 mt-1">
          Group related schedules together within a building — e.g. Aquatics, Fitness.
        </p>
      </div>

      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={facility.id}
        hrefFor={departmentsHref}
      />

      <DepartmentsPanel facility={facility} departments={departments} />
    </div>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-medium text-gray-900 mb-1">No buildings yet</h1>
        <p className="text-sm text-gray-500 mb-4">
          Add a facility first — departments belong to a building.
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
