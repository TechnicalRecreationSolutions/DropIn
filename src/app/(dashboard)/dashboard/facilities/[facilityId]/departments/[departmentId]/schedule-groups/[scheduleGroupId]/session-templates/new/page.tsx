import { notFound } from "next/navigation";
import { commandCentreHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface NewSessionTemplatePageProps {
  params: Promise<{ facilityId: string; departmentId: string; scheduleGroupId: string }>;
}

export default async function NewSessionTemplatePage({ params }: NewSessionTemplatePageProps) {
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
    .select("id, name")
    .eq("id", scheduleGroupId)
    .eq("department_id", departmentId)
    .single();

  if (!scheduleGroup) notFound();

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true });

  // Back to where this schedule is actually worked on.
  const scheduleGroupHref = commandCentreHref({ facilityId, departmentId, scheduleGroupId });
  const listHref = `${scheduleGroupHref}/session-templates`;

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: scheduleGroup.name, href: scheduleGroupHref },
          { label: "Session templates", href: listHref },
          { label: "New template" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New session template</h1>
        <p className="text-gray-500 mt-1">
          Define a reusable activity — its name, color, default duration, and usual space — once,
          then reuse it when building out {scheduleGroup.name}&rsquo;s schedule.
        </p>
      </div>

      <SessionTemplateForm
        scheduleGroupId={scheduleGroupId}
        spaces={spaces ?? []}
        redirectTo={listHref}
      />
    </div>
  );
}
