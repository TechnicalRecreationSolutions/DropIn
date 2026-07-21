import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus, MapPin, Eye, EyeOff } from "lucide-react";

export default async function FacilitiesPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  type FacilityRow = {
    id: string; name: string; city: string; province: string;
    is_published: boolean; programs: { id: string }[];
  };
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name, city, province, is_published, programs(id)")
    .eq("org_id", orgContext.org.id)
    .order("created_at", { ascending: false }) as unknown as { data: FacilityRow[] | null };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facilities</h1>
          <p className="text-gray-500 mt-1">Physical locations where your programs run.</p>
        </div>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add facility
        </Link>
      </div>

      {!facilities || facilities.length === 0 ? (
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
        <div className="space-y-3">
          {facilities.map((facility) => (
            <Link
              key={facility.id}
              href={`/dashboard/facilities/${facility.id}`}
              className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{facility.name}</p>
                <p className="text-sm text-gray-500 truncate">
                  {facility.city}, {facility.province} · {facility.programs?.length ?? 0} program{(facility.programs?.length ?? 0) !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {facility.is_published ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                    <Eye className="w-3 h-3" /> Published
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    <EyeOff className="w-3 h-3" /> Draft
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
