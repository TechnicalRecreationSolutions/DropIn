import { notFound } from "next/navigation";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface EditSessionTemplatePageProps {
  params: Promise<{ templateId: string }>;
}

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  schedule_group_id: string;
  session_template_spaces: { space_id: string }[];
  schedule_groups: { id: string; name: string; facility_id: string; department_id: string | null } | null;
};

export default async function EditSessionTemplatePage({ params }: EditSessionTemplatePageProps) {
  const { templateId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: template } = await supabase
    .from("session_templates")
    .select(
      "id, name, color, default_duration_minutes, schedule_group_id, session_template_spaces ( space_id ), schedule_groups ( id, name, facility_id, department_id )"
    )
    .eq("id", templateId)
    .eq("org_id", orgContext.org.id)
    .single() as unknown as { data: SessionTemplateRow | null };

  if (!template || !template.schedule_groups) notFound();

  const scheduleGroup = template.schedule_groups;

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name")
    .eq("facility_id", scheduleGroup.facility_id)
    .order("display_order", { ascending: true });

  const redirectTo = sessionsHref({
    facilityId: scheduleGroup.facility_id,
    departmentId: scheduleGroup.department_id ?? NO_DEPARTMENT,
    scheduleGroupId: scheduleGroup.id,
  });

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit session template</h1>
        <p className="text-gray-500 mt-1">
          Changes apply going forward — sessions already placed from this template keep their own
          settings.
        </p>
      </div>

      <SessionTemplateForm
        scheduleGroupId={scheduleGroup.id}
        templateId={template.id}
        spaces={spaces ?? []}
        defaultValues={{
          name: template.name,
          color: template.color,
          default_duration_minutes: template.default_duration_minutes,
          default_space_ids: template.session_template_spaces.map((r) => r.space_id),
        }}
        redirectTo={redirectTo}
      />
    </div>
  );
}
