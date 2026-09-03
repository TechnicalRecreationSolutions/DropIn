import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { Skeleton } from "@/components/ui/skeleton";
import OrgSettingsForm from "@/components/org/OrgSettingsForm";
import Streamed from "@/components/ui/streamed";

export const metadata = { title: "Organization settings" };

/**
 * The org profile editor — the first UI in this app that writes
 * `organizations`. Until now the row was created by onboarding and never
 * touched again, which is why `logo_url` had a storage folder, a policy and
 * two render sites but no way to ever be set.
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

export default function OrgSettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Organization</h1>
        <p className="text-muted-foreground mt-1">
          Your organization&apos;s name, logo and contact details.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-6">
          <OrgSettingsBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function OrgSettingsBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership } = orgContext;
  const canEdit = ["owner", "admin"].includes(membership.role);

  return (
    <>
      {!canEdit && (
        <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2.5">
          Only owners and admins can change these settings.
        </p>
      )}

      <OrgSettingsForm
        orgId={org.id}
        logoUrl={org.logo_url}
        canEdit={canEdit}
        defaultValues={{
          name: org.name,
          description: org.description ?? "",
          website_url: org.website_url ?? "",
          phone: org.phone ?? "",
          email: org.email ?? "",
          address_line1: org.address_line1 ?? "",
          city: org.city ?? "",
          province: org.province ?? "",
          postal_code: org.postal_code ?? "",
        }}
      />
    </>
  );
}
