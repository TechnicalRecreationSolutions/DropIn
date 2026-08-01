import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ScheduleGroupForm from "@/components/schedule-group/ScheduleGroupForm";

interface NewFacilityScheduleGroupPageProps {
  params: Promise<{ facilityId: string }>;
}

export default async function NewFacilityScheduleGroupPage({ params }: NewFacilityScheduleGroupPageProps) {
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

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: "New schedule" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a schedule</h1>
        <p className="text-gray-500 mt-1">
          A schedule is a named activity your facility runs (e.g. &quot;Lane Swim&quot;) with its own cost,
          age group, and recurring sessions. Departments are optional — pick one below if this
          facility uses them, or leave it as-is.
        </p>
      </div>
      <ScheduleGroupForm
        orgId={orgContext.org.id}
        facilityId={facilityId}
        redirectTo={`/dashboard/facilities/${facilityId}`}
      />
    </div>
  );
}
