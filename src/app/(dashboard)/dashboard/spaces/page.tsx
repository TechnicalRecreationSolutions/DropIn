import { Suspense } from "react";
import Link from "next/link";
import { DoorOpen, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { spacesHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import SpacesPanel from "@/components/space/SpacesPanel";
import ConfigurationsPanel from "@/components/space/ConfigurationsPanel";
import Streamed from "@/components/ui/streamed";

interface SpacesPageProps {
  searchParams: Promise<{ facility?: string }>;
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
        <h1 className="text-2xl font-bold text-foreground">Spaces</h1>
        <p className="text-muted-foreground mt-1">
          Bookable locations — lanes, courts, studios — that sessions attach to.
        </p>
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

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  const [{ data: facilityRows }, { data: spaceRows }, { data: configurationRows }] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("id, name, city, province, is_published, photo_urls")
        .eq("org_id", orgId)
        .order("name"),
      supabase
        .from("spaces")
        .select("id, name, capacity, is_published, facility_id, department_id, configuration_id")
        .eq("org_id", orgId)
        .order("display_order", { ascending: true }),
      // The building's physical states (migration 048) — empty for every
      // facility with nothing reconfigurable, which is why the panel below
      // renders a flat space list until one exists.
      supabase
        .from("facility_configurations")
        .select("id, name, facility_id")
        .eq("org_id", orgId)
        .order("display_order", { ascending: true }),
    ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];

  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      isPublished: s.is_published,
      departmentId: s.department_id,
      configurationId: s.configuration_id,
    }));

  const configurations = (configurationRows ?? [])
    .filter((c) => c.facility_id === facility.id)
    .map((c) => ({ id: c.id, name: c.name }));

  const facilityCards = facilityRows.map((f) => {
    const count = (spaceRows ?? []).filter((s) => s.facility_id === f.id).length;
    return { ...f, meta: `${count} space${count !== 1 ? "s" : ""}` };
  });

  return (
    <>
      <FacilityCardPicker
        facilities={facilityCards}
        activeFacilityId={facility.id}
        hrefFor={spacesHref}
      />

      <SpacesPanel
        facility={{ id: facility.id, name: facility.name, spaces }}
        configurations={configurations}
        departmentId={null}
        departmentLabel={null}
      />

      <ConfigurationsPanel
        facilityId={facility.id}
        facilityName={facility.name}
        configurations={configurations.map((c) => ({
          ...c,
          spaceCount: spaces.filter((s) => s.configurationId === c.id).length,
        }))}
      />
    </>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-card rounded-xl border border-dashed border-border">
        <DoorOpen className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
        <h1 className="font-medium text-foreground mb-1">No buildings yet</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Add a facility first — spaces belong to a building.
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

function SpacesBodySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-56 rounded-xl shrink-0" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
