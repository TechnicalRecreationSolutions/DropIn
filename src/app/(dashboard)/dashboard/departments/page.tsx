import { Suspense } from "react";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { departmentsHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import DepartmentsPanel from "@/components/department/DepartmentsPanel";
import UnassignedCallout from "@/components/department/UnassignedCallout";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";
import { groupHoursByDepartment, summarizeWeek } from "@/lib/schedule/operating-hours";

interface DepartmentsPageProps {
  searchParams: Promise<{ facility?: string }>;
}

/**
 * The dedicated Departments page — groups of related schedules within a
 * building, scoped to one facility at a time. Departments used to have their
 * own detail page under facilities/[facilityId]/departments/[departmentId],
 * which is now a redirect into the schedule command centre; this is where
 * their name/description/publish state and deletion are actually managed,
 * matching Spaces and Sessions each getting their own top-level route.
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

export default function DepartmentsPage({ searchParams }: DepartmentsPageProps) {
  return (
    // Same column width as the Facilities grid — this page now shows the same
    // kind of cards, and a different width would read as a different place.
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader title="Departments" info="Groups of related schedules within a building, such as Aquatics or Fitness." />
      </div>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<DepartmentsBodySkeleton />}>
        <Streamed className="space-y-6">
          <DepartmentsBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function DepartmentsBody({ searchParams }: DepartmentsPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  const [
    { data: facilityRows },
    { data: departmentRows },
    { data: groupRows },
    { data: spaceRows },
    { data: hourRows },
    { count: coordinatorCount },
  ] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, city, province, is_published, photo_urls")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("departments")
      .select("id, name, description, is_published, facility_id")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true }),
    // Two jobs, one query each. The rows with NO department are the ones a
    // coordinator provably cannot reach (migration 055 §7) and drive the
    // callout; the rest are what each department's card counts. Fetching both
    // together rather than a count per department keeps this at one round trip
    // per table — an org's schedules and spaces number in the dozens.
    supabase
      .from("schedule_groups")
      .select("id, name, facility_id, department_id")
      .eq("org_id", orgId),
    supabase
      .from("spaces")
      .select("id, name, facility_id, department_id")
      .eq("org_id", orgId),
    // Operating hours (058) for the whole org, summarised per department below.
    supabase
      .from("department_hours")
      .select("department_id, day_of_week, opens_at, closes_at")
      .eq("org_id", orgId),
    supabase
      .from("org_memberships")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("role", "coordinator"),
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];

  // One pass over the org's hours rows, then a lookup per card. `summarizeWeek`
  // is the same line the department edit page prints, so the two surfaces can
  // never describe a week differently.
  const hoursByDepartment = groupHoursByDepartment(hourRows ?? []);

  const departments = (departmentRows ?? [])
    .filter((d) => d.facility_id === facility.id)
    .map((d) => {
      const week = hoursByDepartment.get(d.id)?.week;
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        is_published: d.is_published,
        schedule_count: (groupRows ?? []).filter((g) => g.department_id === d.id).length,
        space_count: (spaceRows ?? []).filter((s) => s.department_id === d.id).length,
        week_summary: week?.some((day) => day.length > 0) ? summarizeWeek(week) : null,
      };
    });

  const facilityCards = facilityRows.map((f) => {
    const count = (departmentRows ?? []).filter((d) => d.facility_id === f.id).length;
    return { ...f, meta: `${count} department${count !== 1 ? "s" : ""}` };
  });

  return (
    <>
      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={facility.id}
        hrefFor={departmentsHref}
      />

      <UnassignedCallout
        facilityId={facility.id}
        scheduleGroups={(groupRows ?? []).filter((g) => g.facility_id === facility.id && !g.department_id)}
        spaces={(spaceRows ?? []).filter((s) => s.facility_id === facility.id && !s.department_id)}
        hasCoordinators={(coordinatorCount ?? 0) > 0}
      />

      <DepartmentsPanel facility={facility} departments={departments} />
    </>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-card rounded-xl border border-dashed border-border">
        <Layers className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
        <h1 className="font-medium text-foreground mb-1">No buildings yet</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Add a facility first — departments belong to a building.
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

function DepartmentsBodySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-40 rounded-full shrink-0" />
        ))}
      </div>
      {/* Shaped like the grid it is standing in for, so the page does not
          jump from one tall block to three cards as it streams in. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
