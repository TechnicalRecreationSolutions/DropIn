import { NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlanTierFromPriceId } from "@/lib/stripe/prices";
import type { Json } from "@/types/database.types";

// Raw body is required for Stripe signature verification — no body parsing
// middleware. Route handlers already run on Node and are dynamic by default,
// so the former `runtime`/`dynamic` exports were redundant, and both are
// rejected once cacheComponents is enabled.

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle management.
 *
 * Security:
 * - Signature verified with stripe.webhooks.constructEvent() against the raw,
 *   unparsed body before any processing.
 * - Plan tier is written only by this handler using the service role client
 *   (bypasses RLS). `subscriptions` has no client-side write policy, which is
 *   what makes plan tier unforgeable from the browser.
 * - subscription.metadata.org_id is trusted, but only because it is set by
 *   /api/stripe/create-checkout from a verified session and arrives inside a
 *   signature-verified event.
 *
 * Delivery semantics (see docs/SECURITY.md, finding M3):
 * - The stripe_events insert is a *claim*, not a completion. `processed` flips
 *   to true only after the handler succeeds.
 * - A failed handler returns 500 so Stripe retries; the row stays
 *   processed=false so the retry is allowed through rather than skipped.
 * - Every handler is therefore required to be idempotent.
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

  const db = createAdminClient();

  // ── Claim the event ────────────────────────────────────────────────────────
  // The insert is the claim: event_id is UNIQUE, so exactly one concurrent
  // delivery can create the row. `processed` stays false until the handler
  // actually succeeds — recording receipt and recording success are separate
  // facts, and conflating them is what previously let a paid customer end up
  // with no entitlement and no retry.
  const { error: claimError } = await db.from("stripe_events").insert({
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Json,
    processed: false,
  });

  if (claimError) {
    if (claimError.code === "23505") {
      // Seen before. Skip only if a previous attempt ran to completion —
      // otherwise this is Stripe retrying a delivery we failed, which is
      // exactly the case we want to handle rather than swallow.
      const { data: prior } = await db
        .from("stripe_events")
        .select("processed")
        .eq("event_id", event.id)
        .maybeSingle();

      if (prior?.processed) {
        return NextResponse.json({ ok: true, skipped: true });
      }
      // Fall through and retry. Every handler below is idempotent.
    } else {
      // We could not record the event at all. Processing it now would apply a
      // change we have no record of, so ask Stripe to redeliver instead.
      console.error(`Could not record Stripe event ${event.id}:`, claimError.message);
      return NextResponse.json({ error: "Could not record event" }, { status: 500 });
    }
  }

  // ── Process ───────────────────────────────────────────────────────────────
  try {
    await handleEvent(event, db);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Failed to handle Stripe event ${event.type} (${event.id}):`, message);
    // 500 so Stripe retries with backoff (~3 days). The row stays
    // processed=false, so the retry above falls through and tries again.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  // ── Commit ────────────────────────────────────────────────────────────────
  const { error: commitError } = await db
    .from("stripe_events")
    .update({ processed: true })
    .eq("event_id", event.id);

  if (commitError) {
    // The work succeeded but we failed to mark it. Acknowledge — a redelivery
    // would simply redo idempotent work. Worth alerting on.
    console.error(`Handled ${event.id} but could not mark it processed:`, commitError.message);
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: Stripe.Event, db: ReturnType<typeof createAdminClient>) {
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

async function upsertSubscription(subscription: Stripe.Subscription, db: ReturnType<typeof createAdminClient>) {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    // Not retryable — a subscription created outside our checkout flow (e.g.
    // by hand in the Stripe dashboard) will never grow this metadata, so
    // throwing would just burn three days of redeliveries. Logged loudly and
    // marked processed; if entitlements are missing for a customer, look here.
    console.error(
      `Stripe subscription ${subscription.id} has no org_id metadata — ` +
        `no entitlement applied. Was it created outside /api/stripe/create-checkout?`
    );
    return;
  }

  // Determine plan tier from the first price ID in the subscription.
  const item = subscription.items.data[0];
  const priceId = item?.price?.id;
  const tier = priceId ? getPlanTierFromPriceId(priceId) : null;

  if (!tier) {
    // Previously this fell back to "free" — which silently downgraded a paying
    // customer whenever a price ID was unrecognised. That happens for real:
    // PLANS reads stripePriceId from STRIPE_PRICE_PRO_MONTHLY /
    // STRIPE_PRICE_ENTERPRISE_MONTHLY, so if either env var is missing in an
    // environment, every paid subscription maps to null and everyone lands on
    // free. Fail loudly instead: Stripe retries, and the event sits
    // processed=false where it can be found.
    throw new Error(
      `Unrecognised Stripe price "${priceId ?? "none"}" on subscription ${subscription.id}. ` +
        `Check STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_ENTERPRISE_MONTHLY in this environment.`
    );
  }

  const status = subscription.status; // active, trialing, past_due, canceled, etc.

  // Period dates live on the subscription item, not the subscription root
  // (moved in newer Stripe API versions — see subscription.items.data[].current_period_start/end).
  // Cast needed: the installed stripe package's types are pinned to an older
  // API version than the account's runtime behavior and don't declare these fields yet.
  const itemPeriod = item as unknown as { current_period_start: number; current_period_end: number };

  const { error } = await db.from("subscriptions").upsert(
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

  // Throw rather than return: the caller turns this into a 500 so Stripe
  // retries. An unchecked write here was the quietest way to lose an
  // entitlement — the webhook returned 200 having written nothing.
  if (error) {
    throw new Error(`subscriptions upsert failed for org ${orgId}: ${error.message}`);
  }
}

async function cancelSubscription(subscription: Stripe.Subscription, db: ReturnType<typeof createAdminClient>) {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.error(
      `Stripe subscription ${subscription.id} deleted but carries no org_id metadata — ` +
        `no downgrade applied.`
    );
    return;
  }

  const { error } = await db
    .from("subscriptions")
    .update({
      plan_tier: "free",
      status: "canceled",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`subscriptions downgrade failed for org ${orgId}: ${error.message}`);
  }
}
