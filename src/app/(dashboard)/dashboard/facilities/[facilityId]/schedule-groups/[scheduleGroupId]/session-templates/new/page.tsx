import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import SessionTemplateForm from "@/components/session-template/SessionTemplateForm";

interface NewSessionTemplatePageProps {
  params: Promise<{ facilityId: string; scheduleGroupId: string }>;
}

export default async function NewSessionTemplatePage({ params }: NewSessionTemplatePageProps) {
  const { facilityId, scheduleGroupId } = await params;
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
