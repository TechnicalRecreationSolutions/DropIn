import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import BuilderClient from "@/components/schedule-builder/BuilderClient";

interface BuilderPageProps {
  params: Promise<{ facilityId: string; departmentId: string; scheduleGroupId: string }>;
}

type ScheduleGroupRow = {
  id: string;
  name: string;
  schedule_type: "time_block" | "continuous";
};

export default async function BuilderPage({ params }: BuilderPageProps) {
  const { facilityId, departmentId, scheduleGroupId } = await params;
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
  const { data: department } = await (supabase as any)
    .from("departments")
    .select("id, name")
    .eq("id", departmentId)
    .eq("facility_id", facilityId)
    .single() as { data: { id: string; name: string } | null };

  if (!department) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scheduleGroup } = await (supabase as any)
    .from("schedule_groups")
    .select("id, name, schedule_type")
    .eq("id", scheduleGroupId)
    .eq("department_id", departmentId)
    .single() as { data: ScheduleGroupRow | null };

  if (!scheduleGroup) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: spaces } = await (supabase as any)
    .from("spaces")
    .select("id, name")
    .eq("facility_id", facilityId)
    .order("display_order", { ascending: true }) as { data: { id: string; name: string }[] | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: templateRows } = await (supabase as any)
    .from("session_templates")
    .select("id, name, color, default_duration_minutes, session_template_spaces ( space_id )")
    .eq("schedule_group_id", scheduleGroupId)
    .eq("is_active", true)
    .order("display_order", { ascending: true }) as {
    data: {
      id: string; name: string; color: string | null; default_duration_minutes: number;
      session_template_spaces: { space_id: string }[];
    }[] | null;
  };

  const templates = templateRows?.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    default_duration_minutes: t.default_duration_minutes,
    default_space_ids: t.session_template_spaces.map((r) => r.space_id),
  }));

  const scheduleGroupHref = `/dashboard/facilities/${facilityId}/departments/${departmentId}/schedule-groups/${scheduleGroupId}`;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Breadcrumb
        items={[
          { label: "Facilities", href: "/dashboard/facilities" },
          { label: facility.name, href: `/dashboard/facilities/${facilityId}` },
          { label: department.name, href: `/dashboard/facilities/${facilityId}/departments/${departmentId}` },
          { label: scheduleGroup.name, href: scheduleGroupHref },
          { label: "Builder" },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Build schedule: {scheduleGroup.name}</h1>
          <p className="text-gray-500 mt-1">
            Drag a session template onto a space and day to place it.
          </p>
        </div>
        <Link
          href={`${scheduleGroupHref}/session-templates`}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Manage templates
        </Link>
      </div>

      {scheduleGroup.schedule_type === "continuous" ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">
            This schedule is set up as &ldquo;continuous&rdquo; (always open, no fixed time
            slots), so it doesn&rsquo;t use the drag-and-drop builder. Edit its hours from the
            schedule&rsquo;s edit page.
          </p>
        </div>
      ) : spaces && spaces.length > 0 ? (
        <BuilderClient
          scheduleGroupId={scheduleGroupId}
          spaces={spaces}
          templates={templates ?? []}
          manageTemplatesHref={`${scheduleGroupHref}/session-templates`}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 border-dashed p-8 text-center">
          <p className="text-sm text-gray-500">
            This facility has no spaces set up yet. Add a space (e.g. Lane 3, Court A) before
            building a schedule visually.
          </p>
          <Link
            href={`/dashboard/facilities/${facilityId}/spaces/new`}
            className="inline-block mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Add a space →
          </Link>
        </div>
      )}
    </div>
  );
}
