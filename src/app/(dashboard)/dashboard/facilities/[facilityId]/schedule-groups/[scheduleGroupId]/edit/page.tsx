import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ScheduleGroupForm from "@/components/schedule-group/ScheduleGroupForm";

interface EditFacilityScheduleGroupPageProps {
  params: Promise<{ facilityId: string; scheduleGroupId: string }>;
}

export default async function EditFacilityScheduleGroupPage({ params }: EditFacilityScheduleGroupPageProps) {
  const { facilityId, scheduleGroupId } = await params;
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

  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, name, sport_category, cost_cents, status, starts_on, ends_on")
    .eq("id", scheduleGroupId)
    .eq("facility_id", facilityId)
    .single();

  if (!scheduleGroup) notFound();

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: scheduleGroup.name },
          { label: "Edit" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit schedule</h1>
        <p className="text-gray-500 mt-1">Update this schedule&apos;s details.</p>
      </div>
      <ScheduleGroupForm
        facilityId={facilityId}
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
