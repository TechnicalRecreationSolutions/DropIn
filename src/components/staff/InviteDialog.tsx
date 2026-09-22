"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Mail, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, invitableRolesFor } from "@/lib/auth/roles";
import ScopePicker from "./ScopePicker";
import type { DepartmentOption, FacilityOption } from "./types";
import type { InvitableRole, OrgRole } from "@/types/app.types";
import { InfoTip } from "@/components/ui/info-tip";

interface InviteDialogProps {
  currentRole: OrgRole;
  facilities: FacilityOption[];
  departments: DepartmentOption[];
}

/**
 * Adding someone to the organization.
 *
 * A dialog rather than its own route, deliberately: this is a short form a
 * supervisor fills in from a phone on a pool deck, and a full page navigation
 * loses the staff list they were looking at.
 *
 * ## The two things this refuses to do
 *
 * It will not offer a role the inviter cannot grant (`invitableRolesFor` — a
 * coordinator sees only "Staff"), and it will not send a coordinator or aux
 * invitation with nothing ticked. The second is the §4 fail-closed rule
 * surfacing in the UI: an empty scope grants nothing, so an invitation with no
 * scope produces an account that can sign in and reach zero pages. The server
 * refuses it too — this just stops it being a confusing round trip.
 */
export default function InviteDialog({
  currentRole,
  facilities,
  departments,
}: InviteDialogProps) {
  const router = useRouter();
  const options = invitableRolesFor(currentRole) as InvitableRole[];

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>(options[options.length - 1] ?? "aux");
  const [scope, setScope] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the invitation was created but the email did not go out. The link
  // still works, so the dialog offers it rather than pretending to have failed.
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (options.length === 0) return null;

  const needsScope = role !== "manager";
  const canSubmit = email.trim().length > 3 && (!needsScope || scope.length > 0) && !busy;

  function reset() {
    setEmail("");
    setRole(options[options.length - 1] ?? "aux");
    setScope([]);
    setError(null);
    setFallbackLink(null);
    setCopied(false);
  }

  async function submit() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        role,
        departmentIds: role === "coordinator" ? scope : [],
        facilityIds: role === "aux" ? scope : [],
      }),
    });

    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? "Could not send the invitation.");
      return;
    }

    router.refresh();

    if (data.emailSent) {
      setOpen(false);
      reset();
      return;
    }

    // Created, but unsent. Almost always because RESEND_API_KEY is not
    // configured — see lib/staff/invitationEmail.ts. The link is the product.
    setFallbackLink(data.link ?? null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="w-4 h-4" />
          Add someone
        </Button>
      </DialogTrigger>

      {/* max-h + scroll: the department picker grows with the org, and on a
          phone this dialog must never push its own buttons off-screen. */}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add someone to your team</DialogTitle>
          <DialogDescription>
            We&rsquo;ll email them an invitation.
          </DialogDescription>
        </DialogHeader>

        {fallbackLink ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              We couldn&rsquo;t send the email. Send them this link yourself instead.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={fallbackLink} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(fallbackLink);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              It expires in 7 days and only works for {email.trim()}.
            </p>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="invite-email" className="text-sm font-medium text-foreground">
                  Their work email
                </label>
                <InfoTip>The invitation only works from this address. Forwarding it won&rsquo;t let anyone else in.</InfoTip>
              </div>
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

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
                      name="invite-role"
                      checked={role === option}
                      onChange={() => {
                        setRole(option);
                        // The two roles are scoped at different grains, so a
                        // selection made for one is meaningless for the other.
                        setScope([]);
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
              <Button type="button" disabled={!canSubmit} onClick={submit} className="gap-2">
                <Mail className="w-4 h-4" />
                {busy ? "Sending…" : "Send invitation"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
