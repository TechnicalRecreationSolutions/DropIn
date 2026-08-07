import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streaming fallback for the embedded widget iframe.
 *
 * Under Cache Components this boundary is what lets the widget ship a static
 * shell — without it the whole iframe stays blank until the org lookup and
 * schedule query finish, which is especially visible on a third-party site.
 */
export default function WidgetLoading() {
  return (
    <div className="p-4 space-y-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-md" />
        ))}
      </div>
    </div>
  );
}
