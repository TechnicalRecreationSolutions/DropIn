import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { PLANS, type PlanTier } from "@/lib/stripe/plans";

const CreateCheckoutSchema = z.object({
  tier: z.enum(["pro", "enterprise"]),
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

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Only org owners and admins can manage billing" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateCheckoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid tier" }, { status: 400 });

  const { tier } = parsed.data as { tier: PlanTier };
  const plan = PLANS[tier];

  if (!plan.stripePriceId) {
    return NextResponse.json({ error: "This plan is not available for checkout" }, { status: 400 });
  }

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

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${APP_URL}/dashboard/billing?success=1`,
    cancel_url: `${APP_URL}/dashboard/billing?cancelled=1`,
    metadata: { org_id: org.id, tier },
    subscription_data: {
      metadata: { org_id: org.id, tier },
    },
  });

  return NextResponse.json({ url: session.url });
}
