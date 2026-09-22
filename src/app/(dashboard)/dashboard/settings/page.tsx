import { Suspense } from "react";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import OrgSettingsForm from "@/components/org/OrgSettingsForm";
import TransferOwnership, { type TransferCandidate } from "@/components/org/TransferOwnership";
import { createClient } from "@/lib/supabase/server";
import Streamed from "@/components/ui/streamed";
import { PageHeader } from "@/components/ui/info-tip";

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
        <PageHeader title="Organization" />
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

  const { org, membership, scopes } = orgContext;
  const actor = { role: membership.role, scopes };
  const canEdit = can(actor, "org:edit-settings");
  const canTransfer = can(actor, "org:transfer-ownership");

  // Ownership can only go to someone already inside the org — transferring to a
  // stranger would mean minting a membership and handing over the organization
  // in one unreviewable step, which transfer_ownership() refuses outright.
  let candidates: TransferCandidate[] = [];
  if (canTransfer) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("org_memberships")
      .select("id, email, role")
      .eq("org_id", org.id)
      .neq("user_id", membership.user_id)
      .order("joined_at", { ascending: true });

    candidates = (data ?? []).map((m) => ({
      membershipId: m.id,
      email: m.email,
      role: m.role,
    }));
  }

  return (
    <>
      {!canEdit && (
        <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2.5">
          Only the owner and managers can change these settings.
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

      {canTransfer && <TransferOwnership orgName={org.name} candidates={candidates} />}
    </>
  );
}
