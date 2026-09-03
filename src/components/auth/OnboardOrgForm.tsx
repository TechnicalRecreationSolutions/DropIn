"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

    router.push(data.redirect ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="orgName" className="block text-sm font-medium text-foreground mb-1">
          Organization name
        </label>
        <input
          id="orgName"
          type="text"
          required
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="City of Calgary Parks & Recreation"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Setting up…" : "Continue"}
      </button>
    </form>
  );
}
