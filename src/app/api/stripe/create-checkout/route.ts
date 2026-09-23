import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRouteMembership } from "@/lib/auth/membership";
import { requirePermission } from "@/lib/auth/guard";
import { stripe } from "@/lib/stripe/client";
import {
  getStripePriceId,
  hasInterval,
  type BillingInterval,
  type PaidPlanTier,
} from "@/lib/stripe/prices";
import { TRIAL_PERIOD_DAYS } from "@/lib/stripe/plans";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

/**
 * `interval` defaults to "month" so an older client — or anything posting the
 * pre-2026-09-20 body shape, which had no interval at all — keeps working
 * unchanged rather than 400ing on a field it does not know to send.
 */
const CreateCheckoutSchema = z.object({
  tier: z.enum(["pro", "enterprise"]),
  interval: z.enum(["month", "year"]).default("month"),
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dropin.app";

/**
 * POST /api/stripe/create-checkout
 *
 * Creates a Stripe Checkout session for the authenticated org's subscription upgrade.
 * Returns { url } for client-side redirect.
 * The org_id is derived from the verified server-side session — never trusted from client input.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Keyed on user id rather than IP: this route calls a paid API and creates
  // Stripe customers, and the caller is authenticated so identity is the right
  // scope — one abuser cannot then throttle everyone behind a shared NAT.
  if (!(await checkRateLimit("checkout", user.id))) {
    return rateLimitResponse("checkout");
  }

  const membership = await getRouteMembership(supabase, user.id);

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });
  const denied = requirePermission(membership, "billing:manage");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateCheckoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid tier" }, { status: 400 });

  const { tier, interval } = parsed.data as {
    tier: PaidPlanTier;
    interval: BillingInterval;
  };

  // An unconfigured ANNUAL price is a known product state, not a broken
  // deployment — the annual Stripe prices do not exist yet and their env vars
  // are deliberately optional (see lib/stripe/prices). The billing page does
  // not offer the choice unless hasInterval() says it can, so reaching here
  // means a client posted past the UI. 400 with a straight answer.
  //
  // Note the asymmetry with the monthly case below: that one throws a 500,
  // because a missing *monthly* price IS a broken deployment and dressing it
  // up as a product decision is what this route used to get wrong.
  if (interval === "year" && !hasInterval("year")) {
    return NextResponse.json(
      { error: "Annual billing is not available yet. Choose monthly, or contact us." },
      { status: 400 }
    );
  }

  // Throws if the price env var is unset — a 500 is correct here. This used to
  // return 400 "This plan is not available for checkout", which made a broken
  // deployment look like a deliberate product decision. The schema above
  // restricts tier to pro|enterprise, so `free` never reaches this.
  const stripePriceId = getStripePriceId(tier, interval);

  // Fetch or create Stripe customer
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .eq("id", membership.org_id)
    .single();

  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: org.name,
      metadata: { org_id: org.id },
    });
    customerId = customer.id;

    // Persist customer ID (using service role would bypass RLS; use server client which has org access via RLS)
    await supabase
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", org.id);
  }

  // The trial is a first-subscription offer, not a recurring one. Granting it
  // unconditionally would let an org cancel and re-checkout for a fresh trial
  // indefinitely, so it is keyed on whether this org has ever had a Stripe
  // subscription at all — a cancelled row still counts as having had one.
  const { data: priorSubscription } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("org_id", org.id)
    .not("stripe_subscription_id", "is", null)
    .limit(1)
    .maybeSingle();

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: `${APP_URL}/dashboard/settings/billing?success=1`,
    cancel_url: `${APP_URL}/dashboard/settings/billing?cancelled=1`,
    // `interval` is recorded for support and for reading the Stripe dashboard;
    // nothing derives entitlement from it. The tier still comes from the price
    // ID on the subscription (webhook → getPlanTierFromPriceId), because
    // metadata is what *we* claimed at checkout and the price is what Stripe
    // actually billed. When those disagree, the money is the truth.
    metadata: { org_id: org.id, tier, interval },
    subscription_data: {
      metadata: { org_id: org.id, tier, interval },
      // Published on the pricing page and in the terms, so it has to be set
      // here or the copy is a promise the product does not keep.
      ...(priorSubscription ? {} : { trial_period_days: TRIAL_PERIOD_DAYS }),
    },
  });

  return NextResponse.json({ url: session.url });
}
