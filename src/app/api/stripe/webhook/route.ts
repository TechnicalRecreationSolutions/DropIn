import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlanTierFromPriceId } from "@/lib/stripe/plans";

export const runtime = "nodejs";

// Raw body is required for Stripe signature verification — no body parsing middleware
export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle management.
 *
 * Security:
 * - Signature verified with stripe.webhooks.constructEvent() before any processing.
 * - Each event is idempotency-checked by stripe_event_id before DB writes.
 * - Plan tier is written only by this handler using the service role client (bypasses RLS).
 * - Never trusts event metadata without cross-referencing Stripe's verified event data.
 */
export async function POST(request: Request) {
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Read raw body — required for signature verification
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  const db = admin as any;

  // Idempotency: check if this event has already been processed
  const { data: existing } = await db
    .from("stripe_events")
    .select("id")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existing) {
    // Already processed — acknowledge without re-processing
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Record the event before processing (prevents double-processing on retry)
  await db.from("stripe_events").insert({
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });

  try {
    await handleEvent(event, db);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Failed to handle Stripe event ${event.type} (${event.id}):`, message);
    // Don't return 500 — Stripe will retry, but we already recorded it above.
    // Log the failure but acknowledge receipt.
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: Stripe.Event, db: any) {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await upsertSubscription(subscription, db);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await cancelSubscription(subscription, db);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // Log for alerting — in production, send an email via Resend
      console.warn("Payment failed for customer:", invoice.customer, "invoice:", invoice.id);
      break;
    }

    default:
      // Unhandled event type — not an error, just not acted on
      break;
  }
}

async function upsertSubscription(subscription: Stripe.Subscription, db: any) {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.error("Subscription missing org_id metadata:", subscription.id);
    return;
  }

  // Determine plan tier from the first price ID in the subscription
  const item = subscription.items.data[0];
  const priceId = item?.price?.id;
  const tier = priceId ? (getPlanTierFromPriceId(priceId) ?? "free") : "free";

  const status = subscription.status; // active, trialing, past_due, canceled, etc.

  // Period dates live on the subscription item, not the subscription root
  // (moved in newer Stripe API versions — see subscription.items.data[].current_period_start/end).
  // Cast needed: the installed stripe package's types are pinned to an older
  // API version than the account's runtime behavior and don't declare these fields yet.
  const itemPeriod = item as unknown as { current_period_start: number; current_period_end: number };

  await db.from("subscriptions").upsert(
    {
      org_id: orgId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer as string,
      plan_tier: tier,
      status,
      current_period_start: new Date(itemPeriod.current_period_start * 1000).toISOString(),
      current_period_end: new Date(itemPeriod.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" }
  );
}

async function cancelSubscription(subscription: Stripe.Subscription, db: any) {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) return;

  await db
    .from("subscriptions")
    .update({
      plan_tier: "free",
      status: "canceled",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);
}
