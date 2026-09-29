import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fallbacks for the dashboard chrome. These are what the prerendered static
 * shell contains, so they must match the real components' dimensions closely —
 * any mismatch shows up as layout shift the moment the org data streams in.
 */

export function TreeNavSkeleton() {
  return (
    <aside
      className="hidden lg:flex flex-col w-62 sticky top-0 h-screen bg-sidebar shrink-0 border-r border-border"
      aria-hidden
    >
      <div className="px-4 pt-3 pb-2">
        <div className="flex h-8 items-center">
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-3.5 w-28" />
      </div>
      <div className="flex-1 px-2 py-3 space-y-0.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 rounded-control" />
        ))}
      </div>
    </aside>
  );
}

export function TopbarSkeleton() {
  return (
    <header
      className="sticky top-0 z-40 bg-background border-b border-border px-4 sm:px-6 h-14 flex items-center justify-between"
      aria-hidden
    >
      <Skeleton className="h-5 w-16 lg:hidden" />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-6 w-11 rounded-full" />
      </div>
    </header>
  );
}

/**
 * Fallback for the page slot itself. This is the boundary that lets the route
 * prerender: without it the page's own data access sits directly under the
 * layout, which blocks the whole shell.
 */
export function DashboardPageSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6" aria-busy="true">
      {/* Shaped like the Overview it stands in for: title + date, the alert
          line, the today ribbon, then the schedule list. A skeleton whose
          blocks land somewhere else is a second layout the eye has to
          re-learn the moment the real one arrives. */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-44" />
      </div>
      <Skeleton className="h-5 w-72" />
      <div className="rounded-card border border-border p-5 space-y-3">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-24 w-full rounded-control" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <div className="rounded-card border border-border divide-y divide-border">
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

/**
 * Fallback for the mobile tab bar.
 *
 * DashboardBottomNav calls usePathname() to mark the active tab, and on a
 * dynamic route the pathname is not known at prerender time — so it counts as
 * request data and needs a boundary of its own, or it blocks the entire shell.
 */
export function BottomNavSkeleton() {
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border pb-[env(safe-area-inset-bottom)]"
      aria-hidden
    >
      <div className="mx-auto flex max-w-lg">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 min-h-14">
            <Skeleton className="h-8 w-14 rounded-full" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        ))}
      </div>
    </nav>
  );
}

export function MobileSheetSkeleton() {
  return (
    <div className="flex-1 px-2 py-3 space-y-0.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 rounded-control" />
      ))}
    </div>
  );
}
