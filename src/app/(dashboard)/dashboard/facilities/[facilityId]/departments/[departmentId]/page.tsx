import { notFound } from "next/navigation";
import Link from "next/link";
import { Calendar, Eye, EyeOff, Pencil, Plus, MapPin } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AddDataMenu from "@/components/data-entry/AddDataMenu";
import WidgetConfigurator from "@/components/widget/WidgetConfigurator";

interface DepartmentDetailPageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

export default async function DepartmentDetailPage({ params }: DepartmentDetailPageProps) {
  const { facilityId, departmentId } = await params;
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

  const { data: department } = await supabase
    .from("departments")
    .select("id, name")
    .eq("id", departmentId)
    .eq("facility_id", facilityId)
    .single();

  if (!department) notFound();

  const { data: scheduleGroups } = await supabase
    .from("schedule_groups")
    .select("id, name, sport_category, is_published")
    .eq("department_id", departmentId)
    .order("display_order", { ascending: true });

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name, capacity, is_published")
    .eq("department_id", departmentId)
    .order("display_order", { ascending: true });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: department.name },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{department.name}</h1>
          <p className="text-gray-500 mt-1">Schedules within this department.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="lg" asChild>
            <Link href={`/dashboard/facilities/${facilityId}/departments/${departmentId}/edit`}>
              <Pencil />
              Edit department
            </Link>
          </Button>
          <AddDataMenu
            manualHref={`/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/new`}
            facilityId={facilityId}
            facilityName={facility.name}
            departmentId={departmentId}
            departmentName={department.name}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="spaces">Spaces</TabsTrigger>
          <TabsTrigger value="widget">Widget</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
      {!scheduleGroups || scheduleGroups.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">No schedules yet</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
            Add a schedule (e.g. &quot;Lane Swim&quot;, &quot;Swim Lessons&quot;) — each has its own cost, age group,
            and recurring sessions.
          </p>
          <Link
            href={`/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/new`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add a schedule
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {scheduleGroups.map((sg) => (
            <div
              key={sg.id}
              className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{sg.name}</p>
                <p className="text-sm text-gray-500 truncate">{sg.sport_category}</p>
              </div>
              {sg.is_published ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                  <Eye className="w-3 h-3" /> Published
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full shrink-0">
                  <EyeOff className="w-3 h-3" /> Draft
                </span>
              )}
              <Link
                href={`/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/${sg.id}/edit`}
                aria-label={`Edit ${sg.name}`}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
              >
                <Pencil className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
      )}
        </TabsContent>

        <TabsContent value="spaces" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Bookable locations within this department that sessions can be attached to.
            </p>
            <Link
              href={`/dashboard/facilities/${facilityId}/spaces/new?departmentId=${departmentId}`}
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
                location within this department.
              </p>
              <Link
                href={`/dashboard/facilities/${facilityId}/spaces/new?departmentId=${departmentId}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add a space
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {spaces.map((space) => (
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
          )}
        </TabsContent>

        <TabsContent value="widget" className="pt-4">
          <WidgetConfigurator
            orgId={orgContext.org.id}
            orgSlug={orgContext.org.slug}
            facilities={[{ id: facilityId, name: facility.name }]}
            lockedFacilityId={facilityId}
            lockedDepartmentId={departmentId}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
