import { Suspense } from "react";
import Link from "next/link";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Upload, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";

// Unrelated to session-time removal (dropin/docs/RESUME-timezone-removal.md):
// created_at is a real instant, not a session occurrence, and this page
// renders server-side (UTC in production) — see the comment below.
const IMPORT_TIMESTAMP_TIMEZONE = "America/Edmonton";

type ImportedScheduleGroupRow = {
  id: string;
  name: string;
  created_at: string;
  facilities: { name: string } | null;
};

/**
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

export default function DataSourcesPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Sources</h1>
        <p className="text-muted-foreground mt-1">
          Cross-org history for everything imported into Dropin. To add new data, navigate
          to the facility, department, or schedule it belongs to and use &quot;Add data&quot; there.
        </p>
      </div>

      <Link
        href="/dashboard/import"
        className="flex items-center gap-3 p-4 bg-card rounded-xl border border-border hover:border-blue-300 hover:shadow-sm transition-all group"
      >
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">Import a spreadsheet</p>
          <p className="text-sm text-muted-foreground">Org-wide import, pick a facility</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-blue-400 transition-colors" />
      </Link>

      <Suspense fallback={<RecentImportsSkeleton />}>
        <Streamed className="space-y-8">
          <RecentImports />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function RecentImports() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();

  // Relational select — cast needed until Supabase CLI generates types with FK relations
  const { data: recentImports } = (await supabase
    .from("schedule_groups")
    .select("id, name, created_at, facilities(name)")
    .eq("org_id", orgContext.org.id)
    .eq("source", "imported")
    .order("created_at", { ascending: false })
    .limit(20)) as unknown as { data: ImportedScheduleGroupRow[] | null };

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h2 className="font-semibold text-foreground mb-4">Recent imports</h2>
      {!recentImports || recentImports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spreadsheet imports yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {recentImports.map((sg) => (
            <li key={sg.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{sg.name}</p>
                <p className="text-xs text-muted-foreground">
                  {/* Explicit zone: this is a server component, so an
                      unqualified toLocaleString() formats in the server's
                      zone — UTC in production — and showed staff import
                      timestamps hours off from when they actually imported. */}
                  {sg.facilities?.name ?? "Unknown facility"} ·{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: IMPORT_TIMESTAMP_TIMEZONE,
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(sg.created_at))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentImportsSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border p-6" aria-busy="true">
      <Skeleton className="h-4 w-32 mb-4" />
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="py-3 space-y-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
