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
    .select("id, name, sport_category, activity_type, age_group, skill_level, cost_cents, cost_notes, description, max_participants, is_published")
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
        <h1 className="text-2xl font-bold text-gray-900">Edit schedule</h1>
        <p className="text-gray-500 mt-1">Update this schedule&apos;s details.</p>
      </div>
      <ScheduleGroupForm
        orgId={orgContext.org.id}
        facilityId={facilityId}
        departmentId={departmentId}
        scheduleGroupId={scheduleGroupId}
        defaultValues={{
          name: scheduleGroup.name,
          sport_category: scheduleGroup.sport_category,
          activity_type: scheduleGroup.activity_type,
          age_group: scheduleGroup.age_group ?? undefined,
          skill_level: scheduleGroup.skill_level ?? undefined,
          cost_cents: scheduleGroup.cost_cents,
          cost_notes: scheduleGroup.cost_notes ?? "",
          description: scheduleGroup.description ?? "",
          max_participants: scheduleGroup.max_participants,
          is_published: scheduleGroup.is_published,
        }}
        // Settings are reached from the command centre, so saving returns there
        // with this schedule still in scope.
        redirectTo={commandCentreHref({ facilityId, departmentId, scheduleGroupId })}
      />
    </div>
  );
}
