import { requireEnv } from "@/lib/env";
import type { StoredPlanTier } from "./plans";

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

/**
 * Stored tiers that are actually purchasable. `free` has no Stripe price.
 *
 * These are the *legacy* names the database and Stripe still use — migration
 * 004's CHECK constraint has not been widened to the catalogue keys in
 * ./plans.ts. `PLAN_TO_CHECKOUT_TIER` there maps a catalogue tier onto one of
 * these; a catalogue tier absent from that map has no price yet and must not
 * reach checkout. `pro` sells Standard and `enterprise` sells Multi-site.
 */
export type PaidPlanTier = Extract<StoredPlanTier, "pro" | "enterprise">;

/** How often the subscription renews. Stripe's own vocabulary. */
export type BillingInterval = "month" | "year";

/**
 * Which env var holds each (tier, interval) price.
 *
 * ## The monthly vars are required; the annual ones are deliberately not
 *
 * Both monthly vars are in `REQUIRED_SERVER_ENV` (src/lib/env.ts) and the
 * server refuses to boot without them. The annual vars are **optional on
 * purpose**: the annual Stripe prices do not exist yet — creating them is an
 * owner action (docs/PRICING.md) — and promoting them to required would take
 * every existing deployment down at the next boot to enable a feature nobody
 * can buy yet.
 *
 * So annual ships dark. `hasInterval()` below reports whether it is configured,
 * the billing page asks before offering the choice, and the checkout route
 * refuses an annual request it cannot price. The day the prices exist, setting
 * two env vars turns it on with no code change.
 */
const PRICE_ENV_VAR: Record<PaidPlanTier, Record<BillingInterval, string>> = {
  pro: {
    month: "STRIPE_PRICE_PRO_MONTHLY",
    year: "STRIPE_PRICE_PRO_ANNUAL",
  },
  enterprise: {
    month: "STRIPE_PRICE_ENTERPRISE_MONTHLY",
    year: "STRIPE_PRICE_ENTERPRISE_ANNUAL",
  },
};

/** Every tier this module knows how to sell. */
const PAID_TIERS = Object.keys(PRICE_ENV_VAR) as PaidPlanTier[];

/**
 * The Stripe price ID for a tier and interval. Throws if unconfigured.
 *
 * Throwing rather than returning null is the point: the previous shape let a
 * missing env var read as "this plan isn't for sale", which looks like an
 * intentional product state rather than a broken deployment.
 *
 * Callers that can *tolerate* an unconfigured price — anything scanning the
 * whole catalogue rather than charging one specific price — must use
 * {@link findPriceId} or {@link hasInterval} instead. See the warning on
 * {@link getPlanTierFromPriceId}.
 */
export function getStripePriceId(
  tier: PaidPlanTier,
  interval: BillingInterval = "month"
): string {
  return requireEnv(PRICE_ENV_VAR[tier][interval]);
}

/**
 * The configured price ID for a tier and interval, or `null` if it is unset.
 *
 * The non-throwing counterpart to {@link getStripePriceId}. Reads
 * `process.env` directly rather than going through `requireEnv`, because here
 * "not set" is a legitimate answer rather than a broken deployment.
 */
function findPriceId(tier: PaidPlanTier, interval: BillingInterval): string | null {
  const value = process.env[PRICE_ENV_VAR[tier][interval]];
  return value && value.trim() !== "" ? value : null;
}

/**
 * Is this billing interval sellable across **every** purchasable tier?
 *
 * All-or-nothing on purpose. A half-configured interval — annual on Standard
 * but not Multi-site — would render a working toggle beside a button that
 * 400s, which is a support call rather than a feature. With two purchasable
 * tiers that will be configured in one sitting, the simple rule is the right
 * one; revisit if the tiers ever diverge for a real reason.
 */
export function hasInterval(interval: BillingInterval): boolean {
  return PAID_TIERS.every((tier) => findPriceId(tier, interval) !== null);
}

/**
 * Reverse lookup used by the Stripe webhook to turn a price ID on an incoming
 * subscription into a plan tier.
 *
 * Returns null only when the price genuinely matches no *configured* price —
 * callers must treat that as an error, never as a reason to fall back to
 * `free`. A paying customer downgraded by a config gap is worse than a failed
 * webhook, which Stripe will retry. See docs/SECURITY.md finding M3.
 *
 * ## Why this must not use getStripePriceId()
 *
 * It used to, and that was safe only while every known price was a required
 * env var. The moment an optional one exists — the annual prices above — a
 * `requireEnv` inside this loop throws "Missing required environment variable"
 * on an unset annual var *while identifying a perfectly valid monthly
 * subscription*. The webhook would 500, Stripe would retry, and no entitlement
 * would ever be written: a strictly worse failure than the null this function
 * is careful to avoid returning by accident.
 *
 * So it scans configured prices only. An unset price cannot match anything,
 * which is exactly right — no incoming subscription can carry a price ID that
 * does not exist in Stripe.
 */
export function getPlanTierFromPriceId(priceId: string): PaidPlanTier | null {
  for (const tier of PAID_TIERS) {
    for (const interval of ["month", "year"] as BillingInterval[]) {
      if (findPriceId(tier, interval) === priceId) return tier;
    }
  }
  return null;
}

/**
 * Human-readable list of the env vars behind an interval, for error messages.
 *
 * The webhook's "unrecognised price" error used to name the two monthly vars
 * literally. With four possible vars, an operator reading that error needs to
 * be told which ones this deployment actually knows about.
 */
export function priceEnvVarNames(): string[] {
  return PAID_TIERS.flatMap((tier) => [
    PRICE_ENV_VAR[tier].month,
    PRICE_ENV_VAR[tier].year,
  ]);
}
