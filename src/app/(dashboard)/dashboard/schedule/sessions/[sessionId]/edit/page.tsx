import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import SessionForm from "@/components/schedule-editor/SessionForm";
import { fetchOperatingHoursRecord } from "@/lib/schedule/operating-hours-query";
import { PageHeader } from "@/components/ui/info-tip";

interface EditSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function EditSessionPage({ params }: EditSessionPageProps) {
  const { sessionId } = await params;
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, schedule_group_id, rrule, dtstart, dtend_time, valid_from, valid_until, location_detail, occupancy_kind, disclosure, follows_operating_hours"
    )
    .eq("id", sessionId)
    .eq("org_id", orgContext.org.id)
    .single();

  if (!session) notFound();

  // Staff-only sidecar (migration 046). A separate read rather than an embed:
  // session_internal has no public-read policy, and keeping it a distinct query
  // on a distinct table is what makes "this data is staff-only" visible at
  // every call site instead of hidden inside a select string.
  const { data: internal } = await supabase
    .from("session_internal")
    .select("holder_name, setup_notes")
    .eq("session_id", sessionId)
    .maybeSingle();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: scheduleGroup } = await supabase
    .from("schedule_groups")
    .select(
      "id, name, facility_id, department_id, activity_type, age_group, skill_level, max_participants, cost_notes, description, photo_urls, facilities(name)"
    )
    .eq("id", session.schedule_group_id)
    .single() as unknown as {
    data: {
      id: string; name: string; facility_id: string; department_id: string | null;
      activity_type: "drop_in" | "registered" | "open_gym";
      age_group: string | null; skill_level: string | null;
      max_participants: number | null; cost_notes: string | null;
      description: string | null; photo_urls: string[] | null;
      facilities: { name: string } | null;
    } | null;
  };

  if (!scheduleGroup) notFound();

  // Saving returns to the command centre focused on this session's own
  // schedule — that's where it was being edited from.
  const commandCentreHref =
    `/dashboard/schedule?facility=${scheduleGroup.facility_id}&schedule=${scheduleGroup.id}`;

  const { data: spaces } = await supabase
    .from("spaces")
    .select("id, name, facility_id, department_id")
    .eq("org_id", orgContext.org.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: sessionSpaceRows } = await supabase
    .from("session_spaces")
    .select("space_id")
    .eq("session_id", sessionId);
  const spaceIds = (sessionSpaceRows ?? []).map((r) => r.space_id);

  // dtstart's digits are the literal local wall-clock time (see
  // dropin/docs/RESUME-timezone-removal.md) — UTC getters read it directly,
  // no conversion.
  const dtstart = new Date(session.dtstart);
  const startTime = `${String(dtstart.getUTCHours()).padStart(2, "0")}:${String(dtstart.getUTCMinutes()).padStart(2, "0")}`;
  const endTime = session.dtend_time.slice(0, 5);

  // Only this session's own department: unlike the create page, the schedule
  // picker is fixed when editing, so there is nowhere else to switch to.
  const operatingHours = await fetchOperatingHoursRecord(supabase, [
    scheduleGroup.department_id,
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <PageHeader
          title="Edit session"
          subtitle={`${scheduleGroup.name} · ${scheduleGroup.facilities?.name ?? "Unknown facility"}`}
        />
      </div>
      <SessionForm
        orgId={orgContext.org.id}
        canEditScheduleDetails={can(
          { role: orgContext.membership.role, scopes: orgContext.scopes },
          "schedule-group:write",
          scheduleGroup?.department_id ?? null
        )}
        scheduleGroups={[{
          id: scheduleGroup.id,
          name: scheduleGroup.name,
          facility_id: scheduleGroup.facility_id,
          department_id: scheduleGroup.department_id,
          facility_name: scheduleGroup.facilities?.name ?? "Unknown facility",
          activity_type: scheduleGroup.activity_type,
          age_group: scheduleGroup.age_group,
          skill_level: scheduleGroup.skill_level,
          max_participants: scheduleGroup.max_participants,
          cost_notes: scheduleGroup.cost_notes,
          description: scheduleGroup.description,
          photo_urls: scheduleGroup.photo_urls ?? [],
        }]}
        defaultScheduleGroupId={scheduleGroup.id}
        spaces={spaces ?? []}
        operatingHours={operatingHours}
        sessionId={session.id}
        initialValues={{
          rrule: session.rrule,
          startTime,
          endTime,
          followsOperatingHours: session.follows_operating_hours,
          validFrom: session.valid_from,
          validUntil: session.valid_until ?? "",
          spaceIds,
          locationDetail: session.location_detail ?? "",
          occupancyKind: session.occupancy_kind,
          disclosure: session.disclosure,
          holderName: internal?.holder_name ?? "",
          setupNotes: internal?.setup_notes ?? "",
        }}
        redirectTo={commandCentreHref}
      />
    </div>
  );
}
