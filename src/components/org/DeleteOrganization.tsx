"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/settings/SettingsSection";

export interface DeletionScale {
  facilities: number;
  departments: number;
  schedules: number;
  sessions: number;
  staff: number;
}

/**
 * Closing the organization for good.
 *
 * ## The count is the confirmation
 *
 * A dialog that says "this cannot be undone" is read by nobody; it is the same
 * sentence every destructive dialog in every product uses. What is actually
 * persuasive is the inventory — "4 facilities, 11 departments, 63 schedules,
 * 2,140 sessions and 9 staff accounts" is a specific claim about this
 * organization, and somebody who did not mean to be here stops at it. The
 * numbers are counted server-side with head-only queries, so the page does not
 * pay for the rows it is only counting.
 *
 * ## Typing the name, and a two-step reveal
 *
 * The button does not exist until the panel is opened, and the panel's own
 * button does not enable until the organization's name is typed exactly. Both
 * are speed bumps rather than controls — the controls are in
 * `delete_organization()` (migration 062), which independently requires the
 * caller to be the owner, requires the same typed name, and refuses outright
 * while a live subscription exists.
 *
 * ## After it succeeds
 *
 * The account survives — it may belong to other organizations, and it is the
 * person's, not the org's. So this navigates to `/dashboard`, where `OrgGuard`
 * finds no membership and sends them to onboarding. `replace`, not `push`: the
 * page they are leaving cannot be returned to, and leaving it in the history
 * means the back button lands on a settings page for a deleted organization.
 */
export default function DeleteOrganization({
  orgName,
  scale,
  blockedBySubscription,
}: {
  orgName: string;
  scale: DeletionScale;
  /** A live Stripe subscription. The RPC refuses; saying so first is kinder. */
  blockedBySubscription: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmName.trim() === orgName.trim();

  const inventory = [
    [scale.facilities, "facility", "facilities"],
    [scale.departments, "department", "departments"],
    [scale.schedules, "schedule", "schedules"],
    [scale.sessions, "session", "sessions"],
    [scale.staff, "staff account", "staff accounts"],
  ] as const;

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/organizations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error ?? "Could not delete the organization.");
        return;
      }

      // refresh() FIRST, then navigate — the same order TransferOwnership uses
      // after changing the caller's own role. It drops the client Router Cache,
      // every entry of which describes an organization that no longer exists,
      // so `/dashboard` is fetched from the server; `OrgGuard` finds no
      // membership there and sends them on to onboarding.
      router.refresh();
      router.replace("/dashboard");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Delete this organization"
      tone="destructive"
      description="Permanent. Every schedule, space, facility and staff account below is removed, and every public page and embedded widget stops working immediately."
    >
      <ul className="mb-4 space-y-1 text-sm text-foreground">
        {inventory.map(([count, one, many]) => (
          <li key={many}>
            <strong>{count.toLocaleString("en-CA")}</strong> {count === 1 ? one : many}
          </li>
        ))}
      </ul>

      {blockedBySubscription ? (
        <p className="rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          Your subscription is still active. Cancel it on the Billing page first — deleting the
          organization now would remove the record Dropin uses to stop billing you, while Stripe
          kept charging the card.
        </p>
      ) : !open ? (
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete organization…
        </Button>
      ) : (
        <div className="space-y-3">
          <label htmlFor="delete-confirm" className="block text-sm text-foreground">
            Type <strong>{orgName}</strong> to confirm.
          </label>
          <Input
            id="delete-confirm"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
            placeholder={orgName}
            aria-describedby={error ? "delete-error" : undefined}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="destructive" disabled={!matches || busy} onClick={destroy}>
              {busy ? "Deleting…" : "Delete this organization permanently"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setConfirmName("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p
          id="delete-error"
          role="alert"
          className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
