import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { can, canReadFacility, isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityGridCard from "@/components/facilities/FacilityGridCard";
import FacilitiesMapView from "@/components/facilities/map/FacilitiesMapView";
import type { FacilityMapItem } from "@/components/facilities/map/types";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SEVERITY_RANK } from "@/lib/status/notices";
import type { NoticeSeverity } from "@/types/app.types";

/**
 * Opted in to instant-navigation validation: Next.js re-renders this route in
 * dev as both a page load and a sibling client navigation, and reports in the
 * dev overlay if it stops producing a static shell — so a change that
 * reintroduces blocking data access is surfaced rather than quietly making
 * navigation feel slow again.
 *
 * Note that the Suspense boundary below has to live *inside* this page. The
 * one in the dashboard layout covers a fresh page load, but when navigating
 * here from a sibling route the shared layout is the entry point and anything
 * above it has already rendered — a boundary up there would never fire.
 */
export const instant = true;

type FacilityRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  province: string;
  is_published: boolean;
  photo_urls: string[];
  lat: number | null;
  lng: number | null;
  geocoded_at: string | null;
  departments: { id: string }[];
  schedule_groups: { id: string }[];
};

/**
 * Map first when a Mapbox token is configured (FacilitiesMapView, README in
 * components/facilities/map/), the card grid otherwise. Mapbox was removed in
 * ef0a035 and came back for display only — tiles and the renderer; the
 * address lookup stays on Nominatim, server-side (lib/geo/geocode.ts).
 *
 * The token is public by design (NEXT_PUBLIC_, URL-restricted at Mapbox — see
 * docs/DEPLOYMENT.md). Without one the page is exactly the grid it was, rather
 * than a grey box.
 */
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export default function FacilitiesPage() {
  if (MAPBOX_TOKEN) {
    return (
      <Suspense fallback={<FacilitiesMapSkeleton />}>
        <Streamed>
          <FacilitiesContent token={MAPBOX_TOKEN} />
        </Streamed>
      </Suspense>
    );
  }
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <PageHeader
        title="Facilities"
        info="Physical locations where your schedules run."
        actions={<AddFacilityButton />}
      />

      <Suspense fallback={<FacilitiesGridSkeleton />}>
        <Streamed className="space-y-6">
          <FacilitiesContent token="" />
        </Streamed>
      </Suspense>
    </div>
  );
}

/**
 * Shown in the static shell, before the viewer is known. A coordinator (no
 * facility:create) sees it in the grid fallback and is refused on submit; the
 * map view, which renders after the role is known, hides it from them.
 */
function AddFacilityButton() {
  return (
    <Button asChild>
      <Link href="/dashboard/facilities/new">
        <Plus className="w-4 h-4" />
        Add facility
      </Link>
    </Button>
  );
}

async function FacilitiesContent({ token }: { token: string }) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const supabase = await createClient();
  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const now = new Date().toISOString();
  const [{ data: facilities }, { data: notices }] = await Promise.all([
    supabase
      .from("facilities")
      .select(
        "id, slug, name, city, province, is_published, photo_urls, lat, lng, geocoded_at, departments(id), schedule_groups(id)"
      )
      .eq("org_id", orgContext.org.id)
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: FacilityRow[] | null }>,
    // ONE query for the whole org's live notices rather than a count per card
    // — the same shape the department counts use, and for the same reason: a
    // per-card query is N round trips to render a row that is usually empty.
    supabase
      .from("facility_notices")
      .select("facility_id, severity")
      .eq("org_id", orgContext.org.id)
      .eq("is_published", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`),
  ]);

  const liveByFacility = new Map<string, { count: number; worst: NoticeSeverity }>();
  for (const n of (notices ?? []) as { facility_id: string; severity: NoticeSeverity }[]) {
    const current = liveByFacility.get(n.facility_id);
    if (!current) {
      liveByFacility.set(n.facility_id, { count: 1, worst: n.severity });
    } else {
      current.count += 1;
      if (SEVERITY_RANK[n.severity] < SEVERITY_RANK[current.worst]) current.worst = n.severity;
    }
  }

  // Coordinators see the buildings they work in, not the whole organization:
  // RLS lets any member read every facility row (public pages need that), so
  // the narrowing is here. A pin they could not open would be a dead end.
  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  const readable = (facilities ?? []).filter((f) => canReadFacility(actor, f.id));

  const gridFacilities: FacilityMapItem[] = readable.map((f) => ({
    id: f.id,
    name: f.name,
    city: f.city,
    province: f.province,
    is_published: f.is_published,
    photo_urls: f.photo_urls,
    department_count: f.departments.length,
    schedule_count: f.schedule_groups.length,
    live_notice_count: liveByFacility.get(f.id)?.count ?? 0,
    worst_notice_severity: liveByFacility.get(f.id)?.worst ?? null,
    lat: f.lat,
    lng: f.lng,
    locationState: f.lat !== null && f.lng !== null ? "located" : f.geocoded_at ? "not_found" : "pending",
  }));
  const canCreate = can(actor, "facility:create");

  if (gridFacilities.length === 0) {
    const empty = (
      <EmptyState
        title="No facilities yet"
        titleAs="h2"
        description="Add a facility to start building your schedule."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/facilities/new">
              <Plus className="w-4 h-4" />
              Add your first facility
            </Link>
          </Button>
        }
      />
    );
    // The map layout carries its own title; with nothing to map, fall back
    // to the ordinary page frame around the empty state.
    if (!token) return empty;
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <PageHeader title="Facilities" info="Physical locations where your schedules run." />
        {empty}
      </div>
    );
  }

  if (token) {
    return <FacilitiesMapView facilities={gridFacilities} canCreate={canCreate} token={token} />;
  }

  // No token: the grid, server-rendered. FacilityGridCard is a plain link.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {gridFacilities.map((facility) => (
        <FacilityGridCard key={facility.id} facility={facility} />
      ))}
    </div>
  );
}

function FacilitiesMapSkeleton() {
  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mb-6 lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true">
      <Skeleton className="h-[45dvh] rounded-none lg:h-full" />
      <div className="space-y-3 p-5 lg:border-l lg:border-border">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}

function FacilitiesGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-56 rounded-card" />
      ))}
    </div>
  );
}
