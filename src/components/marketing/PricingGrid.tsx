"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  PLANS,
  TIER_ORDER,
  FEATURED_TIER,
  dollars,
  type PlanTier,
} from "@/lib/stripe/plans";

/**
 * The four pricing cards, with a Monthly/Yearly switch.
 *
 * ## Why this is a client component while the rest of the page is not
 *
 * The switch is the only interactive thing in the pricing section, so it is the
 * only reason for a client boundary — the section was a server-rendered grid
 * until the yearly option needed to be selectable. Everything it renders is
 * still derived from the `PLANS` catalogue, so the copy cannot drift from the
 * billing page's.
 *
 * ## Why there is no Stripe dependency here, unlike the billing page
 *
 * The billing page hides its interval toggle unless the annual Stripe prices
 * are configured, because that page *starts a purchase* — offering a cadence
 * checkout would refuse is a support call. This page does not purchase
 * anything. Every card's CTA is "Start free trial" → /signup regardless of
 * which interval is showing, so the switch here is presentation: it tells a
 * visitor what the plan costs yearly, which is a published price whether or not
 * Stripe can charge it yet.
 *
 * That asymmetry is deliberate. Do not "fix" it by gating this on the price
 * env vars — they are server-only secrets and would force this whole section
 * dynamic to answer a question it does not need to ask.
 */
export default function PricingGrid() {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div
          role="radiogroup"
          aria-label="Billing interval"
          className="inline-flex items-center gap-1 rounded-lg bg-card border border-border p-1"
        >
          {(
            [
              { value: false, label: "Monthly" },
              { value: true, label: "Yearly" },
            ] as const
          ).map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={annual === option.value}
              onClick={() => setAnnual(option.value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                annual === option.value
                  ? "bg-blue-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-sm font-medium text-green-700 dark:text-green-400">
          Yearly is two months free
        </span>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TIER_ORDER.map((tier) => {
          const plan = PLANS[tier];
          const featured = tier === FEATURED_TIER;
          return (
            <div
              key={tier}
              className={
                featured
                  ? "relative flex flex-col rounded-xl border-2 border-blue-600 bg-card p-6 shadow-sm"
                  : "relative flex flex-col rounded-xl border border-border bg-card p-6"
              }
            >
              {featured && (
                <span className="absolute -top-3 left-6 rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  Most centres
                </span>
              )}
              <p className="font-semibold text-foreground">{plan.name}</p>

              <PriceBlock tier={tier} annual={annual} />

              <p className="mt-3 text-sm text-muted-foreground">{plan.blurb}</p>

              <p className="mt-4 text-sm font-semibold text-foreground">
                {facilityLine(tier)}
              </p>
              {plan.limits.extraFacilityMonthly !== null && (
                <p className="text-sm text-muted-foreground">
                  then ${dollars(plan.limits.extraFacilityMonthly)}/mo each
                </p>
              )}

              <ul className="mt-3 space-y-2 flex-1">
                {plan.adds.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2 text-sm text-foreground"
                  >
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    {line}
                  </li>
                ))}
              </ul>

              {plan.priceMonthly === null ? (
                <a
                  href="mailto:hello@dropin.app?subject=Enterprise plan"
                  className="mt-6 block text-center px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
                >
                  Contact us
                </a>
              ) : (
                <Link
                  href="/signup"
                  className={
                    featured
                      ? "mt-6 block text-center px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                      : "mt-6 block text-center px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
                  }
                >
                  Start free trial
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * The headline price for one card.
 *
 * Yearly leads with the annual charge and states the saving against paying
 * monthly for a year, because "two months free" is the argument and a bare
 * "$2,490/yr" makes the reader do the arithmetic to find it.
 */
function PriceBlock({ tier, annual }: { tier: PlanTier; annual: boolean }) {
  const plan = PLANS[tier];

  if (plan.priceMonthly === null) {
    return (
      <>
        <p className="mt-2 text-3xl font-extrabold text-foreground">
          Let&rsquo;s talk
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.priceAnnualFrom !== null &&
            `From $${dollars(plan.priceAnnualFrom)}/year`}
        </p>
      </>
    );
  }

  if (annual) {
    const monthlyForAYear = plan.priceMonthly * 12;
    return (
      <>
        <p className="mt-2 text-3xl font-extrabold text-foreground">
          ${dollars(plan.priceAnnual!)}
          <span className="text-sm font-medium text-muted-foreground">/year</span>
        </p>
        <p className="mt-1 text-sm text-green-700 dark:text-green-400">
          Save ${dollars(monthlyForAYear - plan.priceAnnual!)} vs monthly
        </p>
      </>
    );
  }

  return (
    <>
      <p className="mt-2 text-3xl font-extrabold text-foreground">
        ${dollars(plan.priceMonthly)}
        <span className="text-sm font-medium text-muted-foreground">/mo</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        or ${dollars(plan.priceAnnual!)}/year
      </p>
    </>
  );
}

/**
 * How each tier's facility allowance reads on the card.
 *
 * The facility is the billed unit — see docs/PRICING.md — so it gets its own
 * line above the capability list rather than being buried in it. Everything
 * else is unlimited on every tier and is stated once, below the grid.
 */
function facilityLine(tier: PlanTier): string {
  const { facilities } = PLANS[tier].limits;
  if (facilities === -1) return "Unlimited facilities";
  if (facilities === 1) return "1 facility";
  return `Up to ${facilities} facilities`;
}
