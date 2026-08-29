import Link from "next/link";
import { Clock, Pencil, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NO_DEPARTMENT, sessionsHref } from "@/lib/schedule/commandCentreHref";
import FacilityPicker from "@/components/facilities/FacilityPicker";
import SchedulePicker from "@/components/schedule/SchedulePicker";
import { Button } from "@/components/ui/button";

interface SessionsPageProps {
  searchParams: Promise<{ facility?: string; department?: string; schedule?: string }>;
}

type ScheduleGroupRow = {
  id: string;
  name: string;
  facility_id: string;
  department_id: string | null;
  departments: { name: string } | null;
};

type SessionTemplateRow = {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  session_template_spaces: { spaces: { name: string } }[];
};

/**
 * The dedicated Session templates page — reusable, color-coded activity
 * definitions, scoped to one schedule at a time (a template belongs to a
 * single schedule_group_id). Used to live nested under
 * facilities/[facilityId]/schedule-groups/[scheduleGroupId]/session-templates;
 * now it's its own route, matching Spaces and Map, and is where the command
 * centre's template rail "Manage" link and the sidebar's Sessions item both
 * point.
 */
export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam, department: departmentParam, schedule: scheduleParam } =
    await searchParams;

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const [{ data: facilityRows }, { data: scheduleGroupRows }] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgId).order("name"),
    supabase
      .from("schedule_groups")
      .select("id, name, facility_id, department_id, departments ( name )")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }) as unknown as Promise<{ data: ScheduleGroupRow[] | null }>,
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];
  const facilityGroups = (scheduleGroupRows ?? []).filter((g) => g.facility_id === facility.id);

  // Prefer a schedule that also matches the sidebar's current department
  // scope, so arriving here from a department-filtered "All schedules" link
  // lands on a relevant default instead of the facility's very first group.
  const departmentScoped = facilityGroups.filter((g) => {
    if (!departmentParam) return true;
    if (departmentParam === NO_DEPARTMENT) return !g.department_id;
    return g.department_id === departmentParam;
  });
  const defaultGroup = departmentScoped[0] ?? facilityGroups[0] ?? null;
  const scheduleGroup = facilityGroups.find((g) => g.id === scheduleParam) ?? defaultGroup;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Session templates</h1>
        <p className="text-gray-500 mt-1">
          Reusable, color-coded activity definitions — build these once, then drag them onto a
          schedule instead of filling out a form each time.
        </p>
      </div>

      <FacilityPicker
        facilities={facilityRows}
        activeFacilityId={facility.id}
        hrefFor={(facilityId) => sessionsHref({ facilityId })}
      />

      {facilityGroups.length === 0 ? (
        <NoSchedules facilityId={facility.id} />
      ) : (
        <>
          <SchedulePicker
            groups={facilityGroups}
            activeGroupId={scheduleGroup?.id ?? null}
            hrefFor={(g) =>
              sessionsHref({
                facilityId: facility.id,
                departmentId: g.department_id ?? NO_DEPARTMENT,
                scheduleGroupId: g.id,
              })
            }
          />
          {scheduleGroup && <TemplateList facility={facility} scheduleGroup={scheduleGroup} />}
        </>
      )}
    </div>
  );
}

async function TemplateList({
  facility,
  scheduleGroup,
}: {
  facility: { id: string; name: string };
  scheduleGroup: ScheduleGroupRow;
}) {
  const supabase = await createClient();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: templates } = await supabase
    .from("session_templates")
    .select("id, name, color, default_duration_minutes, session_template_spaces ( spaces ( name ) )")
    .eq("schedule_group_id", scheduleGroup.id)
    .eq("is_active", true)
    .order("display_order", { ascending: true }) as unknown as { data: SessionTemplateRow[] | null };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          For <span className="font-medium text-gray-700">{scheduleGroup.name}</span> at {facility.name}
        </p>
        <Button size="lg" asChild>
          <Link href={`/dashboard/sessions/new?schedule=${scheduleGroup.id}`}>
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
                <Link href={`/dashboard/sessions/${template.id}/edit`}>
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

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-medium text-gray-900 mb-1">No buildings yet</h1>
        <p className="text-sm text-gray-500 mb-4">
          Add a facility first — session templates belong to one of its schedules.
        </p>
        <Link
          href="/dashboard/facilities/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a facility
        </Link>
      </div>
    </div>
  );
}

function NoSchedules({ facilityId }: { facilityId: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-medium text-gray-900 mb-1">No schedules yet</h1>
        <p className="text-sm text-gray-500 mb-4">
          Add a schedule first — session templates belong to one.
        </p>
        <Link
          href={`/dashboard/facilities/${facilityId}/schedule-groups/new`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a schedule
        </Link>
      </div>
    </div>
  );
}
