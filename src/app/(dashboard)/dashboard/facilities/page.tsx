import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import FacilityGridCard from "@/components/facilities/FacilityGridCard";
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
  departments: { id: string }[];
  schedule_groups: { id: string }[];
};

export default function FacilitiesPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <PageHeader
        title="Facilities"
        info="Physical locations where your schedules run."
        actions={
          <Button asChild>
            <Link href="/dashboard/facilities/new">
              <Plus className="w-4 h-4" />
              Add facility
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<FacilitiesGridSkeleton />}>
        <Streamed className="space-y-6">
          <FacilitiesGrid />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function FacilitiesGrid() {
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
        "id, slug, name, city, province, is_published, photo_urls, departments(id), schedule_groups(id)"
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

  const gridFacilities = (facilities ?? []).map((f) => ({
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
  }));

  if (gridFacilities.length === 0) {
    return (
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
  }

  // Rendered here rather than in a client component. This used to be a
  // grid/map toggle, and the map half plotted the org's own buildings with
  // mapbox-gl — the same library the cross-org search page used. A centre with
  // a handful of sites does not need them plotted geographically, and keeping
  // that view meant keeping a paid dependency, its token, address geocoding on
  // every save, and two extra origins in the CSP. With the toggle gone there is
  // no client state left to hold: FacilityGridCard is a plain link.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {gridFacilities.map((facility) => (
        <FacilityGridCard key={facility.id} facility={facility} />
      ))}
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
