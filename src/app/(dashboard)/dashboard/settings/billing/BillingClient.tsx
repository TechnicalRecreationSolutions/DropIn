"use client";

import { useState } from "react";
import { CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
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
  /**
   * Whether an annual subscription can actually be bought right now.
   *
   * Resolved on the server from the price env vars, which are secret and read
   * as `undefined` in the browser — so this component cannot work it out and
   * must be told. False means the cards still *show* the yearly figure (it is
   * a real published price) but offer no way to choose it, which is the honest
   * rendering of "advertised, not yet sellable".
   */
  annualAvailable: boolean;
}

export default function BillingClient({ currentTier, annualAvailable }: BillingClientProps) {
  const [loading, setLoading] = useState<PlanTier | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Monthly unless the visitor picks yearly, and forced to monthly whenever
   * yearly is not sellable — so the request can never carry an interval the
   * server would refuse.
   */
  const [annual, setAnnual] = useState(false);
  const interval = annual && annualAvailable ? "year" : "month";

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
      body: JSON.stringify({ tier: checkoutTier, interval }),
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
      <div className="bg-card rounded-card border border-border shadow-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-label text-muted-foreground">
              Current plan
            </p>
            <p className="text-heading text-foreground mt-1">
              {currentPlan ? currentPlan.name : "No active plan"}
            </p>
            {currentPlan === null ? (
              <p className="text-caption text-muted-foreground mt-0.5">
                Choose a plan below to get started.
              </p>
            ) : currentPlan.priceMonthly !== null ? (
              /* Deliberately no price here.
                 This line used to read "$249/month", which was true only
                 because monthly was the only thing anyone could buy. Now that
                 annual checkout exists, `subscriptions` still has no interval
                 column (migration 004 stores period dates, not a cadence), so
                 the app cannot know whether this org pays $249 monthly or
                 $2,490 yearly — and a billing page stating the wrong one is
                 worse than one stating neither. The amount and cadence live in
                 the Stripe portal behind "Manage subscription", which is
                 authoritative; the tier's list price is on its card below. */
              <p className="text-caption text-muted-foreground mt-0.5">
                {currentPlan.limits.facilities === -1
                  ? "Unlimited facilities"
                  : `Up to ${currentPlan.limits.facilities} ${
                      currentPlan.limits.facilities === 1 ? "facility" : "facilities"
                    }`}
              </p>
            ) : (
              <p className="text-caption text-muted-foreground mt-0.5">
                Billed by agreement &middot; unlimited facilities
              </p>
            )}
          </div>
          {currentPlan && (
            <Button
              variant="outline"
              onClick={handlePortal}
              disabled={portalLoading}
              className="shrink-0"
            >
              {portalLoading ? "Opening…" : "Manage subscription"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Banner variant="error">{error}</Banner>
      )}

      {/* Billing interval. Rendered only when yearly can actually be bought —
          a toggle beside a button that 400s is worse than no toggle. While it
          is hidden the cards still print the yearly price as information. */}
      {annualAvailable && (
        <div className="flex items-center justify-center">
          <div
            role="radiogroup"
            aria-label="Billing interval"
            className="inline-flex items-center gap-1 rounded-full bg-muted p-1"
          >
            {([
              { value: false, label: "Monthly" },
              { value: true, label: "Yearly" },
            ] as const).map((option) => (
              <button
                key={option.label}
                role="radio"
                aria-checked={annual === option.value}
                onClick={() => setAnnual(option.value)}
                className={`px-4 py-1.5 text-sm font-medium rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
                  annual === option.value
                    ? "bg-raised text-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="ml-3 text-sm font-medium text-success">
            Two months free
          </span>
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
              className={`bg-card rounded-card shadow-card border p-5 flex flex-col ${
                isCurrent ? "border-brand ring-1 ring-brand" : "border-border"
              }`}
            >
              {isCurrent ? (
                <span className="inline-flex h-5 items-center gap-1 text-caption font-semibold text-brand mb-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Current plan
                </span>
              ) : tier === FEATURED_TIER ? (
                <span className="inline-flex h-5 items-center gap-1 text-caption font-semibold text-brand mb-2">
                  <Zap className="w-3.5 h-3.5" /> Most centres
                </span>
              ) : (
                <div className="h-5 mb-2" />
              )}

              <h3 className="text-card-title text-foreground">{plan.name}</h3>

              {plan.priceMonthly === null ? (
                <>
                  <p className="text-stat tabular-nums text-foreground mt-1">Let&rsquo;s talk</p>
                  {plan.priceAnnualFrom !== null && (
                    <p className="text-caption text-muted-foreground">
                      From ${dollars(plan.priceAnnualFrom)}/year
                    </p>
                  )}
                </>
              ) : interval === "year" ? (
                /* Yearly selected: lead with what will be charged, and keep the
                   monthly figure visible so the saving is legible. */
                <>
                  <p className="text-stat tabular-nums text-foreground mt-1">
                    ${dollars(plan.priceAnnual!)}
                    <span className="text-sm font-normal text-muted-foreground">/yr</span>
                  </p>
                  <p className="text-caption text-muted-foreground">
                    vs ${dollars(plan.priceMonthly * 12)}/year monthly
                  </p>
                </>
              ) : (
                <>
                  <p className="text-stat tabular-nums text-foreground mt-1">
                    ${dollars(plan.priceMonthly)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-caption text-muted-foreground">
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
                <p className="text-caption text-muted-foreground">
                  then ${dollars(plan.limits.extraFacilityMonthly)}/mo each
                </p>
              )}

              <ul className="mt-3 space-y-2 flex-1">
                {plan.adds.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <div className="flex h-10 w-full items-center justify-center text-sm font-medium text-muted-foreground bg-muted rounded-full">
                    Current plan
                  </div>
                ) : checkoutTier ? (
                  <Button
                    variant={tier === FEATURED_TIER ? "default" : "outline"}
                    onClick={() => handleUpgrade(tier)}
                    disabled={loading !== null}
                    className="w-full"
                  >
                    {loading === tier ? "Redirecting…" : `Switch to ${plan.name}`}
                  </Button>
                ) : (
                  /* No Stripe price for this tier yet — see docs/PRICING.md.
                     A button here would 400; contact is the honest CTA. */
                  <Button asChild variant="outline" className="w-full">
                    <a href={`mailto:hello@dropin.app?subject=${encodeURIComponent(`${plan.name} plan`)}`}>
                      Contact us
                    </a>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Yearly is a published price on every card above, so when it cannot be
          bought self-serve there has to be *some* way to ask for it. Without
          this the page quotes an annual figure and offers no path to it, which
          is the same broken promise the yearly copy made before checkout
          learned about intervals — just moved one screen along.

          Disappears on its own once the annual Stripe prices are configured,
          because then the toggle at the top does the job. */}
      {!annualAvailable && (
        <div className="bg-card rounded-card border border-border shadow-card p-5">
          <p className="text-card-title text-foreground">
            Prefer to pay yearly?
          </p>
          <p className="mt-1 text-caption text-muted-foreground">
            Yearly billing is two months free. It isn&rsquo;t self-serve yet —
            email us and we&rsquo;ll set it up for you.
          </p>
          <Button asChild variant="outline" className="mt-3">
            <a href="mailto:hello@dropin.app?subject=Yearly%20billing">
              Ask about yearly billing
            </a>
          </Button>
        </div>
      )}

      <div className="bg-card rounded-card border border-border shadow-card p-5">
        <p className="text-card-title text-foreground">Unlimited on every plan</p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {ALWAYS_UNLIMITED.map((item) => (
            <li key={item} className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-caption text-muted-foreground">
          Facilities beyond your plan&rsquo;s allowance are $
          {dollars(EXTRA_FACILITY_MONTHLY)}/month each.
        </p>
      </div>
    </div>
  );
}
