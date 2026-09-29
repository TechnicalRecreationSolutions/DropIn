"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";

/**
 * `suggestedName` comes from user_metadata.org_name, set at signup so the user
 * doesn't retype what they already entered before confirming their email.
 * It is user-writable and therefore untrusted — it only prefills the field, and
 * /api/auth/onboard-org re-validates whatever is actually submitted.
 */
export default function OnboardOrgForm({ suggestedName = "" }: { suggestedName?: string }) {
  const router = useRouter();

  const [orgName, setOrgName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/onboard-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    // This page is retained rather than unmounted on navigation, so a
    // `loading` left set would greet a returning user with a disabled
    // "Creating…". See components/space/SpaceForm.tsx for the full note.
    setLoading(false);

    router.push(data.redirect ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="orgName">
          Organization name
        </Label>
        <Input
          id="orgName"
          type="text"
          required
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="City of Calgary Parks & Recreation"
        />
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Setting up…" : "Continue"}
      </Button>
    </form>
  );
}
