import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import SeasonsManager, { type SeasonWithUsage } from "@/components/seasons/SeasonsManager";

/**
 * Seasons — the org's named planning periods ("Fall 2026", Sep 8 – Dec 20).
 *
 * A season is the period an org actually schedules, publishes, and prints in.
 * Sessions opt into one, and everything seasonal built on top (the event
 * calendar's date window, the brochure's candidate range) resolves through
 * `lib/seasons/current.ts` rather than re-deriving dates per surface.
 *
 * Seasons are org-level on purpose: one "Fall 2026" spanning every building,
 * not one per facility. See the header of migration 027 for that decision and
 * the ones around it.
 *
 * Validated for instant client-side navigation, matching the other dashboard
 * routes: the shell is static and the org-specific body streams behind one
 * Suspense boundary, which has to live inside this page rather than the layout
 * (see the note in dashboard/facilities/page.tsx).
 */
export const unstable_instant = { prefetch: "static" };

export default function SeasonsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Seasons</h1>
        <p className="text-gray-500 mt-1">
          The periods you plan in. Sessions belong to a season, and schedules stay pointed at the
          right one as the year moves on.
        </p>
      </div>

      <Suspense fallback={<SeasonsSkeleton />}>
        <SeasonsBody />
      </Suspense>
    </div>
  );
}

async function SeasonsBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();

  const [{ data: seasonRows }, { data: assignedRows }] = await Promise.all([
    supabase
      .from("seasons")
      .select("*")
      .eq("org_id", orgId)
      .order("starts_on", { ascending: false }),
    // Session counts, gathered the same way GET /api/seasons does — see the
    // note there for why this isn't a grouped query or N round trips.
    supabase
      .from("sessions")
      .select("season_id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .not("season_id", "is", null),
  ]);

  const counts = new Map<string, number>();
  for (const row of assignedRows ?? []) {
    if (row.season_id) counts.set(row.season_id, (counts.get(row.season_id) ?? 0) + 1);
  }

  const seasons: SeasonWithUsage[] = (seasonRows ?? []).map((season) => ({
    ...season,
    session_count: counts.get(season.id) ?? 0,
  }));

  // Creating and re-dating a season is structural planning, so it follows the
  // same owner/admin line the API route and the RLS policy in 027 enforce.
  // Members still see the list — they schedule into these periods.
  const canManage = orgContext.membership.role === "owner" || orgContext.membership.role === "admin";

  return <SeasonsManager initialSeasons={seasons} canManage={canManage} />;
}

function SeasonsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}
