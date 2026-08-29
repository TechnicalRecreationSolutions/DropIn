import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/session";
import SessionForm from "@/components/schedule-editor/SessionForm";

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

  const { data: allSpaces } = await supabase
    .from("spaces")
    .select("id, name, facility_id, department_id")
    .eq("org_id", orgContext.org.id)
    .order("display_order", { ascending: true });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add session</h1>
        <p className="text-gray-500 mt-1">
          {scoped
            ? `Define a recurring time for ${scoped.name} at ${scoped.facility_name}.`
            : "Define a recurring schedule for one of your schedules."}
        </p>
      </div>
      <SessionForm
        orgId={orgContext.org.id}
        canEditScheduleDetails={["owner", "admin"].includes(orgContext.membership.role)}
        scheduleGroups={scoped ? [scoped] : scheduleGroupList}
        defaultScheduleGroupId={scoped?.id}
        spaces={allSpaces ?? []}
      />
    </div>
  );
}
