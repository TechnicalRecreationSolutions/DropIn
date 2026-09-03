import { Suspense } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { mapHref } from "@/lib/schedule/commandCentreHref";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/types/database.types";
import MapEditorClient from "@/components/facility-maps/MapEditorClient";
import FloorplanOverview, {
  type FloorplanOverviewFacility,
} from "@/components/facility-maps/FloorplanOverview";
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
        <p className="text-muted-foreground mt-1">The map visitors see for your building. Drawn per building.</p>
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

  const [{ data: facilityRows }, { data: spaceRows }] = await Promise.all([
    supabase.from("facilities").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("spaces").select("id, name, facility_id").eq("org_id", orgId).order("display_order", { ascending: true }),
  ]);

  if (!facilityRows || facilityRows.length === 0) return <NoFacilities />;

  const facility = facilityRows.find((f) => f.id === facilityParam) ?? facilityRows[0];
  const spaces = (spaceRows ?? [])
    .filter((s) => s.facility_id === facility.id)
    .map((s) => ({ id: s.id, name: s.name }));

  const overviewFacilities = await buildOverviewFacilities(supabase, orgId, facilityRows, spaceRows ?? []);

  return (
    <>
      <div className="max-w-[1000px] mx-auto">
        <FloorplanOverview facilities={overviewFacilities} activeFacilityId={facility.id} hrefFor={mapHref} />
      </div>

      {/* Keyed on the facility so switching buildings rebuilds the editor
          rather than leaving the previous building's shapes on canvas. */}
      <MapEditorClient key={facility.id} facilityId={facility.id} spaces={spaces} />
    </>
  );
}

/**
 * Batches every facility's map + hotspots + context elements into the small
 * read-only render shape FloorplanOverview needs, so the org's buildings can
 * be scanned as a grid instead of clicked through one at a time. Skipped
 * entirely by the caller for single-facility orgs (FloorplanOverview also
 * no-ops in that case, kept as a second guard against a wasted round trip).
 */
async function buildOverviewFacilities(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  facilityRows: { id: string; name: string }[],
  spaceRows: { id: string; name: string; facility_id: string }[]
): Promise<FloorplanOverviewFacility[]> {
  if (facilityRows.length < 2) return [];

  const { data: mapRows } = await supabase
    .from("facility_maps")
    .select("id, facility_id, canvas_width, canvas_height, is_published")
    .eq("org_id", orgId);

  const mapIds = (mapRows ?? []).map((m) => m.id);
  let hotspotRows: Database["public"]["Tables"]["space_hotspots"]["Row"][] = [];
  let contextRows: Database["public"]["Tables"]["map_context_elements"]["Row"][] = [];
  if (mapIds.length > 0) {
    const [hotspotsRes, contextsRes] = await Promise.all([
      supabase.from("space_hotspots").select("*").in("facility_map_id", mapIds),
      supabase.from("map_context_elements").select("*").in("facility_map_id", mapIds),
    ]);
    hotspotRows = hotspotsRes.data ?? [];
    contextRows = contextsRes.data ?? [];
  }

  const spaceNameById = new Map(spaceRows.map((s) => [s.id, s.name]));
  const spaceCountByFacility = new Map<string, number>();
  for (const s of spaceRows) {
    spaceCountByFacility.set(s.facility_id, (spaceCountByFacility.get(s.facility_id) ?? 0) + 1);
  }

  return facilityRows.map((facility) => {
    const mapRow = (mapRows ?? []).find((m) => m.facility_id === facility.id);
    const hotspots = mapRow ? hotspotRows.filter((h) => h.facility_map_id === mapRow.id) : [];
    const contexts = mapRow ? contextRows.filter((c) => c.facility_map_id === mapRow.id) : [];

    return {
      id: facility.id,
      name: facility.name,
      spaceCount: spaceCountByFacility.get(facility.id) ?? 0,
      map: mapRow
        ? {
            canvasWidth: mapRow.canvas_width,
            canvasHeight: mapRow.canvas_height,
            isPublished: mapRow.is_published,
          }
        : null,
      shapes: hotspots.map((h) => ({
        key: h.id,
        spaceId: h.space_id,
        x: Number(h.x),
        y: Number(h.y),
        width: Number(h.width),
        height: Number(h.height),
        rotation: Number(h.rotation),
        presetKey: h.preset_key,
        displayName: h.label ?? spaceNameById.get(h.space_id) ?? "",
        groupId: h.group_id,
        laneIndex: h.lane_index,
      })),
      contextElements: contexts.map((c) => ({
        key: c.id,
        kind: c.kind,
        x: Number(c.x),
        y: Number(c.y),
        width: Number(c.width),
        height: Number(c.height),
        rotation: Number(c.rotation),
        label: c.label,
      })),
    };
  });
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
      <div className="max-w-[1000px] mx-auto">
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <Skeleton className="h-[500px] rounded-xl" />
    </div>
  );
}
