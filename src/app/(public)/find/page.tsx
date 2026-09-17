import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { getDirectoryListings } from "@/lib/directory/listings";
import FindClient from "./FindClient";

export const metadata: Metadata = {
  title: "Find a recreation centre",
  // ?q= and ?sport= are views of this one page, not pages of their own.
  alternates: { canonical: "/find" },
  description:
    "Search recreation centres near you and see their drop-in schedules — swimming, skating, gym and more. No account needed.",
};

/**
 * /find — the resident directory (docs/PLAN.md, 2026-09-16).
 *
 * The heading is static; the results sit in a Suspense boundary because
 * FindClient reads the query string, which only exists at request time.
 * The listing set itself is the shared "use cache" entry the public API also
 * serves, so a facility save expires this page's data as well.
 */
export default function FindPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Find a recreation centre</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Search by name or city, or use your location to see what’s nearby. Open a centre to see its drop-in
        schedule — no account needed.
      </p>
      <div className="mt-6">
        <Suspense fallback={<ResultsSkeleton />}>
          <DirectoryResults />
        </Suspense>
      </div>
    </div>
  );
}

async function DirectoryResults() {
  // A failed read renders the "unavailable" state rather than failing the
  // request. The data's cacheLife is minutes, so a failure caught during a
  // prerender is replaced on the next revalidation instead of sticking.
  const listings = await getDirectoryListings().catch((err: unknown) => {
    console.error("[find]", err instanceof Error ? err.message : err);
    return null;
  });
  return <FindClient listings={listings} />;
}

function ResultsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading centres">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-12 flex-1 rounded-xl" />
        <Skeleton className="h-12 rounded-xl sm:w-44" />
      </div>
      <div className="mt-3 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-8 grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
