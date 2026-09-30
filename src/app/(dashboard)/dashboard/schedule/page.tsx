import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { commandCentreHref, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import ScheduleCommandCentre from "@/components/schedule-command/ScheduleCommandCentre";
import { canReadFacility, canReportNotice, canWriteNotice, isReadOnly, isScoped } from "@/lib/auth/roles";
import StatusShortcut from "@/components/status/StatusShortcut";
import { splitStatusRows } from "@/lib/status/notices";
import type { CommandFacility } from "@/components/schedule-command/types";
import type { ScheduleTemplate } from "@/types/schedule.types";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The schedule command centre — where staff spend most of their time. Every
 * building and every schedule inside it live on this one route; there is no
 * separate "builder" page to open, because the views rendered here are the
 * widget's own components running in edit mode (see
 * components/schedule/editing/). Spaces, the floorplan editor, and the
 * widget configurator each live on their own dedicated route
 * (/dashboard/spaces, /dashboard/map, /dashboard/widget) rather than as
 * tabs here.
 *
 * Everything the editor needs for the whole org is fetched once, server
 * side, so switching building/schedule/view is instant local state rather
 * than a navigation or a fresh round trip. Only the week's sessions are
 * fetched client side, since those change as staff navigate weeks.
 *
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * The Suspense boundary has to live inside this page — see the note in
 * dashboard/facilities/page.tsx for why a boundary in the layout is not
 * enough for navigations arriving from a sibling route.
 */
export const instant = true;

interface SchedulePageProps {
  searchParams: Promise<{ facility?: string }>;
}

export default function SchedulePage({ searchParams }: SchedulePageProps) {
  return (
    <div className="space-y-6">
      {/* The header row is role-aware — aux staff get "Schedule" and no "Add
          session" — so it streams in behind a fallback that is the static
          header minus the button. The shell still prerenders and paints
          immediately, and nobody is offered a button that 403s. */}
      <Suspense fallback={<ScheduleHeader title="Manage" />}>
        <RoleAwareScheduleHeader />
      </Suspense>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<CommandCentreSkeleton />}>
        <Streamed className="space-y-6">
          <CommandCentreBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

function ScheduleHeader({ title, canEdit = false }: { title: string; canEdit?: boolean }) {
  return (
    <PageHeader
      title={title}
      info="Pick a building, then a schedule, to place and edit sessions."
      actions={
        canEdit && (
          <Button asChild>
            <Link href="/dashboard/schedule/sessions/new">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add session</span>
            </Link>
          </Button>
        )
      }
    />
  );
}

/**
 * The header once the role is known. getOrgContext() is React-cached, so this
 * shares CommandCentreBody's round trip rather than adding one.
 */
async function RoleAwareScheduleHeader() {
  const orgContext = await getOrgContext();
  const readOnly = !orgContext || isReadOnly(orgContext.membership.role);
  return <ScheduleHeader title={readOnly ? "Schedule" : "Manage"} canEdit={!readOnly} />;
}

async function CommandCentreBody({ searchParams }: SchedulePageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  // The editor's whole shape for this org — small, bounded lists, so one
  // round of parallel queries beats a fetch per building switch.
  const [
    { data: allFacilityRows },
    { data: departmentRows },
    { data: scheduleGroupRows },
    { data: spaceRows },
    { data: templateRows },
    { data: mapRows },
    { data: widgetConfig },
    { data: sessionRows },
    { data: openNoticeRows },
  ] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, slug, is_published, city, province, photo_urls")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name, facility_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }),
    // Relational select — cast needed until Supabase CLI generates types with FK relations
    supabase
      .from("schedule_groups")
      .select(
        "id, name, status, schedule_type, sport_category, facility_id, department_id, departments ( name ), starts_on, ends_on, updated_at, published_at"
      )
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }) as unknown as Promise<{
      data: {
        id: string; name: string; status: "draft" | "published"; schedule_type: string | null;
        sport_category: string; facility_id: string; department_id: string | null; departments: { name: string } | null;
        starts_on: string | null; ends_on: string | null; updated_at: string; published_at: string | null;
      }[] | null;
    }>,
    supabase
      .from("spaces")
      .select("id, name, capacity, is_published, facility_id, department_id, zone_name, display_order")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true }),
    // Relational select — cast needed until Supabase CLI generates types with FK relations
    supabase
      .from("session_templates")
      .select(
        "id, name, color, default_duration_minutes, occupancy_kind, disclosure, facility_id, department_id, session_template_spaces ( space_id )"
      )
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }) as unknown as Promise<{
      data: {
        id: string; name: string; color: string | null; default_duration_minutes: number;
        occupancy_kind: "drop_in" | "program" | "rental" | "closure";
        disclosure: "public" | "reserved" | "internal";
        facility_id: string; department_id: string | null; session_template_spaces: { space_id: string }[];
      }[] | null;
    }>,
    supabase
      .from("facility_maps")
      .select("facility_id")
      .eq("org_id", orgId)
      .eq("is_published", true),
    // Org-wide default row — the same appearance the widget and public page use.
    supabase
      .from("widget_configs")
      .select("allowed_templates, primary_color")
      .eq("org_id", orgId)
      .is("facility_id", null)
      .is("department_id", null)
      .maybeSingle(),
    // Counts for the schedule-management list — one org-wide fetch, same
    // reasoning as everything else here: bounded, so cheaper than a
    // per-schedule round trip when a building has many schedules.
    supabase
      .from("sessions")
      .select("id, schedule_group_id")
      .eq("org_id", orgId)
      .eq("is_active", true),
    // Open facility notices, org-wide and tiny, for the status strip above the
    // editor. `*` so the 063 review flag arrives once the column exists.
    supabase
      .from("facility_notices")
      .select("*")
      .eq("org_id", orgId)
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`),
  ]);

  const role = orgContext.membership.role;
  const actor = { role, scopes: orgContext.scopes };
  const canEdit = !isReadOnly(role);

  // A coordinator or aux staffer holds only some buildings. Filter BEFORE the
  // default is picked below, or the fallback lands them on the org's first
  // building by name — one they may not be able to read at all. Owners and
  // managers are unscoped and keep the whole list.
  const facilityRows = isScoped(role)
    ? (allFacilityRows ?? []).filter((f) => canReadFacility(actor, f.id))
    : (allFacilityRows ?? []);

  if (facilityRows.length === 0) return <NoFacilities canEdit={canEdit} />;

  const publishedMapFacilityIds = new Set((mapRows ?? []).map((m) => m.facility_id));

  const sessionCounts = new Map<string, number>();
  for (const s of sessionRows ?? []) {
    sessionCounts.set(s.schedule_group_id, (sessionCounts.get(s.schedule_group_id) ?? 0) + 1);
  }

  const facilities: CommandFacility[] = facilityRows.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    isPublished: f.is_published,
    hasPublishedMap: publishedMapFacilityIds.has(f.id),
    departments: (departmentRows ?? [])
      .filter((d) => d.facility_id === f.id)
      .map((d) => ({ id: d.id, name: d.name })),
    spaces: (spaceRows ?? [])
      .filter((s) => s.facility_id === f.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        capacity: s.capacity,
        isPublished: s.is_published,
        departmentId: s.department_id,
        zoneName: s.zone_name,
        displayOrder: s.display_order,
      })),
    scheduleGroups: (scheduleGroupRows ?? [])
      .filter((g) => g.facility_id === f.id)
      .map((g) => {
        // A schedule group with a department lives under the department-scoped
        // route; one without lives directly under the facility.
        const base = g.department_id
          ? `/dashboard/facilities/${f.id}/departments/${g.department_id}/schedule-groups/${g.id}`
          : `/dashboard/facilities/${f.id}/schedule-groups/${g.id}`;
        return {
          id: g.id,
          name: g.name,
          status: g.status,
          scheduleType: g.schedule_type,
          sportCategory: g.sport_category,
          sessionsCount: sessionCounts.get(g.id) ?? 0,
          departmentId: g.department_id,
          departmentName: g.departments?.name ?? null,
          // Facility-wide templates (department_id null) are usable by every
          // schedule in the building; a department-scoped template only by
          // schedules in that same department — mirrors how spaces with no
          // department stay available everywhere (see editing.spaces below).
          templates: (templateRows ?? [])
            .filter(
              (t) =>
                t.facility_id === f.id && (t.department_id === null || t.department_id === g.department_id)
            )
            .map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              default_duration_minutes: t.default_duration_minutes,
              occupancy_kind: t.occupancy_kind,
              disclosure: t.disclosure,
              default_space_ids: t.session_template_spaces.map((r) => r.space_id),
            })),
          settingsHref: `${base}/edit`,
          manageTemplatesHref: sessionsHref({
            facilityId: f.id,
            departmentId: g.department_id ?? undefined,
          }),
          startsOn: g.starts_on,
          endsOn: g.ends_on,
          updatedAt: g.updated_at,
          publishedAt: g.published_at,
        };
      }),
  }));

  const widgetTemplates = (widgetConfig?.allowed_templates as ScheduleTemplate[] | null) ?? [
    "grid",
    "list",
    "map",
  ];

  const activeFacilityId = (facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0]).id;
  const facilityCards = facilityRows.map((f) => {
    const departmentCount = (departmentRows ?? []).filter((d) => d.facility_id === f.id).length;
    const scheduleCount = (scheduleGroupRows ?? []).filter((g) => g.facility_id === f.id).length;
    return {
      ...f,
      meta: `${departmentCount} department${departmentCount !== 1 ? "s" : ""} · ${scheduleCount} schedule${scheduleCount !== 1 ? "s" : ""}`,
    };
  });

  // What is wrong at this building right now. Read-only staff always get the
  // strip — this page is where they land, and it is their way to report a
  // problem. Everyone else gets it only when something is live or waiting;
  // the Overview is their alert surface and an always-on row here is clutter.
  const status = splitStatusRows(
    (openNoticeRows ?? []).filter((n) => n.facility_id === activeFacilityId)
  );
  const showStatus = !canEdit || status.live.length > 0 || status.pendingCount > 0;
  const statusMode = canWriteNotice(
    actor,
    { auxCanPostNotices: orgContext.org.aux_can_post_notices },
    activeFacilityId
  )
    ? "post"
    : canReportNotice(actor, activeFacilityId)
      ? "report"
      : "view";

  return (
    <div className="space-y-6">
      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={activeFacilityId}
        hrefFor={(facilityId) => commandCentreHref({ facilityId })}
      />
      {showStatus && (
        <StatusShortcut
          facilityId={activeFacilityId}
          live={status.live}
          pendingCount={status.pendingCount}
          mode={statusMode}
        />
      )}
      <ScheduleCommandCentre
        orgId={orgId}
        orgPrimaryColor={widgetConfig?.primary_color ?? "#0066CC"}
        widgetTemplates={widgetTemplates}
        facilities={facilities}
        // Aux staff read this page and change nothing. Asked as "is this role
        // read-only" rather than can(…, "session:write"), because that
        // permission is department-scoped and a coordinator's answer depends
        // on which schedule is open — a question this page cannot ask once for
        // the whole render. The per-schedule answer is enforced by the routes.
        canEdit={canEdit}
      />
    </div>
  );
}

function NoFacilities({ canEdit }: { canEdit: boolean }) {
  if (!canEdit) {
    // Read-only staff cannot add a building, so offer the explanation instead
    // of a button that 403s.
    return (
      <EmptyState
        className="py-20"
        title="No buildings to show"
        titleAs="h3"
        description={
          <>You haven&apos;t been given access to a building yet. Ask a manager to add you to one.</>
        }
      />
    );
  }
  return (
    <EmptyState
      className="py-20"
      title="No buildings yet"
      titleAs="h3"
      description="Add a facility first — schedules and sessions are built inside one."
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard/facilities/new">
            <Plus className="w-4 h-4" />
            Add a facility
          </Link>
        </Button>
      }
    />
  );
}

function CommandCentreSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <Skeleton className="h-64 rounded-card hidden lg:block" />
        <Skeleton className="h-96 rounded-card" />
      </div>
    </div>
  );
}
