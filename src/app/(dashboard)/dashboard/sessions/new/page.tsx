import { notFound, redirect } from "next/navigation";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface NewSessionTemplatePageProps {
  searchParams: Promise<{ schedule?: string }>;
}

export default async function NewSessionTemplatePage({ searchParams }: NewSessionTemplatePageProps) {
  const { schedule: scheduleGroupId } = await searchParams;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  // A template always belongs to a schedule — without one there's nothing
  // to attach it to, so send staff back to pick a schedule first.
  if (!scheduleGroupId) redirect("/dashboard/sessions");

  const supabase = await createClient();

  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select("id, name, facility_id, department_id")
    .eq("id", scheduleGroupId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!scheduleGroup) notFound();

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
        <h1 className="text-2xl font-bold text-gray-900">New session template</h1>
        <p className="text-gray-500 mt-1">
          Define a reusable activity — its name, color, default duration, and usual space — once,
          then reuse it when building out {scheduleGroup.name}&rsquo;s schedule.
        </p>
      </div>

      <SessionTemplateForm
        scheduleGroupId={scheduleGroup.id}
        spaces={spaces ?? []}
        redirectTo={redirectTo}
      />
    </div>
  );
}
