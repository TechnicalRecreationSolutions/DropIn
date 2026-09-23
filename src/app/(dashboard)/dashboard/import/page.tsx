import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import ImportWizard from "@/components/import/ImportWizard";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";

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
        <PageHeader title="Import schedule" info="Upload a CSV to bulk-import schedules and sessions." />
      </div>

      <Suspense fallback={<Skeleton className="h-56 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-6">
          <ImportWizardBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

/**
 * The wizard itself. Guarded on `import:use`, which it was not before: the
 * only thing keeping a Coordinator or a lifeguard out was that no navigation
 * offered the page. Its two API routes now refuse them too, so this is the
 * layer that gives an answer rather than a broken wizard.
 */
async function ImportWizardBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  if (!can({ role: orgContext.membership.role, scopes: orgContext.scopes }, "import:use")) {
    redirect("/dashboard/settings/account");
  }

  const supabase = await createClient();
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name")
    .eq("org_id", orgContext.org.id)
    .order("name");

  return <ImportWizard facilities={facilities ?? []} />;
}
