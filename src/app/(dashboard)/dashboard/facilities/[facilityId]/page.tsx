import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus, Layers, Eye, EyeOff, Calendar, Pencil, MapPin } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AddDataMenu from "@/components/data-entry/AddDataMenu";
import WidgetConfigurator from "@/components/widget/WidgetConfigurator";
import MapEditorClient from "@/components/facility-maps/MapEditorClient";

interface FacilityDetailPageProps {
  params: Promise<{ facilityId: string }>;
}

type DepartmentRow = {
  id: string;
  name: string;
  is_published: boolean;
  schedule_groups: { id: string }[];
};

type SpaceRow = {
  id: string;
  name: string;
  capacity: number | null;
  is_published: boolean;
  department_id: string | null;
};

export default async function FacilityDetailPage({ params }: FacilityDetailPageProps) {
  const { facilityId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!facility) notFound();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name, is_published, schedule_groups(id)")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true }) as unknown as { data: DepartmentRow[] | null };

  // Schedule groups at this facility with no department — the flexibility
  // fallback for orgs that don't use the department level at all.
  const { data: ungroupedScheduleGroups } = await supabase
    .from("schedule_groups")
    .select("id, name, sport_category, is_published")
    .eq("facility_id", facilityId)
    .is("department_id", null)
    .order("name");

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name, capacity, is_published, department_id")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true });

  // Group spaces by department so the tab reads as sections rather than one
  // long flat list — mirrors the department ordering already fetched above,
  // with a trailing group for spaces that aren't assigned to a department.
  const spacesByDepartment: { id: string | null; name: string | null; spaces: SpaceRow[] }[] = [];
  if (spaces && spaces.length > 0) {
    const deptOrder = departments ?? [];
    for (const dept of deptOrder) {
      const deptSpaces = spaces.filter((s) => s.department_id === dept.id);
      if (deptSpaces.length > 0) {
        spacesByDepartment.push({ id: dept.id, name: dept.name, spaces: deptSpaces });
      }
    }
    const unassigned = spaces.filter((s) => !s.department_id);
    if (unassigned.length > 0) {
      spacesByDepartment.push({ id: null, name: null, spaces: unassigned });
    }
  }

  const hasNothing = (!departments || departments.length === 0)
    && (!ungroupedScheduleGroups || ungroupedScheduleGroups.length === 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{facility.name}</h1>
          <p className="text-gray-500 mt-1">Departments and schedules for this facility.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="lg" asChild>
            <Link href={`/dashboard/facilities/${facilityId}/edit`}>
              <Pencil />
              Edit facility
            </Link>
          </Button>
          <Link
            href={`/dashboard/facilities/${facilityId}/departments/new`}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add department
          </Link>
          <AddDataMenu
            manualHref={`/dashboard/facilities/${facilityId}/schedule-groups/new`}
            facilityId={facilityId}
            facilityName={facility.name}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="spaces">Spaces</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="widget">Widget</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
      {hasNothing ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">Nothing here yet</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
            Add a schedule directly (e.g. &quot;Lane Swim&quot;), or group related schedules into a
            department first (e.g. Aquatics, Fitness) — departments are optional.
          </p>
          <Link
            href={`/dashboard/facilities/${facilityId}/schedule-groups/new`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a schedule
          </Link>
        </div>
      ) : (
        <>
          {departments && departments.length > 0 && (
            <div className="space-y-3">
              {departments.map((dept) => (
                <div
                  key={dept.id}
                  className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <Link
                    href={`/dashboard/facilities/${facilityId}/departments/${dept.id}`}
                    className="flex items-center gap-4 flex-1 min-w-0"
                  >
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                      <Layers className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{dept.name}</p>
                      <p className="text-sm text-gray-500 truncate">
                        {dept.schedule_groups?.length ?? 0} schedule{(dept.schedule_groups?.length ?? 0) !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </Link>
                  {dept.is_published ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                      <Eye className="w-3 h-3" /> Published
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
                      <EyeOff className="w-3 h-3" /> Draft
                    </span>
                  )}
                  <Link
                    href={`/dashboard/facilities/${facilityId}/departments/${dept.id}/edit`}
                    aria-label={`Edit ${dept.name}`}
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                  </Link>
                </div>
              ))}
            </div>
          )}

          {ungroupedScheduleGroups && ungroupedScheduleGroups.length > 0 && (
            <div>
              {departments && departments.length > 0 && (
                <h2 className="text-sm font-semibold text-gray-900 mb-3">Schedules without a department</h2>
              )}
              <div className="space-y-2">
                {ungroupedScheduleGroups.map((sg) => (
                  <div key={sg.id} className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200">
                    <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-900">{sg.name}</span>
                    <span className="text-xs text-gray-400">{sg.sport_category}</span>
                    <span className="ml-auto shrink-0">
                      {sg.is_published ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                          <Eye className="w-3 h-3" /> Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                          <EyeOff className="w-3 h-3" /> Draft
                        </span>
                      )}
                    </span>
                    <Link
                      href={`/dashboard/facilities/${facilityId}/schedule-groups/${sg.id}/edit`}
                      aria-label={`Edit ${sg.name}`}
                      className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
        </TabsContent>

        <TabsContent value="spaces" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Bookable locations within this facility — pool lanes, courts, studios — that sessions
              can be attached to.
            </p>
            <Link
              href={`/dashboard/facilities/${facilityId}/spaces/new`}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add space
            </Link>
          </div>

          {!spaces || spaces.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
              <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="font-medium text-gray-900 mb-1">No spaces yet</h3>
              <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
                Add a space (e.g. &quot;Lane 3&quot;, &quot;Court A&quot;) to give sessions a specific
                location within this facility.
              </p>
              <Link
                href={`/dashboard/facilities/${facilityId}/spaces/new`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add a space
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {spacesByDepartment.map((group) => (
                <div key={group.id ?? "unassigned"}>
                  <h2 className="text-sm font-semibold text-gray-900 mb-3">
                    {group.name ?? "No department"}
                  </h2>
                  <div className="space-y-2">
                    {group.spaces.map((space) => (
                      <div key={space.id} className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200">
                        <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                        <span className="text-sm font-medium text-gray-900 flex-1 min-w-0">{space.name}</span>
                        {space.capacity != null && (
                          <span className="text-xs text-gray-400 shrink-0">Cap. {space.capacity}</span>
                        )}
                        {space.is_published ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                            <Eye className="w-3 h-3" /> Published
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
                            <EyeOff className="w-3 h-3" /> Draft
                          </span>
                        )}
                        <Link
                          href={`/dashboard/facilities/${facilityId}/spaces/${space.id}/edit`}
                          aria-label={`Edit ${space.name}`}
                          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="map" className="pt-4">
          <MapEditorClient
            facilityId={facilityId}
            spaces={(spaces ?? []).map((s) => ({ id: s.id, name: s.name }))}
          />
        </TabsContent>

        <TabsContent value="widget" className="pt-4">
          <WidgetConfigurator
            orgId={orgContext.org.id}
            orgSlug={orgContext.org.slug}
            facilities={[{ id: facilityId, name: facility.name }]}
            lockedFacilityId={facilityId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
