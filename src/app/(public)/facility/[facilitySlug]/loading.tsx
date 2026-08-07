import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streaming fallback for a public facility page.
 *
 * This route has no generateStaticParams, so the slug is only known at request
 * time and awaiting `params` counts as request data. Without this boundary the
 * whole route is blocked from prerendering, even though the facility data
 * itself is cached.
 */
export default function FacilityLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" aria-busy="true">
      <Skeleton className="h-4 w-64 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
