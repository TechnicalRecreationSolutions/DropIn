import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import BrochuresManager, { type BrochureListItem } from "@/components/brochure/BrochuresManager";

/**
 * Brochures — the seasonal publication built from what the org already entered.
 *
 * The second output of "one entry, many surfaces": a session flagged for the
 * brochure is *suggested* here, pulled in explicitly, re-worded freely, and
 * published at a public URL — with no second source of truth to drift.
 *
 * Read the header of migration 031 before changing anything about how entries
 * are created or removed. The candidacy → membership → publication model is
 * what stops a brochure rewriting itself when a season rolls over.
 *
 * Static shell + streamed body, matching the other dashboard routes.
 */
export const unstable_instant = { prefetch: "static" };

export default function BrochuresPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Brochures</h1>
        <p className="text-gray-500 mt-1">
          Seasonal publications assembled from your own sessions and programs. Build one, print
          it, or publish it at a public link.
        </p>
      </div>

      <Suspense fallback={<BrochuresSkeleton />}>
        <BrochuresBody />
      </Suspense>
    </div>
  );
}

async function BrochuresBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const orgId = orgContext.org.id;
  const supabase = await createClient();

  const [{ data: brochureRows }, { data: seasonRows }, { data: entryRows }] = await Promise.all([
    supabase
      .from("brochures")
      .select("id, title, subtitle, slug, status, season_id, published_at, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("seasons")
      .select("id, name, starts_on, ends_on")
      .eq("org_id", orgId)
      .order("starts_on", { ascending: false }),
    // Included entries only: a count that included tombstones would report a
    // brochure as fuller than it prints.
    supabase
      .from("brochure_entries")
      .select("brochure_id")
      .eq("org_id", orgId)
      .eq("status", "included"),
  ]);

  const counts = new Map<string, number>();
  for (const row of entryRows ?? []) {
    counts.set(row.brochure_id, (counts.get(row.brochure_id) ?? 0) + 1);
  }

  const seasonNames = new Map((seasonRows ?? []).map((s) => [s.id, s.name]));

  const brochures: BrochureListItem[] = (brochureRows ?? []).map((b) => ({
    ...b,
    season_name: b.season_id ? (seasonNames.get(b.season_id) ?? null) : null,
    entry_count: counts.get(b.id) ?? 0,
  }));

  // Creating and publishing follows migration 031's owner/admin line. Members
  // still see the list and can assemble what's inside one.
  const canManage =
    orgContext.membership.role === "owner" || orgContext.membership.role === "admin";

  return (
    <BrochuresManager
      brochures={brochures}
      seasons={seasonRows ?? []}
      canManage={canManage}
      orgSlug={orgContext.org.slug}
    />
  );
}

function BrochuresSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}
