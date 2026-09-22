import { notFound } from "next/navigation";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";
import { PageHeader } from "@/components/ui/info-tip";

interface EditSessionTemplatePageProps {
  params: Promise<{ templateId: string }>;
}

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  default_duration_minutes: number;
  occupancy_kind: "drop_in" | "program" | "rental" | "closure";
  disclosure: "public" | "reserved" | "internal";
  facility_id: string;
  department_id: string | null;
  session_template_spaces: { space_id: string }[];
  // Ordered on display_order in the select below — the order decides which
  // two tags reach a session card (migration 050).
  session_template_tags: { tag_id: string; display_order: number }[];
  session_template_links: { label: string; url: string; display_order: number }[];
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
      "id, name, color, description, default_duration_minutes, occupancy_kind, disclosure, facility_id, department_id, session_template_spaces ( space_id ), session_template_tags ( tag_id, display_order ), session_template_links ( label, url, display_order ), facilities ( id, name ), departments ( id, name )"
    )
    .eq("id", templateId)
    .eq("org_id", orgContext.org.id)
    .single() as unknown as { data: SessionTemplateRow | null };

  if (!template || !template.facilities) notFound();

  const facility = template.facilities;
  const department = template.departments;

  // A template belongs to one department, so its "usual spaces" picker offers
  // that department's spaces only — the same strict scoping as the session
  // builder (see the note in SessionForm.tsx). A template with no department
  // matches the untagged spaces, which is how a department-less building works.
  const spacesQuery = supabase
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facility.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: spaces } = await (department?.id
    ? spacesQuery.eq("department_id", department.id)
    : spacesQuery.is("department_id", null));

  const redirectTo = sessionsHref({
    facilityId: facility.id,
    departmentId: department?.id ?? NO_DEPARTMENT,
  });

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <PageHeader title="Edit session template" info="Changes apply going forward. Sessions already placed from this template keep their own settings." />
      </div>

      <SessionTemplateForm
        facilityId={facility.id}
        departmentId={department?.id ?? null}
        templateId={template.id}
        spaces={spaces ?? []}
        defaultValues={{
          name: template.name,
          color: template.color,
          description: template.description,
          default_duration_minutes: template.default_duration_minutes,
          default_space_ids: template.session_template_spaces.map((r) => r.space_id),
          occupancy_kind: template.occupancy_kind,
          disclosure: template.disclosure,
          // Both sorted here rather than trusted from the embed — PostgREST
          // makes no ordering guarantee on a nested select, and for these two
          // the order is meaning, not presentation.
          tag_ids: [...template.session_template_tags]
            .sort((a, b) => a.display_order - b.display_order)
            .map((r) => r.tag_id),
          links: [...template.session_template_links]
            .sort((a, b) => a.display_order - b.display_order)
            .map((r) => ({ label: r.label, url: r.url })),
        }}
        redirectTo={redirectTo}
      />
    </div>
  );
}
