/**
 * Plan catalogue: names, prices and limits.
 *
 * This module is imported by BillingClient.tsx, a client component, so it ships
 * to the browser and must contain nothing secret. Stripe price IDs deliberately
 * live in `./prices.ts` (server-only) — they used to be here, read from env vars
 * that are `undefined` in the bundle, which meant a missing variable in
 * production read as "this plan is not for sale" instead of failing.
 */

export type PlanTier = "free" | "pro" | "enterprise";

export interface Plan {
  tier: PlanTier;
  name: string;
  priceMonthly: number; // in cents
  limits: {
    facilities: number;        // -1 = unlimited
    programsPerFacility: number;
    staffMembers: number;
    analyticsHistoryDays: number;
  };
}

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: "free",
    name: "Free",
    priceMonthly: 0,
    limits: {
      facilities: 1,
      programsPerFacility: 5,
      staffMembers: 1,
      analyticsHistoryDays: 30,
    },
  },
  pro: {
    tier: "pro",
    name: "Pro",
    priceMonthly: 4900, // $49/mo
    limits: {
      facilities: 5,
      programsPerFacility: -1,
      staffMembers: 5,
      analyticsHistoryDays: 365,
    },
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    priceMonthly: 19900, // $199/mo
    limits: {
      facilities: -1,
      programsPerFacility: -1,
      staffMembers: -1,
      analyticsHistoryDays: -1,
    },
  },
};

// getPlanTierFromPriceId moved to ./prices.ts — it needs the server-only price
// env vars, and this module is client-reachable.
