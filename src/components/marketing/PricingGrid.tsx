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
      <div className="mb-10 flex flex-wrap items-center justify-center gap-3.5">
        <div
          role="radiogroup"
          aria-label="Billing interval"
          className="inline-flex items-center gap-0.5 rounded-full bg-[#f4f4f5] p-1"
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
              className={`cursor-pointer rounded-full px-[18px] py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc] ${
                annual === option.value
                  ? "bg-white font-semibold text-[#111113] shadow-[0_1px_2px_rgba(17,17,19,0.1)]"
                  : "font-medium text-[#5d5d63] hover:text-[#111113]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="font-hand text-[22px] leading-none font-semibold text-[#0f766e]">
          Yearly is two months free
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIER_ORDER.map((tier) => {
          const plan = PLANS[tier];
          const featured = tier === FEATURED_TIER;
          return (
            <div
              key={tier}
              className={
                featured
                  ? "relative flex flex-col rounded-3xl border-[1.5px] border-[#111113] bg-white p-7"
                  : "relative flex flex-col rounded-3xl border border-[#e4e4e7] bg-white p-7"
              }
            >
              {featured && (
                <span className="absolute -top-3 left-6 rounded-full bg-[#111113] px-2.5 py-1 text-xs font-semibold text-white">
                  Most centres
                </span>
              )}
              <p className="text-[17px] font-semibold text-[#111113]">{plan.name}</p>

              <PriceBlock tier={tier} annual={annual} />

              <p className="mt-4 min-h-[42px] text-sm leading-[21px] text-[#5d5d63]">{plan.blurb}</p>

              <p className="mt-5 border-t border-[#efeff1] pt-[18px] text-sm font-semibold text-[#111113]">
                {facilityLine(tier)}
              </p>
              <p className="min-h-5 text-[13px] text-[#5d5d63]">
                {plan.limits.extraFacilityMonthly !== null &&
                  `then $${dollars(plan.limits.extraFacilityMonthly)}/mo each`}
              </p>

              <ul className="mt-4 flex-1 space-y-2.5">
                {plan.adds.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2.5 text-sm leading-5 text-[#111113]"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0066cc]" strokeWidth={2.5} />
                    {line}
                  </li>
                ))}
              </ul>

              {plan.priceMonthly === null ? (
                <a
                  href="mailto:hello@dropin.app?subject=Enterprise plan"
                  className="mt-7 flex h-11 items-center justify-center rounded-full border border-[#d9d9de] text-[15px] font-semibold text-[#111113] transition-colors hover:border-[#111113]"
                >
                  Contact us
                </a>
              ) : (
                <Link
                  href="/signup"
                  className={
                    featured
                      ? "mt-7 flex h-11 items-center justify-center rounded-full bg-[#111113] text-[15px] font-semibold text-white transition-colors hover:bg-[#2a2a2e]"
                      : "mt-7 flex h-11 items-center justify-center rounded-full border border-[#d9d9de] text-[15px] font-semibold text-[#111113] transition-colors hover:border-[#111113]"
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
        <p className="mt-4 text-[44px] leading-[48px] font-semibold tracking-[-0.04em] text-[#111113]">
          Let&rsquo;s talk
        </p>
        <p className="mt-1.5 text-[13px] text-[#5d5d63]">
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
        <p className="mt-4 text-[44px] leading-[48px] font-semibold tracking-[-0.04em] text-[#111113]">
          ${dollars(plan.priceAnnual!)}
          <span className="text-[15px] font-medium tracking-normal text-[#5d5d63]">/year</span>
        </p>
        <p className="mt-1.5 text-[13px] text-[#0b5a54]">
          Save ${dollars(monthlyForAYear - plan.priceAnnual!)} vs monthly
        </p>
      </>
    );
  }

  return (
    <>
      <p className="mt-4 text-[44px] leading-[48px] font-semibold tracking-[-0.04em] text-[#111113]">
        ${dollars(plan.priceMonthly)}
        <span className="text-[15px] font-medium tracking-normal text-[#5d5d63]">/mo</span>
      </p>
      <p className="mt-1.5 text-[13px] text-[#5d5d63]">
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
