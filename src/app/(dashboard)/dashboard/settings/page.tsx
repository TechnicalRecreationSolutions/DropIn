import { getOrgContext } from "@/lib/auth/session";
import OrgSettingsForm from "@/components/org/OrgSettingsForm";

export const metadata = { title: "Organization settings" };

/**
 * The org profile editor — the first UI in this app that writes
 * `organizations`. Until now the row was created by onboarding and never
 * touched again, which is why `logo_url` had a storage folder, a policy and
 * two render sites but no way to ever be set.
 */
export default async function OrgSettingsPage() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership } = orgContext;
  const canEdit = ["owner", "admin"].includes(membership.role);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organization</h1>
        <p className="text-gray-500 mt-1">
          Your organization&apos;s name, logo and contact details.
        </p>
      </div>

      {!canEdit && (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
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
    </div>
  );
}
