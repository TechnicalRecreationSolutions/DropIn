"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/SettingsSection";

/**
 * Resigning from an organization.
 *
 * ## It moved here from the Staff page, on purpose
 *
 * Leaving is a fact about YOUR membership, not an act of staff administration —
 * and the Staff page is gated on `staff:view`, which excludes aux. A lifeguard
 * therefore had no way to leave an organization at all: the only control was on
 * a page their role cannot open. Account settings is reachable by every role,
 * which is the whole reason that page has no permission on it.
 *
 * ## The owner never sees this
 *
 * `leave_organization()` refuses them, because an organization with no owner
 * has nobody who can pay for it or delete it. The caller filters the owner out
 * rather than rendering a button that exists to fail; Danger zone offers them
 * the two things they can actually do — transfer ownership, or delete.
 *
 * Migration 055 §7 blocks self-modification on `org_memberships` outright, so
 * this goes through the RPC, which is the sanctioned exception.
 */
export default function LeaveOrganization({ orgName }: { orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (!confirm(`Leave ${orgName}? You will lose access immediately.`)) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/members/leave", { method: "POST" });
      if (!res.ok) {
        // Previously this failure was silent: the button stopped spinning and
        // nothing happened, which reads as a broken button rather than as a
        // refusal with a reason.
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not leave this organization.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title={`Leave ${orgName}`}
      description="You will lose access immediately. Someone with a Manager account would have to invite you back."
      tone="destructive"
    >
      <Button variant="destructive" size="lg" disabled={busy} onClick={leave}>
        {busy ? "Leaving…" : "Leave organization"}
      </Button>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
