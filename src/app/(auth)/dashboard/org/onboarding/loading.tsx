import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streaming fallback for org onboarding. The page reads the session and checks
 * for an existing membership, so it needs a boundary of its own to let the
 * route prerender a static shell.
 */
export default function OnboardingLoading() {
  return (
    <div className="max-w-md mx-auto py-12 space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}
