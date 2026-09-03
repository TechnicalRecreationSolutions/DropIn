import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ScheduleGroupForm from "@/components/schedule-group/ScheduleGroupForm";

interface EditScheduleGroupPageProps {
  params: Promise<{ facilityId: string; departmentId: string; scheduleGroupId: string }>;
}

export default async function EditScheduleGroupPage({ params }: EditScheduleGroupPageProps) {
  const { facilityId, departmentId, scheduleGroupId } = await params;
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

  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, name, sport_category, cost_cents, status, starts_on, ends_on")
    .eq("id", scheduleGroupId)
    .eq("department_id", departmentId)
    .single();

  if (!scheduleGroup) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: scheduleGroup.name },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Edit schedule</h1>
        <p className="text-muted-foreground mt-1">Update this schedule&apos;s details.</p>
      </div>
      <ScheduleGroupForm
        facilityId={facilityId}
        departmentId={departmentId}
        scheduleGroupId={scheduleGroupId}
        defaultValues={{
          name: scheduleGroup.name,
          sport_category: scheduleGroup.sport_category,
          cost_cents: scheduleGroup.cost_cents,
          status: scheduleGroup.status,
          starts_on: scheduleGroup.starts_on,
          ends_on: scheduleGroup.ends_on,
        }}
      />
    </div>
  );
}
