/**
 * Plan catalogue: names, prices, facility caps and capability bundles.
 *
 * This module is imported by BillingClient.tsx, a client component, so it ships
 * to the browser and must contain nothing secret. Stripe price IDs deliberately
 * live in `./prices.ts` (server-only) — they used to be here, read from env vars
 * that are `undefined` in the bundle, which meant a missing variable in
 * production read as "this plan is not for sale" instead of failing.
 *
 * ## The billed unit is the facility
 *
 * A platform base fee plus a facility cap, and nothing else is metered.
 * Departments, schedule groups, spaces, sessions, session templates, staff
 * accounts, embeds and patron pageviews are unlimited on every tier, on
 * purpose. The reasoning is in docs/PRICING.md; the short version is that a
 * facility is the only unit a customer cannot collapse without making their own
 * public schedule wrong, and metering schedule groups would tax the multi-
 * schedule widget filter (migration 043) that the product exists to provide.
 */

import type { ScheduleTemplate } from "@/types/schedule.types";

/**
 * Catalogue keys — what the pricing page and billing page render.
 *
 * Deliberately NOT the same set as {@link StoredPlanTier}. See the bridge below.
 */
export type PlanTier = "starter" | "standard" | "multisite" | "enterprise";

/**
 * What `subscriptions.plan_tier` can actually hold today.
 *
 * Constrained by `CHECK (plan_tier IN ('free','pro','enterprise'))` in
 * migration `004_stripe_tables.sql`. Widening it to the catalogue keys above
 * needs a migration, which has not been written — so the database still speaks
 * the two-tier vocabulary and this module translates.
 */
export type StoredPlanTier = "free" | "pro" | "enterprise";

export interface Plan {
  tier: PlanTier;
  name: string;
  /** One line on who the tier is for, used on both pricing surfaces. */
  blurb: string;
  /** Cents per month. `null` = quoted, not published (Enterprise). */
  priceMonthly: number | null;
  /** Cents per year. Two months free against the monthly rate. `null` = quoted. */
  priceAnnual: number | null;
  /** Floor for a quoted tier, in cents per year. `null` for published tiers. */
  priceAnnualFrom: number | null;
  limits: {
    /** Facilities included in the base price. -1 = unlimited. */
    facilities: number;
    /** Cents per month for each facility beyond the cap. `null` = n/a. */
    extraFacilityMonthly: number | null;
    /** -1 = unlimited. */
    analyticsHistoryDays: number;
  };
  /** Widget and public-page views this tier may publish. */
  views: ScheduleTemplate[];
  /** Capabilities this tier adds over the one below it. Display copy. */
  adds: string[];
}

/**
 * Free-trial length, in days, for an org's first subscription.
 *
 * Single-sourced because it is a published commercial term: the pricing page,
 * the FAQ and `/api/stripe/create-checkout` all have to say the same number, and
 * copy promising a trial that Checkout does not set would be a promise the
 * product does not keep.
 */
export const TRIAL_PERIOD_DAYS = 14;

/**
 * The per-facility overage rate, in cents per month.
 *
 * Declared above the catalogue and referenced by it, so the rate the pricing
 * copy states and the rate the tiers charge cannot drift apart. One rate across
 * every tier that has one, which is what lets both pricing surfaces state it
 * once below the grid instead of per card.
 */
export const EXTRA_FACILITY_MONTHLY = 4500; // $45/mo

/** Unlimited on every tier — stated once rather than repeated per tier. */
export const ALWAYS_UNLIMITED = [
  "Departments",
  "Schedules",
  "Spaces",
  "Sessions and templates",
  "Staff accounts",
  "Embeds and pageviews",
] as const;

export const PLANS: Record<PlanTier, Plan> = {
  starter: {
    tier: "starter",
    name: "Starter",
    blurb: "One building — a community centre, a club, a single branch.",
    priceMonthly: 8900, // $89/mo
    priceAnnual: 89000, // $890/yr — two months free
    priceAnnualFrom: null,
    limits: {
      facilities: 1,
      extraFacilityMonthly: null, // one facility is the whole tier
      analyticsHistoryDays: 30,
    },
    views: ["grid", "list", "map"],
    adds: [
      "Schedule builder with conflict detection",
      "Public facility page",
      "Embeddable widget — grid, list and space views",
      "Your brand colour and logo",
      "CSV import",
      "30 days of analytics",
    ],
  },
  standard: {
    tier: "standard",
    name: "Standard",
    blurb: "A town or small city recreation department.",
    priceMonthly: 24900, // $249/mo
    priceAnnual: 249000, // $2,490/yr
    priceAnnualFrom: null,
    limits: {
      facilities: 4,
      extraFacilityMonthly: EXTRA_FACILITY_MONTHLY,
      analyticsHistoryDays: 365,
    },
    views: ["grid", "list", "map", "floorplan", "board"],
    adds: [
      "Floorplan and board views",
      "Let visitors filter between your schedules",
      "Activity log and per-week review",
      "12 months of analytics",
      "Priority email support",
    ],
  },
  multisite: {
    tier: "multisite",
    name: "Multi-site",
    blurb: "A city running every centre from one place.",
    priceMonthly: 54900, // $549/mo
    priceAnnual: 549000, // $5,490/yr
    priceAnnualFrom: null,
    limits: {
      facilities: 12,
      extraFacilityMonthly: EXTRA_FACILITY_MONTHLY,
      analyticsHistoryDays: 730,
    },
    views: ["grid", "list", "map", "floorplan", "board"],
    adds: [
      "One embed spanning every facility",
      "24 months of analytics",
      "Guided onboarding for your first schedule",
      "Uptime commitment",
    ],
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    blurb: "A region, a university, or a large operator.",
    priceMonthly: null,
    priceAnnual: null,
    priceAnnualFrom: 990000, // from $9,900/yr
    limits: {
      facilities: -1,
      extraFacilityMonthly: null,
      analyticsHistoryDays: -1,
    },
    views: ["grid", "list", "map", "floorplan", "board"],
    adds: [
      "Purchase order and annual invoicing",
      "Custom domain",
      "Unlimited analytics history",
      "A named contact and onboarding support",
      "Security review and data export on request",
    ],
  },
};

/** Display order, cheapest first. Both pricing surfaces use this. */
export const TIER_ORDER: PlanTier[] = ["starter", "standard", "multisite", "enterprise"];

/** The tier highlighted as the common choice. */
export const FEATURED_TIER: PlanTier = "standard";

/**
 * The cheapest published monthly price, for "plans start at …" copy.
 *
 * Derived rather than written down because that copy lives in the hero and the
 * closing CTA, far from the pricing section — which is exactly how both of them
 * went on saying $49 after the tiers moved. Quoted tiers have no monthly price
 * and are excluded.
 */
export const LOWEST_MONTHLY = Math.min(
  ...Object.values(PLANS)
    .map((p) => p.priceMonthly)
    .filter((p): p is number => p !== null)
);

// ---------------------------------------------------------------------------
// Bridge between the catalogue and what the database can store
// ---------------------------------------------------------------------------

/**
 * Translates a stored `plan_tier` into a catalogue entry.
 *
 * `null` means "no plan" rather than a cheap plan: `free` is not a tier anyone
 * can buy, it is the unpaid/expired state a row sits in before checkout or
 * after cancellation. Callers must render that as "no active plan", never as
 * Starter.
 *
 * The two legacy paid values map *up*, to the nearest tier that is at least as
 * generous. That direction is deliberate and matches the rule in prices.ts: a
 * customer silently under-entitled by a pricing migration is worse than one
 * briefly over-entitled. No live subscription is on either value today.
 *
 * Retire this once a migration widens the CHECK constraint to the catalogue
 * keys and backfills the existing rows.
 */
export const STORED_TIER_TO_PLAN: Record<StoredPlanTier, PlanTier | null> = {
  free: null,
  pro: "standard",
  enterprise: "multisite",
};

/**
 * The reverse direction, for starting a checkout.
 *
 * Only the tiers with a Stripe price configured today can be bought, and those
 * prices are still keyed by the legacy names (`STRIPE_PRICE_PRO_MONTHLY`,
 * `STRIPE_PRICE_ENTERPRISE_MONTHLY`) — so /api/stripe/create-checkout still
 * takes `pro | enterprise` and needs no change.
 *
 * A tier absent from this map has no price in Stripe yet and must route to
 * contact-sales rather than to a button that 400s. Creating the remaining
 * prices is an owner action; see docs/PRICING.md.
 */
export const PLAN_TO_CHECKOUT_TIER: Partial<Record<PlanTier, "pro" | "enterprise">> = {
  standard: "pro",
  multisite: "enterprise",
};

/** Whether a tier can be bought with a card right now. */
export function isSelfServe(tier: PlanTier): boolean {
  return tier in PLAN_TO_CHECKOUT_TIER;
}

/** `8900` -> `"89"`. Whole dollars; every published price is a round number. */
export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 });
}

// getPlanTierFromPriceId lives in ./prices.ts — it needs the server-only price
// env vars, and this module is client-reachable.
