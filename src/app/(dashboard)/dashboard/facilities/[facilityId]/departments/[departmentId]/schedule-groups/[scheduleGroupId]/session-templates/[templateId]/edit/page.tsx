import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface EditSessionTemplatePageProps {
  params: Promise<{ facilityId: string; departmentId: string; scheduleGroupId: string; templateId: string }>;
}

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  session_template_spaces: { space_id: string }[];
};

export default async function EditSessionTemplatePage({ params }: EditSessionTemplatePageProps) {
  const { facilityId, departmentId, scheduleGroupId, templateId } = await params;
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

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: template } = await supabase
    .from("session_templates")
    .select("id, name, color, default_duration_minutes, session_template_spaces ( space_id )")
    .eq("id", templateId)
    .eq("schedule_group_id", scheduleGroupId)
    .single() as unknown as { data: SessionTemplateRow | null };

  if (!template) notFound();

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true });

  const scheduleGroupHref = `/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/${scheduleGroupId}`;
  const listHref = `${scheduleGroupHref}/session-templates`;

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: scheduleGroup.name, href: scheduleGroupHref },
          { label: "Session templates", href: listHref },
          { label: template.name },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit session template</h1>
        <p className="text-gray-500 mt-1">
          Changes apply going forward — sessions already placed from this template keep their own
          settings.
        </p>
      </div>

      <SessionTemplateForm
        scheduleGroupId={scheduleGroupId}
        templateId={template.id}
        spaces={spaces ?? []}
        defaultValues={{
          name: template.name,
          color: template.color,
          default_duration_minutes: template.default_duration_minutes,
          default_space_ids: template.session_template_spaces.map((r) => r.space_id),
        }}
        redirectTo={listHref}
      />
    </div>
  );
}
