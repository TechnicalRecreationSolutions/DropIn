import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, Eye, EyeOff, Palette, LayoutGrid } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { Button } from "@/components/ui/button";
import AddDataMenu from "@/components/data-entry/AddDataMenu";
import ScheduleGroupScheduleClient from "@/components/schedule-group/ScheduleGroupScheduleClient";

interface ScheduleGroupDetailPageProps {
  params: Promise<{ facilityId: string; departmentId: string; scheduleGroupId: string }>;
}

type ScheduleGroupRow = {
  id: string;
  name: string;
  sport_category: string;
  is_published: boolean;
};

export default async function ScheduleGroupDetailPage({ params }: ScheduleGroupDetailPageProps) {
  const { facilityId, departmentId, scheduleGroupId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single() as unknown as { data: { id: string; name: string } | null };

  if (!facility) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: department } = await (supabase as any)
    .from("departments")
    .select("id, name")
    .eq("id", departmentId)
    .eq("facility_id", facilityId)
    .single() as { data: { id: string; name: string } | null };

  if (!department) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scheduleGroup } = await (supabase as any)
    .from("schedule_groups")
    .select("id, name, sport_category, is_published")
    .eq("id", scheduleGroupId)
    .eq("department_id", departmentId)
    .single() as { data: ScheduleGroupRow | null };

  if (!scheduleGroup) notFound();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: scheduleGroup.name },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            {scheduleGroup.name}
            {scheduleGroup.is_published ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                <Eye className="w-3 h-3" /> Published
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                <EyeOff className="w-3 h-3" /> Draft
              </span>
            )}
          </h1>
          <p className="text-gray-500 mt-1">{scheduleGroup.sport_category} · {facility.name} › {department.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="lg" asChild>
            <Link href={`/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/${scheduleGroupId}/builder`}>
              <LayoutGrid />
              Open builder
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={`/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/${scheduleGroupId}/session-templates`}>
              <Palette />
              Session templates
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href={`/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/${scheduleGroupId}/edit`}>
              <Pencil />
              Edit schedule
            </Link>
          </Button>
          <AddDataMenu
            manualHref={`/dashboard/sessions/new?scheduleGroupId=${scheduleGroupId}`}
            manualLabel="Add session"
            facilityId={facilityId}
            facilityName={facility.name}
            departmentId={departmentId}
            departmentName={department.name}
            showImport={false}
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">This week</h2>
        <ScheduleGroupScheduleClient scheduleGroupId={scheduleGroupId} />
      </div>
    </div>
  );
}
