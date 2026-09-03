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
  facility_id: string;
  department_id: string | null;
  session_template_spaces: { space_id: string }[];
  facilities: { id: string; name: string } | null;
  departments: { id: string; name: string } | null;
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
      "id, name, color, default_duration_minutes, facility_id, department_id, session_template_spaces ( space_id ), facilities ( id, name ), departments ( id, name )"
    )
    .eq("id", templateId)
    .eq("org_id", orgContext.org.id)
    .single() as unknown as { data: SessionTemplateRow | null };

  if (!template || !template.facilities) notFound();

  const facility = template.facilities;
  const department = template.departments;

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facility.id)
    .order("display_order", { ascending: true });

  const redirectTo = sessionsHref({
    facilityId: facility.id,
    departmentId: department?.id ?? NO_DEPARTMENT,
  });

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Edit session template</h1>
        <p className="text-muted-foreground mt-1">
          Changes apply going forward — sessions already placed from this template keep their own
          settings.
        </p>
      </div>

      <SessionTemplateForm
        facilityId={facility.id}
        departmentId={department?.id ?? null}
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
