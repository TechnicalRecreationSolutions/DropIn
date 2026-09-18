"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Crown, MoreHorizontal, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, can, canModifyMembership } from "@/lib/auth/roles";
import { formatDate } from "@/lib/utils/dates";
import InviteDialog from "./InviteDialog";
import EditMemberDialog from "./EditMemberDialog";
import type {
  DepartmentOption,
  FacilityOption,
  InvitationRow,
  MemberRow,
  ScopeRow,
} from "./types";
import type { OrgRole } from "@/types/app.types";

interface StaffPanelProps {
  orgName: string;
  currentUserId: string;
  currentMembershipId: string;
  currentRole: OrgRole;
  members: MemberRow[];
  invitations: InvitationRow[];
  facilities: FacilityOption[];
  departments: DepartmentOption[];
  /** Facilities this person may place aux staff in — narrower for a coordinator. */
  invitableFacilities: FacilityOption[];
}

/**
 * The staff list: who is in, who has been asked, and what each of them reaches.
 *
 * Scope is shown as chips on every row rather than hidden behind an edit
 * dialog. A role name alone ("Coordinator") does not tell a manager whether
 * the person can actually see the pool they are being asked about, and that
 * question is the whole reason this page exists.
 */
export default function StaffPanel({
  orgName,
  currentUserId,
  currentMembershipId,
  currentRole,
  members,
  invitations,
  facilities,
  departments,
  invitableFacilities,
}: StaffPanelProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actor = {
    role: currentRole,
    // The panel only asks unscoped questions ("may I manage staff at all"), so
    // empty lists here are correct — the per-row test is canModifyMembership.
    scopes: { departmentIds: [], facilityIds: [] },
    userId: currentUserId,
  };

  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));

  function describeScope(rows: ScopeRow[] | null, role: OrgRole): string[] {
    if (role === "owner" || role === "manager") return ["Whole organization"];
    return (rows ?? [])
      .map((s) =>
        s.department_id
          ? departmentName.get(s.department_id) ?? "Removed department"
          : facilityName.get(s.facility_id ?? "") ?? "Removed facility"
      )
      .sort((a, b) => a.localeCompare(b));
  }

  async function remove(member: MemberRow) {
    const who = member.email ?? "this person";
    if (!confirm(`Remove ${who} from ${orgName}? They will lose access immediately.`)) return;

    setError(null);
    setBusyId(member.id);
    const res = await fetch(`/api/staff/members/${member.id}`, { method: "DELETE" });
    setBusyId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not remove this person.");
      return;
    }
    router.refresh();
  }

  async function revoke(invitation: InvitationRow) {
    setError(null);
    setBusyId(invitation.id);
    const res = await fetch(`/api/staff/invitations/${invitation.id}`, { method: "DELETE" });
    setBusyId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not withdraw this invitation.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {members.length} {members.length === 1 ? "person" : "people"}
          {invitations.length > 0 && `, ${invitations.length} invited`}
        </p>
        {can(actor, "staff:invite-aux") && (
          <InviteDialog
            currentRole={currentRole}
            facilities={invitableFacilities}
            departments={departments}
          />
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
          {error}
        </p>
      )}

      <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
        {members.map((member) => {
          const scopes = describeScope(member.membership_scopes, member.role);
          const editable = canModifyMembership(actor, {
            role: member.role,
            user_id: member.user_id,
          });
          // §4 made visible: a coordinator or aux staffer with nothing assigned
          // can reach nothing. It is the correct fail-closed state and it is
          // otherwise completely silent, so the list says so.
          const stranded = member.role !== "owner" && member.role !== "manager" && scopes.length === 0;

          return (
            <div key={member.id} className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground break-all">
                    {member.email ?? "Unknown address"}
                  </span>
                  {member.user_id === currentUserId && (
                    <span className="text-xs text-muted-foreground">(you)</span>
                  )}
                  <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                    {member.role === "owner" && <Crown className="w-3 h-3" />}
                    {ROLE_LABELS[member.role]}
                  </Badge>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stranded ? (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="w-3 h-3" />
                      Nothing assigned — they can sign in but see nothing
                    </span>
                  ) : (
                    scopes.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              {editable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      disabled={busyId === member.id}
                      aria-label={`Manage ${member.email ?? "member"}`}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <EditMemberDialog
                      member={member}
                      currentRole={currentRole}
                      facilities={facilities}
                      departments={departments}
                    />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        remove(member);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove from {orgName}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>

      {invitations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Waiting to accept</h2>
          <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
            {invitations.map((invitation) => {
              const scopes = describeScope(invitation.invitation_scopes, invitation.role);
              const expired = new Date(invitation.expires_at) <= new Date();

              return (
                <div key={invitation.id} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground break-all">
                        {invitation.email}
                      </span>
                      <Badge variant="secondary">{ROLE_LABELS[invitation.role]}</Badge>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {expired
                          ? "Expired"
                          : // formatDate(), not toLocaleDateString(): this
                            // component renders on the server AND hydrates in
                            // the browser, and toLocaleDateString() follows
                            // each runtime's locale — "2026-09-25" from Node,
                            // "25/09/2026" in the browser — which React
                            // reports as a hydration mismatch. A fixed format
                            // string renders identically in both.
                            `Expires ${formatDate(new Date(invitation.expires_at))}`}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {scopes.map((s) => (
                        <Badge key={s} variant="outline">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={busyId === invitation.id}
                    onClick={() => revoke(invitation)}
                    aria-label={`Withdraw the invitation to ${invitation.email}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {currentMembershipId && currentRole !== "owner" && (
        <LeaveOrganization orgName={orgName} />
      )}
    </div>
  );
}

/**
 * Resigning.
 *
 * Migration 055 §7 blocks self-modification on `org_memberships` outright —
 * that is what stops self-promotion — so this goes through
 * `leave_organization()`, the sanctioned exception. The owner never sees it:
 * an org with no owner has nobody who can pay for it or delete it.
 */
function LeaveOrganization({ orgName }: { orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="border border-border rounded-xl p-4">
      <p className="text-sm font-medium text-foreground">Leave {orgName}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        You will lose access immediately. Someone with a Manager account would have to invite
        you back.
      </p>
      <Button
        variant="outline"
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          if (!confirm(`Leave ${orgName}? You will lose access immediately.`)) return;
          setBusy(true);
          const res = await fetch("/api/staff/members/leave", { method: "POST" });
          setBusy(false);
          if (res.ok) router.push("/dashboard");
        }}
      >
        Leave organization
      </Button>
    </div>
  );
}
