import Stripe from "stripe";
import { requireEnv } from "@/lib/env";

/**
 * Shared Stripe client, constructed on first use rather than on import.
 *
 * The lazy construction is load-bearing, not a style choice. This module used
 * to throw at module evaluation if STRIPE_SECRET_KEY was absent, which meant
 * `next build` failed with "Failed to collect configuration for
 * /api/stripe/create-portal" — Next evaluates every route module while
 * collecting config, so the secret became a *build* requirement.
 *
 * That contradicted the deliberate design in src/lib/env.ts: validation runs
 * from src/instrumentation.ts at server startup, specifically so a build does
 * not require production secrets. A deployment refusing to boot with a list of
 * every missing variable is the loud, useful signal; a build failing on the
 * first route file that happens to import Stripe is neither — it names one
 * variable, at the wrong stage, and looks like a code error rather than a
 * configuration one.
 *
 * Exported as a Proxy so the three call sites keep using `stripe.foo.bar()`
 * unchanged. Property access resolves against the real client, constructing it
 * once on the first access and reusing it after.
 */
let client: Stripe | null = null;

function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      // Pinned deliberately. Stripe nests fields differently between versions,
      // and a silent change here is what caused the webhook to drop paid
      // entitlements in finding M3 — see docs/SECURITY.md. Do not bump this
      // without re-checking the webhook against a real event payload.
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return client;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, property) {
    const instance = getStripe() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    // Bind top-level methods to the real client; nested resources
    // (stripe.checkout, stripe.webhooks) are plain objects and carry their own
    // `this` when their methods are called off them.
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
