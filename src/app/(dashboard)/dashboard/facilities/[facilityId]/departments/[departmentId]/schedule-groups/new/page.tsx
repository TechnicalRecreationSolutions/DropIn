import { notFound, redirect } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import ScheduleGroupForm from "@/components/schedule-group/ScheduleGroupForm";
import { PageHeader } from "@/components/ui/info-tip";

interface NewScheduleGroupPageProps {
  params: Promise<{ facilityId: string; departmentId: string }>;
}

export default async function NewScheduleGroupPage({ params }: NewScheduleGroupPageProps) {
  const { facilityId, departmentId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

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
        <PageHeader title="Add a schedule" info="A named activity, such as Lane Swim, with its own cost and recurring sessions." />
      </div>
      <ScheduleGroupForm
        facilityId={facilityId}
        departmentId={departmentId}
      />
    </div>
  );
}
