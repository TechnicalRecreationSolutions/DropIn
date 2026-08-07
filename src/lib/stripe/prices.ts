import { requireEnv } from "@/lib/env";
import type { PlanTier } from "./plans";

/**
 * Server-only mapping between plan tiers and Stripe price IDs.
 *
 * Kept out of plans.ts because that module is imported by BillingClient.tsx, a
 * client component — so it ships to the browser, where non-`NEXT_PUBLIC_` env
 * vars are `undefined`. Price IDs previously lived on PLANS and silently
 * resolved to null in the bundle; harmless there only because nothing client-side
 * read them. Splitting the modules makes that guarantee structural instead of
 * incidental.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "lib/stripe/prices is server-only — it reads secret env vars. " +
      "Import PLANS from lib/stripe/plans for anything the browser renders."
  );
}

/** Tiers that are actually purchasable. `free` has no Stripe price. */
export type PaidPlanTier = Extract<PlanTier, "pro" | "enterprise">;

const PRICE_ENV_VAR: Record<PaidPlanTier, string> = {
  pro: "STRIPE_PRICE_PRO_MONTHLY",
  enterprise: "STRIPE_PRICE_ENTERPRISE_MONTHLY",
};

/**
 * The Stripe price ID for a paid tier. Throws if unconfigured.
 *
 * Throwing rather than returning null is the point: the previous shape let a
 * missing env var read as "this plan isn't for sale", which looks like an
 * intentional product state rather than a broken deployment.
 */
export function getStripePriceId(tier: PaidPlanTier): string {
  return requireEnv(PRICE_ENV_VAR[tier]);
}

/**
 * Reverse lookup used by the Stripe webhook to turn a price ID on an incoming
 * subscription into a plan tier.
 *
 * Returns null only when the price genuinely belongs to no known tier — callers
 * must treat that as an error, never as a reason to fall back to `free`. A
 * paying customer downgraded by a config gap is worse than a failed webhook,
 * which Stripe will retry. See docs/SECURITY.md finding M3.
 */
export function getPlanTierFromPriceId(priceId: string): PaidPlanTier | null {
  for (const tier of Object.keys(PRICE_ENV_VAR) as PaidPlanTier[]) {
    if (getStripePriceId(tier) === priceId) return tier;
  }
  return null;
}
