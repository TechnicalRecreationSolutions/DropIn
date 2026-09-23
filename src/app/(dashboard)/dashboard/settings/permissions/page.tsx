import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import OrgPermissionsForm from "@/components/org/OrgPermissionsForm";
import RoleMatrix from "@/components/settings/RoleMatrix";
import { SettingsHeading, SettingsCard } from "@/components/settings/SettingsSection";

export const metadata = { title: "Permissions · Settings" };

/** See dashboard/settings/page.tsx for what `instant` validates. */
export const instant = true;

export default function SettingsPermissionsPage() {
  return (
    <>
      <SettingsHeading
        title="Permissions"
        info="What each kind of account is allowed to do, and the one part of it your organization chooses. Roles are assigned per person on the Staff page."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <PermissionsBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function PermissionsBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes } = orgContext;
  const actor = { role: membership.role, scopes };

  // The rail does not offer this page below Manager, but a typed or shared URL
  // has to land somewhere sensible rather than on a page of controls that
  // silently refuse. Settings is always reachable — Your account is there for
  // every role — so that is where it goes.
  if (!can(actor, "org:edit-settings")) redirect("/dashboard/settings/account");

  return (
    <>
      <OrgPermissionsForm auxCanPostNotices={org.aux_can_post_notices} canEdit />

      <SettingsCard
        title="What each role can do"
        description="Fixed, and the same in every organization. Assign them per person on the Staff page."
      >
        <RoleMatrix />
        <p className="mt-5 text-sm text-muted-foreground">
          Coordinators are limited to the departments assigned to them, and Staff accounts
          to their facilities. Set that per person on{" "}
          <Link href="/dashboard/settings/staff" className="text-blue-600 hover:underline dark:text-blue-400">
            Staff
          </Link>
          .
        </p>
      </SettingsCard>
    </>
  );
}
