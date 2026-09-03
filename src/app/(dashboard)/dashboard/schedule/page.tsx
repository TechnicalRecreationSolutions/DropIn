import { Suspense } from "react";
import Link from "next/link";
import { Plus, Building2 } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { commandCentreHref, sessionsHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import ScheduleCommandCentre from "@/components/schedule-command/ScheduleCommandCentre";
import type { CommandFacility } from "@/components/schedule-command/types";
import type { ScheduleTemplate } from "@/types/schedule.types";
import Streamed from "@/components/ui/streamed";

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
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Manage</h1>
          <p className="text-muted-foreground mt-1">
            Pick a building, then a schedule, to place and edit sessions.
          </p>
        </div>
        <Link
          href="/dashboard/schedule/sessions/new"
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add session</span>
        </Link>
      </div>

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

async function CommandCentreBody({ searchParams }: SchedulePageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  // The editor's whole shape for this org — small, bounded lists, so one
  // round of parallel queries beats a fetch per building switch.
  const [
    { data: facilityRows },
    { data: departmentRows },
    { data: scheduleGroupRows },
    { data: spaceRows },
    { data: templateRows },
    { data: mapRows },
    { data: widgetConfig },
    { data: sessionRows },
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
      .select("id, name, capacity, is_published, facility_id, department_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }),
    // Relational select — cast needed until Supabase CLI generates types with FK relations
    supabase
      .from("session_templates")
      .select("id, name, color, default_duration_minutes, facility_id, department_id, session_template_spaces ( space_id )")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }) as unknown as Promise<{
      data: {
        id: string; name: string; color: string | null; default_duration_minutes: number;
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
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

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

  return (
    <div className="space-y-6">
      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={activeFacilityId}
        hrefFor={(facilityId) => commandCentreHref({ facilityId })}
      />
      <ScheduleCommandCentre
        orgId={orgId}
        orgPrimaryColor={widgetConfig?.primary_color ?? "#0066CC"}
        widgetTemplates={widgetTemplates}
        facilities={facilities}
      />
    </div>
  );
}

function NoFacilities() {
  return (
    <div className="text-center py-20 bg-card rounded-xl border border-dashed border-border">
      <Building2 className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
      <h3 className="font-medium text-foreground mb-1">No buildings yet</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Add a facility first — schedules and sessions are built inside one.
      </p>
      <Link
        href="/dashboard/facilities/new"
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add a facility
      </Link>
    </div>
  );
}

function CommandCentreSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <Skeleton className="h-64 rounded-xl hidden lg:block" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
