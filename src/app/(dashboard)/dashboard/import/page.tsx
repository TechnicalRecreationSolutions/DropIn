import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import ImportWizard from "@/components/import/ImportWizard";
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
 */
export const instant = true;

export default function ImportPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Import schedule</h1>
        <p className="text-muted-foreground mt-1">
          Upload a CSV file to bulk-import schedules and sessions.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-56 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-6">
          <ImportWizardBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function ImportWizardBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const supabase = await createClient();
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  return <ImportWizard facilities={facilities ?? []} />;
}
