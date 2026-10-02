import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { canReadFacility, isReadOnly, isScoped } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { NO_DEPARTMENT, spacesHref } from "@/lib/schedule/commandCentreHref";
import { pickFacility } from "@/lib/dashboard/scope";
import { rememberedFacilityId } from "@/lib/dashboard/scope.server";
import Breadcrumb from "@/components/layout/Breadcrumb";
import DepartmentFilter from "@/components/dashboard/DepartmentFilter";
import { Skeleton } from "@/components/ui/skeleton";
import SpacesPanel from "@/components/space/SpacesPanel";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

interface SpacesPageProps {
  searchParams: Promise<{ facility?: string; department?: string }>;
}

/**
 * The dedicated Spaces page — lanes, courts, studios, scoped to one building
 * at a time. Used to be a tab inside the schedule command centre; now it's
 * its own route so a facility's bookable locations can be managed without
 * detouring through a schedule.
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

export default function SpacesPage({ searchParams }: SpacesPageProps) {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <PageHeader title="Spaces" info="Bookable locations, such as lanes, courts and studios, that sessions attach to." />
      </div>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<SpacesBodySkeleton />}>
        <Streamed className="space-y-6">
          <SpacesBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function SpacesBody({ searchParams }: SpacesPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam, department: departmentParam } = await searchParams;

  const [{ data: facilityRows }, { data: spaceRows }, { data: departmentRows }] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("id, name, city, province, is_published, photo_urls")
        .eq("org_id", orgId)
        .order("name"),
      // select("*") rather than a column list so the page still renders on a
      // database where migration 054 (zone_name) has not been applied yet.
      // created_at breaks display_order ties — without it, rows sharing a
      // position come back in Postgres heap order, which changes on every
      // update. That is the bug that made lane order look random.
      supabase
        .from("spaces")
        .select("*")
        .eq("org_id", orgId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("departments")
        .select("id, name, facility_id")
        .eq("org_id", orgId)
        .order("display_order", { ascending: true }),
    ]);

  // Only buildings this viewer can read, before the default is picked.
  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const readable = (facilityRows ?? []).filter((f) => canReadFacility(actor, f.id));
  const facility = pickFacility(readable, facilityParam, await rememberedFacilityId());
  if (!facility) return <NoFacilities />;

  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      isPublished: s.is_published,
      departmentId: s.department_id,
      // Optional-chained: absent until migration 054 is applied.
      zoneName: s.zone_name ?? null,
    }));

  // The panel groups by department, so it needs this building's own — already
  // in display order from the query above.
  const departments = (departmentRows ?? [])
    .filter((d) => d.facility_id === facility.id)
    .map((d) => ({ id: d.id, name: d.name }));

  // The department filter: a coordinator's own departments, plus the
  // whole-building section when some spaces belong to no department.
  const ownDepartments = isScoped(actor.role)
    ? departments.filter((d) => actor.scopes.departmentIds.includes(d.id))
    : departments;
  const knownIds = new Set(departments.map((d) => d.id));
  const hasShared = spaces.some((s) => !s.departmentId || !knownIds.has(s.departmentId));
  const departmentOptions = [
    ...ownDepartments,
    ...(hasShared && departments.length > 0 ? [{ id: NO_DEPARTMENT, name: "Whole building" }] : []),
  ];
  const departmentFilter = departmentOptions.some((o) => o.id === departmentParam) ? departmentParam! : null;
  const departmentName = departmentOptions.find((o) => o.id === departmentFilter)?.name;

  return (
    <>
      <div className="space-y-4">
        <Breadcrumb
          className="mb-0"
          items={[
            { label: facility.name, href: spacesHref(facility.id) },
            ...(departmentName ? [{ label: departmentName }] : []),
          ]}
        />
        <DepartmentFilter options={departmentOptions} value={departmentFilter} allLabel="All departments" />
      </div>

      <SpacesPanel
        facility={{ id: facility.id, name: facility.name, spaces }}
        departments={departments}
        departmentFilter={departmentFilter}
      />
    </>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <EmptyState
        title="No buildings yet"
        titleAs="h2"
        description="Add a facility first — spaces belong to a building."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/facilities/new">
              <Plus className="w-4 h-4" />
              Add a facility
            </Link>
          </Button>
        }
      />
    </div>
  );
}

function SpacesBodySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-56 rounded-card shrink-0" />
        ))}
      </div>
      {/* Two department sections — the shape the body actually resolves to,
          so the swap does not jump. */}
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-40 rounded-card" />
      ))}
    </div>
  );
}
