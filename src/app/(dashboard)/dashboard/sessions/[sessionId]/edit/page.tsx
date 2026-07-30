import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import SessionForm from "@/components/schedule-editor/SessionForm";

interface EditSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

type SessionRow = {
  id: string;
  schedule_group_id: string;
  rrule: string;
  dtstart: string;
  dtend_time: string;
  timezone: string;
  valid_from: string;
  valid_until: string | null;
  location_detail: string | null;
};

export default async function EditSessionPage({ params }: EditSessionPageProps) {
  const { sessionId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (supabase as any)
    .from("sessions")
    .select("id, schedule_group_id, rrule, dtstart, dtend_time, timezone, valid_from, valid_until, location_detail")
    .eq("id", sessionId)
    .eq("org_id", orgContext.org.id)
    .single() as { data: SessionRow | null };

  if (!session) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scheduleGroup } = await (supabase as any)
    .from("schedule_groups")
    .select("id, name, facility_id, department_id, facilities(name)")
    .eq("id", session.schedule_group_id)
    .single() as {
    data: { id: string; name: string; facility_id: string; department_id: string | null; facilities: { name: string } | null } | null;
  };

  if (!scheduleGroup) notFound();

  const scheduleGroupHref = scheduleGroup.department_id
    ? `/dashboard/facilities/${scheduleGroup.facility_id}/departments/${scheduleGroup.department_id}/schedule-groups/${scheduleGroup.id}`
    : `/dashboard/facilities/${scheduleGroup.facility_id}/schedule-groups/${scheduleGroup.id}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: spaces } = await (supabase as any)
    .from("spaces")
    .select("id, name, facility_id")
    .eq("org_id", orgContext.org.id)
    .order("display_order", { ascending: true }) as { data: { id: string; name: string; facility_id: string }[] | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sessionSpaceRows } = await (supabase as any)
    .from("session_spaces")
    .select("space_id")
    .eq("session_id", sessionId) as { data: { space_id: string }[] | null };
  const spaceIds = (sessionSpaceRows ?? []).map((r) => r.space_id);

  const dtstart = new Date(session.dtstart);
  const startTime = `${String(dtstart.getUTCHours()).padStart(2, "0")}:${String(dtstart.getUTCMinutes()).padStart(2, "0")}`;
  const endTime = session.dtend_time.slice(0, 5);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Edit session</h1>
        <p className="text-gray-500 mt-1">
          {scheduleGroup.name} at {scheduleGroup.facilities?.name ?? "Unknown facility"}
        </p>
      </div>
      <SessionForm
        scheduleGroups={[{
          id: scheduleGroup.id,
          name: scheduleGroup.name,
          facility_id: scheduleGroup.facility_id,
          facility_name: scheduleGroup.facilities?.name ?? "Unknown facility",
        }]}
        defaultScheduleGroupId={scheduleGroup.id}
        spaces={spaces ?? []}
        sessionId={session.id}
        initialValues={{
          rrule: session.rrule,
          startTime,
          endTime,
          validFrom: session.valid_from,
          validUntil: session.valid_until ?? "",
          timezone: session.timezone,
          spaceIds,
          locationDetail: session.location_detail ?? "",
        }}
        redirectTo={`${scheduleGroupHref}/builder`}
      />
    </div>
  );
}
