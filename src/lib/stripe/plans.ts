export type PlanTier = "free" | "pro" | "enterprise";

export interface Plan {
  tier: PlanTier;
  name: string;
  priceMonthly: number; // in cents
  stripePriceId: string | null;
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
    stripePriceId: null,
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
    stripePriceId: process.env.STRIPE_PRICE_PRO_MONTHLY ?? null,
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
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? null,
    limits: {
      facilities: -1,
      programsPerFacility: -1,
      staffMembers: -1,
      analyticsHistoryDays: -1,
    },
  },
};

export function getPlanTierFromPriceId(priceId: string): PlanTier | null {
  for (const plan of Object.values(PLANS)) {
    if (plan.stripePriceId === priceId) return plan.tier;
  }
  return null;
}
