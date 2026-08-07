import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared rate limiting, backed by the `rate_limits` table (migration 025).
 *
 * Postgres rather than an in-memory counter because serverless invocations
 * don't share memory — a per-process counter limits nothing. Postgres is a
 * shared store that survives restarts and is already part of the stack.
 *
 * This module is the single seam for that choice. If a route ever outgrows a
 * DB round trip per request, swap the body of `checkRateLimit` for Upstash and
 * nothing else has to change.
 *
 * NOTE: login is NOT rate limited here and cannot be. LoginForm calls
 * supabase.auth.signInWithPassword() directly from the browser, so the request
 * never reaches this app. That limit lives in the Supabase dashboard under
 * Authentication → Rate Limits.
 */

/** Tuned per endpoint by cost, not uniformly. */
export const RATE_LIMITS = {
  /** Creates an unconfirmed auth user and sends an email. Tight, because the
   *  outbound mail is both a cost and a sender-reputation risk. */
  signup: { limit: 5, windowSeconds: 600 },
  /** Creates an org + owner membership with the service role. Since signup no
   *  longer creates the org, this is where slug-namespace exhaustion would now
   *  happen — it needs its own limit, not signup's. */
  onboardOrg: { limit: 5, windowSeconds: 600 },
  /** Public, called once per widget load. Generous, but bounded. */
  analytics: { limit: 60, windowSeconds: 60 },
  /** Creates Stripe customers and checkout sessions — a paid API. */
  checkout: { limit: 10, windowSeconds: 300 },
  /** Parses a 10 MB spreadsheet in memory. CPU-bound. */
  importFile: { limit: 10, windowSeconds: 300 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Best-effort client IP.
 *
 * x-forwarded-for is client-controlled in general, but on Vercel the platform
 * overwrites it, so the first entry is trustworthy there. If this app is ever
 * hosted behind a proxy that does NOT normalize the header, an attacker can
 * rotate the value to evade IP-keyed limits — prefer keying on user id wherever
 * a session exists, which the authenticated callers below do.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Returns true when the request is allowed, false when the caller is over
 * their limit.
 *
 * Fails OPEN. If the limiter itself errors (migration not applied, DB
 * unreachable) the request proceeds and the failure is logged. A rate limiter
 * that takes the site down when it breaks is a worse outage than the abuse it
 * prevents — and every endpoint guarded here needs the database anyway, so a
 * DB outage already fails them for real reasons.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string
): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[name];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: `${name}:${identifier}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error(`[rate-limit] ${name} check failed, allowing:`, error.message);
      return true;
    }

    return data !== false;
  } catch (err) {
    console.error(
      `[rate-limit] ${name} check threw, allowing:`,
      err instanceof Error ? err.message : "unknown"
    );
    return true;
  }
}

/** Standard 429 with Retry-After, so well-behaved clients back off. */
export function rateLimitResponse(name: RateLimitName): Response {
  const { windowSeconds } = RATE_LIMITS[name];
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again shortly." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(windowSeconds),
      },
    }
  );
}
