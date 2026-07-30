import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface EditSessionTemplatePageProps {
  params: Promise<{ facilityId: string; scheduleGroupId: string; templateId: string }>;
}

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  session_template_spaces: { space_id: string }[];
};

export default async function EditSessionTemplatePage({ params }: EditSessionTemplatePageProps) {
  const { facilityId, scheduleGroupId, templateId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .eq("org_id", orgContext.org.id)
    .single() as unknown as { data: { id: string; name: string } | null };

  if (!facility) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scheduleGroup } = await (supabase as any)
    .from("schedule_groups")
    .select("id, name")
    .eq("id", scheduleGroupId)
    .eq("facility_id", facilityId)
    .single() as { data: { id: string; name: string } | null };

  if (!scheduleGroup) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: template } = await (supabase as any)
    .from("session_templates")
    .select("id, name, color, default_duration_minutes, session_template_spaces ( space_id )")
    .eq("id", templateId)
    .eq("schedule_group_id", scheduleGroupId)
    .single() as { data: SessionTemplateRow | null };

  if (!template) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: spaces } = await (supabase as any)
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true }) as { data: { id: string; name: string }[] | null };

  const listHref = `/dashboard/facilities/${facilityId}/schedule-groups/${scheduleGroupId}/session-templates`;

  return (
    <div className="max-w-2xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: scheduleGroup.name, href: `/dashboard/facilities/${facilityId}/schedule-groups/${scheduleGroupId}` },
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
