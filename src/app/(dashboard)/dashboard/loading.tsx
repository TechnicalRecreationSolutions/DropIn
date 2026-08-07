import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streaming fallback for every route under /dashboard.
 *
 * Placed at the /dashboard segment so it wraps the page slot in a Suspense
 * boundary that is visible to sibling client-side navigations — a boundary in
 * the root layout would sit above the shared dashboard layout and never fire
 * when moving between dashboard pages.
 *
 * Nested segments can override this with their own loading.tsx where a more
 * specific shape reads better than the generic one.
 */
export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-8" aria-busy="true">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>

      {/* A list section */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <div className="rounded-xl border border-border divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className="h-4 flex-1 max-w-64" />
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
