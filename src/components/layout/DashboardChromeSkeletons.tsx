import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fallbacks for the dashboard chrome. These are what the prerendered static
 * shell contains, so they must match the real components' dimensions closely —
 * any mismatch shows up as layout shift the moment the org data streams in.
 */

export function TreeNavSkeleton() {
  return (
    <aside
      className="hidden lg:flex flex-col w-72 min-h-screen bg-sidebar text-sidebar-foreground shrink-0 border-r border-sidebar-border"
      aria-hidden
    >
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 mb-1">
          <Skeleton className="size-4 rounded bg-sidebar-accent/50" />
          <Skeleton className="h-5 w-20 bg-sidebar-accent/50" />
        </div>
        <Skeleton className="h-3 w-28 bg-sidebar-accent/40" />
      </div>
      <div className="flex-1 px-2 py-3 space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 rounded bg-sidebar-accent/40" />
        ))}
      </div>
    </aside>
  );
}

export function TopbarSkeleton() {
  return (
    <header
      className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between"
      aria-hidden
    >
      <Skeleton className="h-8 w-8 rounded lg:hidden" />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="size-4 rounded" />
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
    <div className="max-w-5xl mx-auto space-y-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
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
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex"
      aria-hidden
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 py-3">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      ))}
    </nav>
  );
}

export function MobileSheetSkeleton() {
  return (
    <div className="flex-1 px-2 py-3 space-y-1.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-6 rounded bg-sidebar-accent/40" />
      ))}
    </div>
  );
}
