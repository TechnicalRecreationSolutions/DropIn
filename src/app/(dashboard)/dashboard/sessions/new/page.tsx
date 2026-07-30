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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allScheduleGroups } = await (supabase as any)
    .from("schedule_groups")
    .select("id, name, facility_id, facilities(name)")
    .eq("org_id", orgContext.org.id)
    .order("name") as unknown as {
      data: { id: string; name: string; facility_id: string; facilities: { name: string } | null }[] | null
    };

  const scheduleGroupList = (allScheduleGroups ?? []).map((sg) => ({
    id: sg.id,
    name: sg.name,
    facility_id: sg.facility_id,
    facility_name: sg.facilities?.name ?? "Unknown facility",
  }));

  const scoped = scheduleGroupId
    ? scheduleGroupList.find((sg) => sg.id === scheduleGroupId)
    : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allSpaces } = await (supabase as any)
    .from("spaces")
    .select("id, name, facility_id")
    .eq("org_id", orgContext.org.id)
    .order("display_order", { ascending: true }) as unknown as {
      data: { id: string; name: string; facility_id: string }[] | null
    };

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
        scheduleGroups={scoped ? [scoped] : scheduleGroupList}
        defaultScheduleGroupId={scoped?.id}
        spaces={allSpaces ?? []}
      />
    </div>
  );
}
