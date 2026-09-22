import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import SessionForm from "@/components/schedule-editor/SessionForm";
import { fetchOperatingHoursRecord } from "@/lib/schedule/operating-hours-query";
import { PageHeader } from "@/components/ui/info-tip";

interface NewSessionPageProps {
  searchParams: Promise<{ scheduleGroupId?: string }>;
}

export default async function NewSessionPage({ searchParams }: NewSessionPageProps) {
  const { scheduleGroupId } = await searchParams;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: allScheduleGroups } = await supabase
    .from("schedule_groups")
    .select(
      "id, name, facility_id, department_id, activity_type, age_group, skill_level, max_participants, cost_notes, description, photo_urls, facilities(name)"
    )
    .eq("org_id", orgContext.org.id)
    .order("name") as unknown as {
      data: {
        id: string; name: string; facility_id: string; department_id: string | null;
        activity_type: "drop_in" | "registered" | "open_gym";
        age_group: string | null; skill_level: string | null;
        max_participants: number | null; cost_notes: string | null;
        description: string | null; photo_urls: string[] | null;
        facilities: { name: string } | null;
      }[] | null
    };

  const scheduleGroupList = (allScheduleGroups ?? []).map((sg) => ({
    id: sg.id,
    name: sg.name,
    facility_id: sg.facility_id,
    department_id: sg.department_id,
    facility_name: sg.facilities?.name ?? "Unknown facility",
    activity_type: sg.activity_type,
    age_group: sg.age_group,
    skill_level: sg.skill_level,
    max_participants: sg.max_participants,
    cost_notes: sg.cost_notes,
    description: sg.description,
    photo_urls: sg.photo_urls ?? [],
  }));

  const scoped = scheduleGroupId
    ? scheduleGroupList.find((sg) => sg.id === scheduleGroupId)
    : undefined;

  // Org-wide rather than per-facility: the schedule picker on this form can move
  // the session to another building, and the lane picker has to follow without a
  // round trip.
  const { data: allSpaces } = await supabase
    .from("spaces")
    .select("id, name, facility_id, department_id")
    .eq("org_id", orgContext.org.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  // Operating hours for every department the picker can reach (058), so the
  // all-day toggle can answer for a schedule the user switches to without a
  // round trip.
  const operatingHours = await fetchOperatingHoursRecord(
    supabase,
    scheduleGroupList.map((sg) => sg.department_id)
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Add session"
        subtitle={scoped ? `${scoped.name} · ${scoped.facility_name}` : undefined}
      />
      <SessionForm
        orgId={orgContext.org.id}
        canEditScheduleDetails={can(
          { role: orgContext.membership.role, scopes: orgContext.scopes },
          "schedule-group:write",
          // No schedule preselected means a coordinator's answer depends on
          // which one they pick, so this fails closed and the form stays
          // read-only until the route re-renders scoped. The POST route checks
          // the real department either way.
          scoped?.department_id ?? null
        )}
        scheduleGroups={scoped ? [scoped] : scheduleGroupList}
        defaultScheduleGroupId={scoped?.id}
        spaces={allSpaces ?? []}
        operatingHours={operatingHours}
      />
    </div>
  );
}
