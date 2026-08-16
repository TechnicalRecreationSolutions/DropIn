import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ScheduleGroupForm from "@/components/schedule-group/ScheduleGroupForm";

interface NewScheduleGroupPageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

export default async function NewScheduleGroupPage({ params }: NewScheduleGroupPageProps) {
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

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: "New schedule" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a schedule</h1>
        <p className="text-gray-500 mt-1">
          A schedule is a named activity your facility runs (e.g. &quot;Lane Swim&quot;) with its own cost
          and recurring sessions.
        </p>
      </div>
      <ScheduleGroupForm
        facilityId={facilityId}
        departmentId={departmentId}
      />
    </div>
  );
}
