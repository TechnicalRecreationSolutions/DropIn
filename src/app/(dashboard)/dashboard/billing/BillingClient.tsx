"use client";

import { useState } from "react";
import { CheckCircle2, Zap } from "lucide-react";
import {
  PLANS,
  TIER_ORDER,
  FEATURED_TIER,
  ALWAYS_UNLIMITED,
  PLAN_TO_CHECKOUT_TIER,
  EXTRA_FACILITY_MONTHLY,
  dollars,
  type PlanTier,
} from "@/lib/stripe/plans";

interface BillingClientProps {
  /**
   * The catalogue tier this org is on, or `null` for no active plan.
   *
   * `null` covers both "never subscribed" and "cancelled" — the database's
   * `free` value is not a plan, so it must never render as Starter. The page
   * component does that translation via STORED_TIER_TO_PLAN.
   */
  currentTier: PlanTier | null;
}

export default function BillingClient({ currentTier }: BillingClientProps) {
  const [loading, setLoading] = useState<PlanTier | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade(tier: PlanTier) {
    if (tier === currentTier) return;

    // Stripe still prices the legacy tier names; a tier absent from this map
    // has no price yet and is rendered as contact-sales, so it cannot get here.
    const checkoutTier = PLAN_TO_CHECKOUT_TIER[tier];
    if (!checkoutTier) return;

    setLoading(tier);
    setError(null);

    const res = await fetch("/api/stripe/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: checkoutTier }),
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

  const currentPlan = currentTier ? PLANS[currentTier] : null;

  return (
    <div className="space-y-6">
      {/* Current plan */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Current plan
            </p>
            <p className="text-xl font-bold text-foreground mt-1">
              {currentPlan ? currentPlan.name : "No active plan"}
            </p>
            {currentPlan === null ? (
              <p className="text-sm text-muted-foreground mt-0.5">
                Choose a plan below to get started.
              </p>
            ) : currentPlan.priceMonthly !== null ? (
              <p className="text-sm text-muted-foreground mt-0.5">
                ${dollars(currentPlan.priceMonthly)}/month &middot;{" "}
                {currentPlan.limits.facilities === -1
                  ? "unlimited facilities"
                  : `up to ${currentPlan.limits.facilities} ${
                      currentPlan.limits.facilities === 1 ? "facility" : "facilities"
                    }`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">
                Billed by agreement &middot; unlimited facilities
              </p>
            )}
          </div>
          {currentPlan && (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="shrink-0 px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-border rounded-lg disabled:opacity-50 transition-colors"
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

      {/* Plan cards. The facility count is the billed unit, so it sits above
          the capability list on every card rather than inside it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {TIER_ORDER.map((tier) => {
          const plan = PLANS[tier];
          const isCurrent = tier === currentTier;
          const checkoutTier = PLAN_TO_CHECKOUT_TIER[tier];

          return (
            <div
              key={tier}
              className={`bg-card rounded-xl border-2 p-5 flex flex-col ${
                isCurrent ? "border-blue-500" : "border-border"
              }`}
            >
              {isCurrent ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 mb-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Current plan
                </span>
              ) : tier === FEATURED_TIER ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 mb-2">
                  <Zap className="w-3.5 h-3.5" /> Most centres
                </span>
              ) : (
                <div className="h-5 mb-2" />
              )}

              <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>

              {plan.priceMonthly === null ? (
                <>
                  <p className="text-2xl font-bold text-foreground mt-1">Let&rsquo;s talk</p>
                  {plan.priceAnnualFrom !== null && (
                    <p className="text-sm text-muted-foreground">
                      From ${dollars(plan.priceAnnualFrom)}/year
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    ${dollars(plan.priceMonthly)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    or ${dollars(plan.priceAnnual!)}/year
                  </p>
                </>
              )}

              <p className="mt-3 text-sm font-semibold text-foreground">
                {plan.limits.facilities === -1
                  ? "Unlimited facilities"
                  : plan.limits.facilities === 1
                    ? "1 facility"
                    : `Up to ${plan.limits.facilities} facilities`}
              </p>
              {plan.limits.extraFacilityMonthly !== null && (
                <p className="text-sm text-muted-foreground">
                  then ${dollars(plan.limits.extraFacilityMonthly)}/mo each
                </p>
              )}

              <ul className="mt-3 space-y-2 flex-1">
                {plan.adds.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <div className="w-full py-2 text-center text-sm font-medium text-muted-foreground/70 bg-muted rounded-lg">
                    Current plan
                  </div>
                ) : checkoutTier ? (
                  <button
                    onClick={() => handleUpgrade(tier)}
                    disabled={loading !== null}
                    className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {loading === tier ? "Redirecting…" : `Switch to ${plan.name}`}
                  </button>
                ) : (
                  /* No Stripe price for this tier yet — see docs/PRICING.md.
                     A button here would 400; contact is the honest CTA. */
                  <a
                    href={`mailto:hello@dropin.app?subject=${encodeURIComponent(`${plan.name} plan`)}`}
                    className="block w-full py-2 text-center text-sm font-medium text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    Contact us
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <p className="text-sm font-semibold text-foreground">Unlimited on every plan</p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {ALWAYS_UNLIMITED.map((item) => (
            <li key={item} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Facilities beyond your plan&rsquo;s allowance are $
          {dollars(EXTRA_FACILITY_MONTHLY)}/month each.
        </p>
      </div>
    </div>
  );
}
