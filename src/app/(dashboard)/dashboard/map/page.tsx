import { Suspense } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import MapEditorClient from "@/components/facility-maps/MapEditorClient";
import FacilityCardPicker from "@/components/facilities/FacilityCardPicker";
import Streamed from "@/components/ui/streamed";

interface MapPageProps {
  searchParams: Promise<{ facility?: string }>;
}

/**
 * The dedicated floorplan editor — the map visitors see for one building,
 * scoped per facility. Used to be a tab inside the schedule command centre;
 * a floorplan is drawn per building regardless of department, so this page
 * (like the old tab) has no department scope at all.
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

export default function MapPage({ searchParams }: MapPageProps) {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Floorplan</h1>
        <p className="text-muted-foreground mt-1">
          The map visitors see for your building. Every shape is one of your spaces — they&apos;re
          listed here the way the Spaces page groups them.
        </p>
      </div>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<MapBodySkeleton />}>
        <Streamed className="space-y-6">
          <MapBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function MapBody({ searchParams }: MapPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();
  const { facility: facilityParam } = await searchParams;

  // Same three reads as the Spaces page, so the editor's sidebar can group
  // spaces exactly as that page does. select("*") on spaces for the same
  // reason given there (zone_name arrives with migration 054).
  const [{ data: facilityRows }, { data: spaceRows }, { data: departmentRows }] =
    await Promise.all([
      supabase
        .from("facilities")
        .select("id, name, city, province, is_published, photo_urls")
        .eq("org_id", orgId)
        .order("name"),
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

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];
  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      isPublished: s.is_published,
      departmentId: s.department_id,
      zoneName: s.zone_name ?? null,
    }));
  const departments = (departmentRows ?? [])
    .filter((d) => d.facility_id === facility.id)
    .map((d) => ({ id: d.id, name: d.name }));

  // The same compact pill picker the Spaces page uses. It replaced a grid of
  // floorplan thumbnails that pushed the editor below the fold on any org
  // with more than one building.
  const facilityCards = facilityRows.map((f) => {
    const count = (spaceRows ?? []).filter((s) => s.facility_id === f.id).length;
    return { ...f, meta: `${count} space${count !== 1 ? "s" : ""}` };
  });

  return (
    <>
      <FacilityCardPicker facilities={facilityCards} activeFacilityId={facility.id} hrefFor={mapHref} />

      {/* Keyed on the facility so switching buildings rebuilds the editor
          rather than leaving the previous building's shapes on canvas. */}
      <MapEditorClient
        key={facility.id}
        facilityId={facility.id}
        spaces={spaces}
        departments={departments}
      />
    </>
  );
}

function NoFacilities() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-16 bg-card rounded-xl border border-dashed border-border">
        <Building2 className="w-10 h-10 text-muted-foreground/70 mx-auto mb-3" />
        <h1 className="font-medium text-foreground mb-1">No buildings yet</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Add a facility first — a floorplan belongs to a building.
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

function MapBodySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-12 rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <Skeleton className="h-[500px] rounded-2xl" />
        <Skeleton className="h-[500px] rounded-2xl" />
      </div>
    </div>
  );
}
