import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import WidgetStudio from "@/components/widget/WidgetStudio";
import Streamed from "@/components/ui/streamed";

interface WidgetPageProps {
  searchParams: Promise<{ facility?: string; department?: string }>;
}

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
 */
export const instant = true;

export default function WidgetPage({ searchParams }: WidgetPageProps) {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Put your schedule on your website</h1>
        <p className="text-muted-foreground mt-1">
          Design the schedule box your visitors see, then copy the code that puts it on your site.
        </p>
      </div>

      {/* searchParams is forwarded unread — awaiting it here would pull this
          static shell into the dynamic, Suspense-gated render. */}
      <Suspense fallback={<WidgetStudioSkeleton />}>
        <Streamed className="space-y-6">
          <WidgetBody searchParams={searchParams} />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function WidgetBody({ searchParams }: WidgetPageProps) {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { facility, department } = await searchParams;

  const supabase = await createClient();
  // slug + is_published carry the "link to it instead of embedding it" option
  // in step 4 — an unpublished facility has no public page to point at.
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name, slug, is_published")
    .eq("org_id", orgContext.org.id)
    .order("name");

  // Only carry the sidebar's current facility/department into the picker if
  // it actually belongs to this org — otherwise fall back to unscoped rather
  // than pre-selecting an id that won't resolve to anything.
  const initialFacilityId = facilities?.some((f) => f.id === facility) ? facility : undefined;
  let initialDepartmentId: string | undefined;
  if (initialFacilityId && department) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", department)
      .eq("facility_id", initialFacilityId)
      .maybeSingle();
    initialDepartmentId = dept?.id;
  }

  return (
    <WidgetStudio
      orgId={orgContext.org.id}
      facilities={(facilities ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        isPublished: f.is_published,
      }))}
      initialFacilityId={initialFacilityId}
      initialDepartmentId={initialDepartmentId}
    />
  );
}

/** Mirrors the studio's shape — CTA banner then stacked steps — so the page doesn't jump. */
function WidgetStudioSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
