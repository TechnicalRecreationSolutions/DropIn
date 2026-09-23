import { Suspense } from "react";
import Link from "next/link";
import { getOrgContext, getUser } from "@/lib/auth/session";
import { can, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import { Badge } from "@/components/ui/badge";
import AccountPanel from "@/components/account/AccountPanel";
import LeaveOrganization from "@/components/account/LeaveOrganization";
import {
  SettingsHeading,
  SettingsCard,
  SettingsFacts,
  SettingsFact,
} from "@/components/settings/SettingsSection";

export const metadata = { title: "Your account · Settings" };

/** See dashboard/settings/page.tsx for what `instant` validates. */
export const instant = true;

/**
 * The one settings page with no permission on it.
 *
 * Every other page in this section is gated, and an aux staffer reaching
 * Settings finds exactly this one — which is correct, and is the reason the
 * section itself is offered to every role rather than hidden below Manager. A
 * person who cannot change their own password is a person whose leaked
 * password stays valid, and that was true of this product until now.
 */
export default function SettingsAccountPage() {
  return (
    <>
      <SettingsHeading
        title="Your account"
        info="Your sign-in details and this device's preferences. Nothing here affects anyone else in your organization."
      />

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <AccountBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function AccountBody() {
  // getUser() rather than the token claims: this page prints the address the
  // account actually has right now, and a token minted before a confirmed
  // email change still carries the old one.
  const [user, orgContext] = await Promise.all([getUser(), getOrgContext()]);

  return (
    <>
      <AccountPanel email={user?.email ?? null} />

      {orgContext && <AccessCard orgContext={orgContext} />}

      {/* The owner is filtered out here rather than inside the component:
          `leave_organization()` refuses them outright, and Danger zone offers
          them the two things they can actually do instead. */}
      {orgContext && orgContext.membership.role !== "owner" && (
        <LeaveOrganization orgName={orgContext.org.name} />
      )}
    </>
  );
}

/**
 * What this person can reach, in their own words rather than the permission
 * model's.
 *
 * A Coordinator's departments and a Staff account's facilities are the single
 * most common source of "why can't I see the pool schedule" — the answer is
 * almost always a scope nobody told them about. Naming the rows here means the
 * person can read their own answer before asking.
 */
async function AccessCard({
  orgContext,
}: {
  orgContext: NonNullable<Awaited<ReturnType<typeof getOrgContext>>>;
}) {
  const { org, membership, scopes } = orgContext;
  const role = membership.role;

  // Only asked for when there is something to ask about: an owner or manager
  // carries empty scope lists, and those empty lists mean "everything", not
  // "nothing" — querying for them would cost a round trip to render a blank.
  let scopeNames: string[] = [];
  if (scopes.departmentIds.length > 0 || scopes.facilityIds.length > 0) {
    const supabase = await createClient();
    const [departments, facilities] = await Promise.all([
      scopes.departmentIds.length > 0
        ? supabase.from("departments").select("name").in("id", scopes.departmentIds)
        : Promise.resolve({ data: [] as { name: string }[] }),
      scopes.facilityIds.length > 0
        ? supabase.from("facilities").select("name").in("id", scopes.facilityIds)
        : Promise.resolve({ data: [] as { name: string }[] }),
    ]);
    scopeNames = [
      ...(facilities.data ?? []).map((f) => f.name),
      ...(departments.data ?? []).map((d) => d.name),
    ];
  }

  return (
    <SettingsCard title="Your access" description="Set by a Manager. Ask one if something is missing.">
      <SettingsFacts>
        <SettingsFact label="Organization">{org.name}</SettingsFact>
        <SettingsFact label="Your role" info={ROLE_DESCRIPTIONS[role]}>
          {ROLE_LABELS[role]}
        </SettingsFact>
      </SettingsFacts>

      <div className="mt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What you can reach
        </p>
        {scopeNames.length === 0 ? (
          <p className="mt-1 text-sm text-foreground">
            {role === "owner" || role === "manager"
              ? "Every facility and department in this organization."
              : "Nothing is assigned to you yet, so most pages will look empty. Ask a Manager to assign your facilities or departments."}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {scopeNames.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {can({ role, scopes }, "staff:view") && (
        <p className="mt-5 text-sm text-muted-foreground">
          Roles and assignments are changed on{" "}
          <Link
            href="/dashboard/settings/staff"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Staff
          </Link>
          .
        </p>
      )}
    </SettingsCard>
  );
}
