import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ScheduleGroupForm from "@/components/schedule-group/ScheduleGroupForm";
import { PageHeader } from "@/components/ui/info-tip";

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
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: "New schedule" },
        ]}
      />
      <div className="mb-6">
        <PageHeader title="Add a schedule" info="A named activity, such as Lane Swim, with its own cost and recurring sessions. Departments are optional." />
      </div>
      <ScheduleGroupForm
        facilityId={facilityId}
      />
    </div>
  );
}
