import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import OrgContactForm from "@/components/org/OrgContactForm";
import { SettingsHeading, ReadOnlyNotice } from "@/components/settings/SettingsSection";

export const metadata = { title: "Contact · Settings" };

/** See dashboard/settings/page.tsx for what `instant` validates. */
export const instant = true;

export default function SettingsContactPage() {
  return (
    <>
      <SettingsHeading
        title="Contact & location"
        info="Published on your facility pages so a patron can phone or visit. Every field is optional — a blank one is hidden rather than shown empty."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <ContactBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function ContactBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes } = orgContext;
  const canEdit = can({ role: membership.role, scopes }, "org:edit-settings");

  // See the note on the same guard in dashboard/settings/page.tsx: the rail is
  // the section's contract, so a page the rail does not offer is a page the
  // route refuses. `canEdit` stays as the second layer.
  if (!canEdit) redirect("/dashboard/settings/account");

  return (
    <>
      {!canEdit && (
        <ReadOnlyNotice>
          Only the Owner and Managers can change these settings.
        </ReadOnlyNotice>
      )}

      <OrgContactForm
        canEdit={canEdit}
        defaultValues={{
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
