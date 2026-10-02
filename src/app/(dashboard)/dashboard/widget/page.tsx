import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { can, isReadOnly } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import WidgetStudio from "@/components/widget/WidgetStudio";
import Streamed from "@/components/ui/streamed";

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
 *
 * The title row belongs to the studio (its status line and Publish button
 * need the loaded config), so the static shell is the skeleton, which carries
 * the real title text.
 */
export const instant = true;

export default function WidgetPage() {
  return (
    <div className="max-w-[1200px] mx-auto">
      <Suspense fallback={<WidgetStudioSkeleton />}>
        <Streamed>
          <WidgetBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function WidgetBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;
  // Read-only staff (aux) have nothing to do here, and the navigation not
  // offering this page is not a guard. Coordinators are not read-only.
  if (isReadOnly(orgContext.membership.role)) redirect("/dashboard/schedule");

  const supabase = await createClient();
  // slug + is_published carry the "link to it instead of embedding it" option
  // in Install, and the header's "View your facility page" link — an
  // unpublished facility has no public page to point at.
  const [{ data: facilities }, { count: scheduleCount }] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, slug, is_published")
      .eq("org_id", orgContext.org.id)
      .order("name"),
    // Only whether there are any: the Schedules section's empty state.
    supabase
      .from("schedule_groups")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgContext.org.id),
  ]);

  return (
    <WidgetStudio
      orgId={orgContext.org.id}
      // Install says where the code will work (Settings › Embedding,
      // migration 067). null = column not there yet, so nothing is claimed.
      trustedHosts={
        Array.isArray((orgContext.org as { embed_allowed_hosts?: unknown }).embed_allowed_hosts)
          ? orgContext.org.embed_allowed_hosts
          : null
      }
      canManageTrustedSites={can(
        { role: orgContext.membership.role, scopes: orgContext.scopes },
        "org:edit-settings"
      )}
      hasSchedules={(scheduleCount ?? 0) > 0}
      facilities={(facilities ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        isPublished: f.is_published,
      }))}
    />
  );
}

/** Mirrors the studio's shape — header, four tiles, settings card beside the preview — so the page doesn't jump. */
function WidgetStudioSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-title text-foreground">Website widget</h1>
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40 rounded-full" />
          <Skeleton className="hidden h-10 w-36 rounded-full sm:block" />
        </div>
      </div>
      <div className="flex gap-2 overflow-hidden sm:grid sm:grid-cols-2 sm:gap-3 studio:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full sm:h-[104px] sm:w-auto sm:rounded-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-6 studio:grid-cols-[520px_minmax(0,1fr)]">
        <Skeleton className="h-[480px] rounded-card" />
        <Skeleton className="h-14 rounded-panel studio:h-[800px]" />
      </div>
    </div>
  );
}
