import crypto from "crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";

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
  /** Every schedule surface (widget, public facility page, dashboard command
   *  centre) calls this on load and again on every week/month/template
   *  switch, so legitimate use can fire several calls in quick succession.
   *  Generous, but still caps a scripted flood — each call is a multi-table
   *  join plus RRULE expansion, and unlike the routes above this one has no
   *  auth requirement at all. */
  sessionsExpand: { limit: 180, windowSeconds: 60 },
  /** The public directory (/api/public/v1/directory). No auth, and a future
   *  native app will call it too. Each call is served from a shared cache, so
   *  this limit is about scraping and floods, not database cost; a person
   *  typing into a search box stays well under it. */
  directory: { limit: 120, windowSeconds: 60 },
  /** Creates Stripe customers and checkout sessions — a paid API. */
  checkout: { limit: 10, windowSeconds: 300 },
  /** Parses a 10 MB spreadsheet in memory. CPU-bound. */
  importFile: { limit: 10, windowSeconds: 300 },
  /** Sends a staff invitation email. Outbound mail again, so the same
   *  reasoning as signup — but keyed on the INVITER, not the IP, because the
   *  risk is one compromised manager account spraying invitations, and a whole
   *  recreation centre can share an IP. Generous enough to onboard a shift. */
  staffInvite: { limit: 20, windowSeconds: 3600 },
  /** Looking an invitation up by token. It is a guessing oracle by nature:
   *  invitation_by_token() answers "valid or not" to an unauthenticated caller.
   *  The tokens are 32 random bytes so guessing is not a practical attack and
   *  this is belt-and-braces (migration 023 asked for it explicitly), but the
   *  accept page loads it once and a retry costs nothing. */
  invitationLookup: { limit: 20, windowSeconds: 600 },
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
 * The bucket key actually stored in `rate_limits`.
 *
 * Callers pass a raw identifier — often an IP address — and it is never
 * written as-is: the privacy policy says Dropin does not store IP addresses,
 * and until 2026-09-16 this table did (`analytics:<ip>`, kept well past the
 * one-day sweep, which is not scheduled). An HMAC with the deployment's
 * ANALYTICS_IP_SALT and today's date, the same secret and rotation analytics
 * uses, keeps the counter working while making the stored key useless for
 * recovering or linking an address. A window that spans midnight UTC restarts
 * its count, which only ever lets a caller through early.
 */
function bucketKey(name: RateLimitName, identifier: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const digest = crypto
    .createHmac("sha256", requireEnv("ANALYTICS_IP_SALT"))
    .update(`${today}:${identifier}`)
    .digest("hex")
    .slice(0, 32);
  return `${name}:${digest}`;
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
      p_key: bucketKey(name, identifier),
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
