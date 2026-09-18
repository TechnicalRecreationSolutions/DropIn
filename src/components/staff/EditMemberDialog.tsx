"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, invitableRolesFor } from "@/lib/auth/roles";
import ScopePicker from "./ScopePicker";
import type { DepartmentOption, FacilityOption, MemberRow } from "./types";
import type { InvitableRole, OrgRole } from "@/types/app.types";

interface EditMemberDialogProps {
  member: MemberRow;
  currentRole: OrgRole;
  facilities: FacilityOption[];
  departments: DepartmentOption[];
}

/**
 * Changing someone's role or what they can reach.
 *
 * ## Why changing a role clears the scope
 *
 * The two scoped roles are scoped at different grains — a coordinator by
 * department, aux staff by facility. Carrying the old rows across a role change
 * would leave a membership holding scope of a grain its new role never
 * consults: rows that exist, look like access in the database, and match
 * nothing the role ever asks about. The server does the same thing (see
 * PATCH /api/staff/members/[id]); this keeps the form honest about it rather
 * than letting the reset arrive as a surprise after saving.
 */
export default function EditMemberDialog({
  member,
  currentRole,
  facilities,
  departments,
}: EditMemberDialogProps) {
  const router = useRouter();
  const options = invitableRolesFor(currentRole) as InvitableRole[];

  const initialScope = (member.membership_scopes ?? [])
    .map((s) => s.department_id ?? s.facility_id)
    .filter((v): v is string => Boolean(v));

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<InvitableRole>(
    (member.role === "owner" ? "manager" : member.role) as InvitableRole
  );
  const [scope, setScope] = useState<string[]>(initialScope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsScope = role !== "manager";
  const canSubmit = (!needsScope || scope.length > 0) && !busy;

  async function submit() {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/staff/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role,
        departmentIds: role === "coordinator" ? scope : [],
        facilityIds: role === "aux" ? scope : [],
      }),
    });

    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "Could not save these changes.");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <Pencil className="w-4 h-4" />
        Change access
      </DropdownMenuItem>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setRole((member.role === "owner" ? "manager" : member.role) as InvitableRole);
            setScope(initialScope);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change access</DialogTitle>
            <DialogDescription className="break-all">
              {member.email ?? "This person"} — changes take effect the next time they load a
              page.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">What can they do?</p>
              <div className="space-y-1.5">
                {options.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex items-start gap-3 min-h-11 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                      role === option ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    )}
                  >
                    <input
                      type="radio"
                      name={`edit-role-${member.id}`}
                      checked={role === option}
                      onChange={() => {
                        setRole(option);
                        // Keep the existing selection only when the grain is
                        // unchanged; otherwise it would be meaningless.
                        setScope(option === member.role ? initialScope : []);
                      }}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {ROLE_LABELS[option]}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {ROLE_DESCRIPTIONS[option]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <ScopePicker
              role={role}
              facilities={facilities}
              departments={departments}
              selected={scope}
              onChange={setScope}
            />

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={!canSubmit} onClick={submit}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
