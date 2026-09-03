import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import ActivityLogView from "@/components/activity/ActivityLogView";
import type { ActivityEntry } from "@/components/activity/types";
import Streamed from "@/components/ui/streamed";

const PAGE_SIZE = 30;

/**
 * /dashboard/activity — every logged change across facilities, departments,
 * spaces, schedules, sessions and session templates for this org, newest
 * first, with a revert option for owners/admins. See 038_activity_log.sql
 * for what writes here and why.
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

export default function ActivityPage() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Activity log</h1>
        <p className="text-gray-500 mt-1">
          Every change to your facilities, schedules and sessions, and who made it.
        </p>
      </div>

      <Suspense fallback={<ActivityLogSkeleton />}>
        <Streamed>
          <ActivityLogBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function ActivityLogBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const [{ data }, { data: actorRows }] = await Promise.all([
    supabase
      .from("activity_log")
      .select("*")
      .eq("org_id", orgContext.org.id)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
    // Recent-actor sample for the filter dropdown, not a true DISTINCT —
    // cheap and good enough to populate "who" options for a single org's log.
    supabase
      .from("activity_log")
      .select("actor_email")
      .eq("org_id", orgContext.org.id)
      .not("actor_email", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const entries = (data ?? []) as ActivityEntry[];
  const nextCursor = entries.length === PAGE_SIZE ? entries[entries.length - 1].created_at : null;
  const canRevert = orgContext.membership.role === "owner" || orgContext.membership.role === "admin";
  const actors = Array.from(
    new Set((actorRows ?? []).map((r) => r.actor_email as string))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <ActivityLogView
      initialEntries={entries}
      initialCursor={nextCursor}
      canRevert={canRevert}
      actors={actors}
    />
  );
}

function ActivityLogSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 divide-y divide-gray-100" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
