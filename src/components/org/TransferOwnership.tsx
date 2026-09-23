"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { OrgRole } from "@/types/app.types";
import { SettingsCard } from "@/components/settings/SettingsSection";

export interface TransferCandidate {
  membershipId: string;
  email: string | null;
  role: OrgRole;
}

interface TransferOwnershipProps {
  orgName: string;
  candidates: TransferCandidate[];
}

/**
 * Handing the organization to someone else.
 *
 * Owner-only, and the only thing in the product its own actor cannot undo: the
 * moment it succeeds they are a Manager, and Managers cannot transfer
 * ownership, so reversing it needs the *new* owner to agree. Typing the
 * organization's name is the standard guard for that shape of action.
 *
 * The confirmation is a speed bump, not a control. The controls live in
 * `transfer_ownership()` (migration 055 §8): the caller must currently be the
 * owner, the recipient must already be a member, and the demote-and-promote
 * happens in one statement so there is never zero owners and never two.
 */
export default function TransferOwnership({ orgName, candidates }: TransferOwnershipProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          You can only transfer ownership to someone on your team. Add them on the Staff page first.
        </p>
      </Section>
    );
  }

  return (
    <Section>
      {!open ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          Transfer ownership
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Who should own {orgName}?</p>
            <div className="space-y-1.5">
              {candidates.map((c) => (
                <label
                  key={c.membershipId}
                  className="flex items-center gap-3 min-h-11 px-3 py-2 rounded-lg border border-border hover:bg-muted cursor-pointer"
                >
                  <input
                    type="radio"
                    name="transfer-target"
                    checked={target === c.membershipId}
                    onChange={() => setTarget(c.membershipId)}
                    className="size-4 accent-primary"
                  />
                  <span className="text-sm text-foreground break-all">
                    {c.email ?? "Unknown address"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {ROLE_LABELS[c.role]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm-org" className="text-sm font-medium text-foreground">
              Type <span className="font-mono">{orgName}</span> to confirm
            </label>
            <Input
              id="confirm-org"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              You will become a Manager. Only the new owner can give it back.
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setError(null);
                setTarget("");
                setConfirmName("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!target || confirmName.trim() !== orgName.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const res = await fetch("/api/staff/transfer-ownership", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ membershipId: target, confirmName }),
                });
                const data = await res.json().catch(() => ({}));
                setBusy(false);
                if (!res.ok) {
                  setError(data.error ?? "Could not transfer ownership.");
                  return;
                }
                // This page is retained rather than unmounted on navigation,
                // so reopening it would find the confirmation box still
                // holding the org name — the destructive button armed before
                // anyone typed. See components/space/SpaceForm.tsx.
                setTarget("");
                setConfirmName("");

                // The caller's own role just changed, so every piece of chrome
                // that reads it is stale — refresh before navigating.
                router.refresh();
                router.push("/dashboard/settings/staff");
              }}
            >
              {busy ? "Transferring…" : "Transfer ownership"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Renders as a settings card so this sits level with the delete panel beside
 * it on the Danger zone page. It used to carry its own `<h2>Ownership</h2>`,
 * which put a second top-level heading inside a page that already had one.
 */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <SettingsCard
      title="Ownership"
      info="Only the owner can manage billing, delete the organization, or transfer ownership. There is always exactly one owner."
      description="Handing this over makes you a Manager. Only the new owner can give it back."
    >
      <div className="flex items-center gap-2 pb-3 text-xs text-muted-foreground">
        <Crown className="size-3.5" aria-hidden />
        You are the owner of this organization.
      </div>
      {children}
    </SettingsCard>
  );
}
