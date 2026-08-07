/**
 * Required server environment variables, validated at server startup.
 *
 * The pattern this replaces: `process.env.SOMETHING ?? someDefault`. A missing
 * variable then produces a *plausible but wrong* app rather than a stopped one —
 * paid customers silently on the free tier, IP hashes silently reversible. Both
 * of those were real findings (M3, M6 in docs/SECURITY.md).
 *
 * Validation runs from src/instrumentation.ts, which Next calls once per server
 * instance before any request is served. Deliberately *not* at module load of
 * the consuming files: that would make `next build` require production secrets,
 * which breaks contributors and CI for no security benefit. The deployment
 * failing to boot is the loud signal we want; a build that cannot run without
 * live Stripe keys is not.
 *
 * NOTE: server-only. Never import this from a client component — the values are
 * secrets and would be `undefined` in the browser regardless.
 */

/** Each entry explains what breaks if the variable is absent. */
const REQUIRED_SERVER_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL:
    "Supabase project URL — every database call fails without it.",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "Supabase anon key — all user-scoped queries fail without it.",
  SUPABASE_SERVICE_ROLE_KEY:
    "Service role key — signup, the Stripe webhook, analytics and rate limiting all need it.",
  STRIPE_SECRET_KEY:
    "Stripe API key — checkout and the billing portal fail without it.",
  STRIPE_WEBHOOK_SECRET:
    "Stripe signing secret — without it the webhook rejects every event and no subscription is ever recorded.",
  STRIPE_PRICE_PRO_MONTHLY:
    "Stripe price ID for Pro. Missing => the webhook cannot map a paid subscription to a tier.",
  STRIPE_PRICE_ENTERPRISE_MONTHLY:
    "Stripe price ID for Enterprise. Missing => the webhook cannot map a paid subscription to a tier.",
  ANALYTICS_IP_SALT:
    "Per-deployment salt for hashing visitor IPs. Missing => hashes are trivially reversible and the 'no raw PII' guarantee fails.",
};

/**
 * Reads a required server variable, throwing if it is absent or blank.
 *
 * Use this instead of `process.env.X ?? fallback` anywhere the fallback would
 * be silently wrong rather than merely degraded.
 */
export function requireEnv(name: keyof typeof REQUIRED_SERVER_ENV | string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `${REQUIRED_SERVER_ENV[name] ?? ""}`.trim()
    );
  }
  return value;
}

/**
 * Validates every required variable at once and throws a single error listing
 * all that are missing.
 *
 * Reporting them together matters: failing on the first one turns configuring a
 * new environment into a deploy-fix-deploy loop, which is how people end up
 * setting a variable in Preview and forgetting Production.
 */
export function validateServerEnv(): void {
  const missing = Object.keys(REQUIRED_SERVER_ENV).filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === "";
  });

  if (missing.length === 0) return;

  const detail = missing.map((n) => `  - ${n}: ${REQUIRED_SERVER_ENV[n]}`).join("\n");
  throw new Error(
    `Server startup aborted — ${missing.length} required environment ` +
      `variable(s) are not set:\n${detail}\n\n` +
      `Set them in this environment (for Vercel: Project → Settings → ` +
      `Environment Variables, and check the Production column specifically). ` +
      `See docs/SECURITY.md.`
  );
}
