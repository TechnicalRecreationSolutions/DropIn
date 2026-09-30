import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { loadStatusTemplates } from "@/lib/status/load-templates";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import StatusLibrary from "@/components/status/StatusLibrary";
import { SettingsHeading } from "@/components/settings/SettingsSection";

export const metadata = { title: "Statuses · Settings" };

/** See dashboard/settings/page.tsx for what `instant` validates. */
export const instant = true;

/**
 * /dashboard/settings/statuses — the statuses staff can post (migration 064),
 * and which departments are offered each one.
 */
export default function SettingsStatusesPage() {
  return (
    <>
      <SettingsHeading
        title="Statuses"
        info="The list staff pick from when they post a facility status. Assign a status to departments so each one only sees what applies to it — a tennis department does not need a pool contamination. Anything assigned to no department is offered everywhere."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-card" aria-busy="true" />}>
        <Streamed>
          <StatusesBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function StatusesBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const actor = { role: orgContext.membership.role, scopes: orgContext.scopes };
  // The rail hides this below Manager; a typed URL still has to land somewhere.
  if (!can(actor, "notice-template:manage")) redirect("/dashboard/settings/account");

  const supabase = await createClient();
  const [{ templates, fromLibrary }, { data: departments }] = await Promise.all([
    loadStatusTemplates(supabase, orgContext.org.id),
    supabase
      .from("departments")
      .select("id, name, display_order, facilities!inner(name)")
      .eq("org_id", orgContext.org.id)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (!fromLibrary) {
    return (
      <Banner variant="warning" role={undefined}>
        The status library is not switched on yet (migration 064). Staff see the built-in list
        until it is.
      </Banner>
    );
  }

  const rows = ((departments ?? []) as unknown as {
    id: string;
    name: string;
    facilities: { name: string };
  }[])
    .map((d) => ({ id: d.id, name: d.name, facilityName: d.facilities.name }))
    .sort((a, b) => a.facilityName.localeCompare(b.facilityName));

  return <StatusLibrary templates={templates} departments={rows} />;
}
