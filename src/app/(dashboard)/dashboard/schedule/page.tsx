import { Suspense } from "react";
import Link from "next/link";
import { Plus, Building2 } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import { NO_DEPARTMENT, isWorkspaceTab } from "@/lib/schedule/commandCentreHref";
import ScheduleCommandCentre from "@/components/schedule-command/ScheduleCommandCentre";
import type { CommandFacility, CommandScheduleGroup } from "@/components/schedule-command/types";
import type { ScheduleTemplate } from "@/types/schedule.types";

/**
 * The schedule command centre — where staff spend most of their time. Every
 * building, every schedule inside it, and all four widget layouts live on
 * this one route; there is no separate "builder" page to open, because the
 * views rendered here are the widget's own components running in edit mode
 * (see components/schedule/editing/).
 *
 * Everything the editor needs for the whole org is fetched once, server
 * side, so switching building/schedule/view is instant local state rather
 * than a navigation or a fresh round trip. Only the week's sessions are
 * fetched client side, since those change as staff navigate weeks.
 *
 * Validated for instant client-side navigation: Next.js checks at build
 * time that this route still produces a static shell from every entry
 * point, so a future change that reintroduces blocking data access fails
 * the build rather than quietly making navigation feel slow again.
 *
 * The Suspense boundary has to live inside this page — see the note in
 * dashboard/facilities/page.tsx for why a boundary in the layout is not
 * enough for navigations arriving from a sibling route.
 */
export const unstable_instant = { prefetch: "static" };

interface SchedulePageProps {
  searchParams: Promise<{
    facility?: string;
    department?: string;
    schedule?: string;
    tab?: string;
  }>;
}

export default function SchedulePage({ searchParams }: SchedulePageProps) {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manage</h1>
          <p className="text-gray-500 mt-1">
            Pick a building — its schedules, spaces, floorplan, and widget all live here.
          </p>
        </div>
        <Link
          href="/dashboard/sessions/new"
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add session</span>
        </Link>
      </div>

      <Suspense fallback={<CommandCentreSkeleton />}>
        <CommandCentreBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CommandCentreBody({ searchParams }: SchedulePageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const {
    facility: facilityParam,
    department: departmentParam,
    schedule: scheduleParam,
    tab: tabParam,
  } = await searchParams;

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
  ] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, is_published")
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
      .select("id, name, status, schedule_type, facility_id, department_id, departments ( name )")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }) as unknown as Promise<{
      data: {
        id: string; name: string; status: "draft" | "published"; schedule_type: string | null;
        facility_id: string; department_id: string | null; departments: { name: string } | null;
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
      .select("id, name, color, default_duration_minutes, schedule_group_id, session_template_spaces ( space_id )")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }) as unknown as Promise<{
      data: {
        id: string; name: string; color: string | null; default_duration_minutes: number;
        schedule_group_id: string; session_template_spaces: { space_id: string }[];
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
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const templatesByScheduleGroup = new Map<string, CommandScheduleGroup["templates"]>();
  for (const t of templateRows ?? []) {
    const list = templatesByScheduleGroup.get(t.schedule_group_id) ?? [];
    list.push({
      id: t.id,
      name: t.name,
      color: t.color,
      default_duration_minutes: t.default_duration_minutes,
      default_space_ids: t.session_template_spaces.map((r) => r.space_id),
    });
    templatesByScheduleGroup.set(t.schedule_group_id, list);
  }

  const publishedMapFacilityIds = new Set((mapRows ?? []).map((m) => m.facility_id));

  const facilities: CommandFacility[] = facilityRows.map((f) => ({
    id: f.id,
    name: f.name,
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
          departmentId: g.department_id,
          departmentName: g.departments?.name ?? null,
          templates: templatesByScheduleGroup.get(g.id) ?? [],
          settingsHref: `${base}/edit`,
          manageTemplatesHref: `${base}/session-templates`,
        };
      }),
  }));

  // Deep links are validated against what this org actually owns, so a
  // stale or hand-edited URL falls back rather than showing an empty editor.
  const initialFacility = facilities.find((f) => f.id === facilityParam) ?? null;
  const initialFacilityId = initialFacility?.id ?? null;

  const initialScheduleGroupId = initialFacility?.scheduleGroups.some((g) => g.id === scheduleParam)
    ? (scheduleParam as string)
    : null;

  // NO_DEPARTMENT is a real, selectable filter, but only where the facility
  // has departments to distinguish it from — otherwise the tier never renders.
  const departmentParamIsValid =
    !!initialFacility &&
    initialFacility.departments.length > 0 &&
    (departmentParam === NO_DEPARTMENT ||
      initialFacility.departments.some((d) => d.id === departmentParam));
  const initialDepartmentId = departmentParamIsValid ? (departmentParam as string) : null;

  const widgetTemplates = (widgetConfig?.allowed_templates as ScheduleTemplate[] | null) ?? [
    "grid",
    "list",
    "map",
  ];

  return (
    <ScheduleCommandCentre
      orgId={orgId}
      orgPrimaryColor={widgetConfig?.primary_color ?? "#0066CC"}
      widgetTemplates={widgetTemplates}
      facilities={facilities}
      initialFacilityId={initialFacilityId}
      initialDepartmentId={initialDepartmentId}
      initialScheduleGroupId={initialScheduleGroupId}
      initialTab={isWorkspaceTab(tabParam) ? tabParam : "schedule"}
    />
  );
}

function NoFacilities() {
  return (
    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
      <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <h3 className="font-medium text-gray-900 mb-1">No buildings yet</h3>
      <p className="text-sm text-gray-500 mb-4">
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
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
