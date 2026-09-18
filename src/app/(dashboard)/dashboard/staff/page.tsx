import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can, isScoped } from "@/lib/auth/roles";
import { Skeleton } from "@/components/ui/skeleton";
import Streamed from "@/components/ui/streamed";
import StaffPanel from "@/components/staff/StaffPanel";
import type { OrgRole } from "@/types/app.types";
import type { InvitationRow, MemberRow, ScopeRow } from "@/components/staff/types";

export const metadata = { title: "Staff" };

/**
 * Who can get into this organization, and what they can reach once they are in.
 *
 * Opted in to instant-navigation validation, like the other dashboard pages —
 * Next.js re-renders this route in dev as both a page load and a sibling client
 * navigation and reports if it stops producing a static shell. The Suspense
 * boundary has to live inside this page rather than in the layout; see the note
 * in dashboard/facilities/page.tsx.
 */
export const instant = true;

export default function StaffPage() {
  return (
    <div className="space-y-6">
      {/* Static — part of the prerendered shell, so it paints immediately. */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Staff</h1>
        <p className="text-muted-foreground mt-1">
          Everyone who can sign in to your organization, and what each of them can change.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-96 rounded-xl" aria-busy="true" />}>
        <Streamed className="space-y-6">
          <StaffBody />
        </Streamed>
      </Suspense>
    </div>
  );
}

async function StaffBody() {
  const orgContext = await getOrgContext();
  if (!orgContext) return null;

  const { org, membership, scopes } = orgContext;
  const actor = { role: membership.role, scopes };

  // Aux staff have no business here at all, and the sidebar does not offer it —
  // but a typed URL must land somewhere sensible rather than on an empty page.
  if (!can(actor, "staff:view")) redirect("/dashboard/schedule");

  const supabase = await createClient();

  // Four reads in parallel. Members and invitations are both small — a
  // recreation centre has staff, not users — so neither is paginated.
  //
  // The two embedded selects are cast once at the boundary: database.types.ts
  // is hand-maintained and leaves every `Relationships` array empty (see its
  // header), so PostgREST's embedded resources have no generated type. That
  // cast-once convention is used throughout src/app/api for the same reason.
  const [membersResult, invitationsResult, facilitiesResult, departmentsResult] =
    await Promise.all([
      supabase
        .from("org_memberships")
        .select(
          "id, user_id, role, email, display_name, joined_at, membership_scopes(department_id, facility_id)"
        )
        .eq("org_id", org.id)
        .order("joined_at", { ascending: true }) as unknown as Promise<{
        data: MemberRow[] | null;
      }>,
      supabase
        .from("staff_invitations")
        .select(
          "id, email, role, expires_at, created_at, invited_by, invitation_scopes(department_id, facility_id)"
        )
        .eq("org_id", org.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }) as unknown as Promise<{
        data: InvitationRow[] | null;
      }>,
      supabase
        .from("facilities")
        .select("id, name")
        .eq("org_id", org.id)
        .order("name", { ascending: true }),
      supabase
        .from("departments")
        .select("id, name, facility_id")
        .eq("org_id", org.id)
        .order("name", { ascending: true }),
    ]);

  const facilities = facilitiesResult.data ?? [];
  const departments = departmentsResult.data ?? [];

  // A coordinator sees the staff list, but only the people inside their own
  // facilities — the org's other coordinators and the owner's email are not
  // theirs to browse. Owners and managers are unscoped and see everyone.
  //
  // `isScoped()` rather than a bare check on the arrays: an owner's scope lists
  // are empty, and filtering on them directly would show them nobody.
  const visibleFacilityIds = new Set(scopes.facilityIds);
  const departmentFacility = new Map(departments.map((d) => [d.id, d.facility_id]));

  const inScope = (rows: ScopeRow[] | null) =>
    (rows ?? []).some((s) =>
      s.facility_id
        ? visibleFacilityIds.has(s.facility_id)
        : s.department_id
          ? visibleFacilityIds.has(departmentFacility.get(s.department_id) ?? "")
          : false
    );

  const allMembers = membersResult.data ?? [];
  const members = isScoped(membership.role)
    ? allMembers.filter((m) => m.id === membership.id || inScope(m.membership_scopes))
    : allMembers;

  const allInvitations = invitationsResult.data ?? [];
  const invitations = isScoped(membership.role)
    ? allInvitations.filter(
        (i) => i.invited_by === membership.user_id || inScope(i.invitation_scopes)
      )
    : allInvitations;

  return (
    <StaffPanel
      orgName={org.name}
      currentUserId={membership.user_id}
      currentMembershipId={membership.id}
      currentRole={membership.role as OrgRole}
      members={members}
      invitations={invitations}
      facilities={facilities}
      departments={departments}
      // A coordinator may only place aux staff in buildings they already hold
      // (migration 056 §2 enforces it; this is what the picker offers).
      invitableFacilities={
        isScoped(membership.role)
          ? facilities.filter((f) => visibleFacilityIds.has(f.id))
          : facilities
      }
    />
  );
}
