import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import TransferOwnership, { type TransferCandidate } from "@/components/org/TransferOwnership";
import DeleteOrganization, { type DeletionScale } from "@/components/org/DeleteOrganization";
import { SettingsHeading } from "@/components/settings/SettingsSection";

export const metadata = { title: "Danger zone · Settings" };

/**
 * The two things that end an organization, on a page of their own.
 *
 * Both were previously reachable only by scrolling past a postal-code field:
 * ownership transfer sat at the bottom of the old Organization form, and
 * deletion did not exist at all — `org:delete` had been declared in
 * `lib/auth/roles.ts` since migration 055 with no policy, no route and no
 * button behind it.
 *
 * Owner-only, and gated on `org:transfer-ownership` rather than on `org:delete`
 * because the two are the same set and the transfer is the one that is always
 * offered. A Manager who types this URL is sent to their own account page.
 *
 * See dashboard/settings/page.tsx for what `instant` validates.
 */
export const instant = true;

export default function SettingsDangerPage() {
  return (
    <>
      <SettingsHeading
        title="Danger zone"
        info="Handing the organization to someone else, and closing it for good. Both are Owner-only, and neither can be undone by the person doing it."
      />

      <Suspense fallback={<Skeleton className="h-64 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-8">
          <DangerBody />
        </Streamed>
      </Suspense>
    </>
  );
}

async function DangerBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes, subscription } = orgContext;
  const actor = { role: membership.role, scopes };

  if (!can(actor, "org:transfer-ownership")) redirect("/dashboard/settings/account");

  const supabase = await createClient();

  // Ownership can only go to someone already inside the org — transferring to a
  // stranger would mean minting a membership and handing over the organization
  // in one unreviewable step, which transfer_ownership() refuses outright.
  const candidatesQuery = supabase
    .from("org_memberships")
    .select("id, email, role")
    .eq("org_id", org.id)
    .neq("user_id", membership.user_id)
    .order("joined_at", { ascending: true });

  // `head: true` with an exact count: PostgREST returns the number in the
  // Content-Range header and no rows at all. Selecting the rows to call
  // `.length` on them would pull every session in the organization across the
  // wire to render one integer — and would silently cap at 1,000, which is the
  // trap that has already produced one wrong number in this codebase.
  const countOf = (table: "facilities" | "departments" | "schedule_groups" | "sessions" | "org_memberships") =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("org_id", org.id);

  const [candidateRows, facilities, departments, schedules, sessions, staff] = await Promise.all([
    candidatesQuery,
    countOf("facilities"),
    countOf("departments"),
    countOf("schedule_groups"),
    countOf("sessions"),
    countOf("org_memberships"),
  ]);

  const candidates: TransferCandidate[] = (candidateRows.data ?? []).map((m) => ({
    membershipId: m.id,
    email: m.email,
    role: m.role,
  }));

  const scale: DeletionScale = {
    facilities: facilities.count ?? 0,
    departments: departments.count ?? 0,
    schedules: schedules.count ?? 0,
    sessions: sessions.count ?? 0,
    staff: staff.count ?? 0,
  };

  // The same statuses `delete_organization()` refuses on (migration 062). Kept
  // in step deliberately: if these two lists drift, the page either hides a
  // delete button that would have worked or offers one that always fails.
  const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid", "incomplete"];
  const blockedBySubscription =
    !!subscription && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);

  return (
    <>
      <TransferOwnership orgName={org.name} candidates={candidates} />
      <DeleteOrganization
        orgName={org.name}
        scale={scale}
        blockedBySubscription={blockedBySubscription}
      />
    </>
  );
}
