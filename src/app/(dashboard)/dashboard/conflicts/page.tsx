import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { findOrgConflicts } from "@/lib/sessions/conflicts";
import { Skeleton } from "@/components/ui/skeleton";
import ConflictManagerView from "@/components/conflicts/ConflictManagerView";
import Streamed from "@/components/ui/streamed";

/**
 * /dashboard/conflicts — every double-booking currently in the org (active
 * sessions sharing a space with an overlapping occurrence, draft schedules
 * included), with actions to resolve or dismiss each one. See
 * 039_session_conflict_dismissals.sql and findOrgConflicts() for what backs
 * this and why it's computed on demand rather than from a persisted table.
 *
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

export default function ConflictsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Conflicts</h1>
        <p className="text-muted-foreground mt-1">
          Sessions double-booked into the same space at the same time, and what to do about each one.
        </p>
      </div>

      <Suspense fallback={<ConflictsSkeleton />}>
        <Streamed>
          <ConflictsBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function ConflictsBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const conflicts = await findOrgConflicts(supabase, orgContext.org.id);

  return <ConflictManagerView initialConflicts={conflicts} />;
}

function ConflictsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
  );
}
