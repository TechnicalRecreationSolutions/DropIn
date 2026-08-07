import { notFound } from "next/navigation";
import { commandCentreHref, NO_DEPARTMENT } from "@/lib/schedule/commandCentreHref";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { Button } from "@/components/ui/button";

interface SessionTemplatesPageProps {
  params: Promise<{ facilityId: string; scheduleGroupId: string }>;
}

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  session_template_spaces: { spaces: { name: string } }[];
};

export default async function SessionTemplatesPage({ params }: SessionTemplatesPageProps) {
  const { facilityId, scheduleGroupId } = await params;
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

  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, name")
    .eq("id", scheduleGroupId)
    .eq("facility_id", facilityId)
    .single();

  if (!scheduleGroup) notFound();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: templates } = await supabase
    .from("session_templates")
    .select("id, name, color, default_duration_minutes, session_template_spaces ( spaces ( name ) )")
    .eq("schedule_group_id", scheduleGroupId)
    .eq("is_active", true)
    .order("display_order", { ascending: true }) as unknown as { data: SessionTemplateRow[] | null };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: commandCentreHref({ facilityId }) },
          { label: scheduleGroup.name, href: commandCentreHref({ facilityId, departmentId: NO_DEPARTMENT, scheduleGroupId }) },
          { label: "Session templates" },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Session templates</h1>
          <p className="text-gray-500 mt-1">
            Reusable, color-coded activity definitions for {scheduleGroup.name} — build these once,
            then drag them onto a schedule instead of filling out a form each time.
          </p>
        </div>
        <Button size="lg" asChild>
          <Link href={`/dashboard/facilities/${facilityId}/schedule-groups/${scheduleGroupId}/session-templates/new`}>
            <Plus />
            New template
          </Link>
        </Button>
      </div>

      {!templates || templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200 border-dashed">
          <p className="text-sm text-gray-500">No session templates yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {templates.map((template) => (
            <div key={template.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-4 h-4 rounded-full flex-shrink-0 border border-black/10"
                  style={{ backgroundColor: template.color ?? "#3B82F6" }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{template.name}</p>
                  <p className="text-xs text-gray-500">
                    {template.default_duration_minutes} min
                    {template.session_template_spaces.length > 0 &&
                      ` · ${template.session_template_spaces.map((r) => r.spaces.name).join(", ")}`}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/dashboard/facilities/${facilityId}/schedule-groups/${scheduleGroupId}/session-templates/${template.id}/edit`}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
