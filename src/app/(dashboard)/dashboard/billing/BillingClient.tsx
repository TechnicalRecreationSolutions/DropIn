"use client";

import { useState } from "react";
import { CheckCircle2, Zap } from "lucide-react";
import { PLANS, type PlanTier } from "@/lib/stripe/plans";

interface BillingClientProps {
  currentTier: PlanTier;
}

/** Plans a customer can actually be sold. No free tier yet — see plans.ts. */
type PaidTier = Exclude<PlanTier, "free">;
const PAID_TIERS: PaidTier[] = ["pro", "enterprise"];

const PLAN_FEATURES: Record<PaidTier, string[]> = {
  pro: [
    "Up to 5 facilities",
    "Unlimited schedules",
    "Up to 5 staff members",
    "1 year analytics history",
    "Priority support",
  ],
  enterprise: [
    "Unlimited facilities",
    "Unlimited schedules",
    "Unlimited staff members",
    "Unlimited analytics history",
    "Dedicated support",
  ],
};

export default function BillingClient({ currentTier }: BillingClientProps) {
  const [loading, setLoading] = useState<PlanTier | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade(tier: PaidTier) {
    if (tier === currentTier) return;
    setLoading(tier);
    setError(null);

    const res = await fetch("/api/stripe/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to start checkout. Please try again.");
      setLoading(null);
      return;
    }

    // Full navigation to Stripe Checkout — not a render-time mutation, the
    // lint rule can't distinguish an event-handler redirect from a render bug.
    // eslint-disable-next-line react-hooks/immutability
    window.location.href = data.url;
  }

  async function handlePortal() {
    setPortalLoading(true);
    setError(null);

    const res = await fetch("/api/stripe/create-portal", { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Could not open billing portal.");
      setPortalLoading(false);
      return;
    }

    // Full navigation to the Stripe billing portal — same rationale as above.
    window.location.href = data.url;
  }

  const currentPlan = PLANS[currentTier];

  return (
    <div className="space-y-6">
      {/* Current plan */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Current plan</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {currentTier === "free" ? "No active plan" : currentPlan.name}
            </p>
            {currentTier === "free" ? (
              <p className="text-sm text-gray-500 mt-0.5">Choose a plan below to get started.</p>
            ) : (
              currentPlan.priceMonthly > 0 && (
                <p className="text-sm text-gray-500 mt-0.5">
                  ${(currentPlan.priceMonthly / 100).toFixed(0)}/month
                </p>
              )
            )}
          </div>
          {currentTier !== "free" && (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 transition-colors"
            >
              {portalLoading ? "Opening…" : "Manage subscription"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Plan cards — no free tier to compare against, just the two paid ones */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        {PAID_TIERS.map((tier) => {
          const plan = PLANS[tier];
          const isCurrent = tier === currentTier;
          const features = PLAN_FEATURES[tier];

          return (
            <div
              key={tier}
              className={`bg-white rounded-xl border-2 p-5 flex flex-col ${
                isCurrent ? "border-blue-500" : "border-gray-200"
              }`}
            >
              {isCurrent && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 mb-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Current plan
                </span>
              )}
              {tier === "pro" && !isCurrent && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 mb-2">
                  <Zap className="w-3.5 h-3.5" /> Most popular
                </span>
              )}
              {tier === "enterprise" && !isCurrent && <div className="h-5 mb-2" />}

              <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ${plan.priceMonthly / 100}
                <span className="text-sm font-normal text-gray-500">/mo</span>
              </p>

              <ul className="mt-4 space-y-2 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <div className="w-full py-2 text-center text-sm font-medium text-gray-400 bg-gray-50 rounded-lg">
                    Current plan
                  </div>
                ) : tier === "enterprise" ? (
                  <a
                    href="mailto:hello@dropin.app?subject=Enterprise plan"
                    className="block w-full py-2 text-center text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Contact us
                  </a>
                ) : (
                  <button
                    onClick={() => handleUpgrade(tier)}
                    disabled={loading !== null}
                    className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {loading === tier ? "Redirecting…" : `Upgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
