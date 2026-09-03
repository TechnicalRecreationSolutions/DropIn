import { cache } from "react";
import type { JWK } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { perf } from "@/lib/perf";

/**
 * Who the current request is, established without talking to the auth server.
 *
 * `supabase.auth.getUser()` is a network call to `/auth/v1/user` on every
 * invocation — measured at 97-103ms against this project, and it was the single
 * largest cost in a dashboard navigation (paid once in the proxy and again in
 * the React tree, ~200ms of a ~390ms page). `getClaims()` does the same job by
 * verifying the access token's ES256 signature against the project's published
 * JWKS, which is local work: **1ms** once the key set is in hand.
 *
 * This is *not* the unsafe shortcut. `getSession()` decodes the cookie without
 * checking anything and would accept a forged token; `getClaims()` verifies the
 * signature and the expiry with WebCrypto, so a forged or altered token is
 * rejected exactly as the auth server would reject it. It is the same
 * verification Postgres itself performs on the JWT when RLS evaluates
 * `auth.uid()`.
 *
 * What it does *not* do is ask the auth server whether the session has since
 * been revoked. A token revoked mid-life stays acceptable here until it
 * expires. That window is bounded by the project's access-token lifetime, and
 * the proxy still calls `getUser()` on every dashboard navigation — so a
 * revoked session is caught there and redirected to /login before any of this
 * runs. See docs/PERFORMANCE.md for the reasoning and docs/SECURITY.md for
 * where this sits in the auth model.
 */

type Claims = { sub: string; email?: string };

/**
 * The JWKS, cached for the life of the server process.
 *
 * This cache is the whole point. `supabase-js` caches the key set on the client
 * *instance*, and this app builds a fresh client per request (it has to — the
 * client is bound to that request's cookies), so without a cache here every
 * request would re-fetch `/.well-known/jwks.json` and pay back the ~100ms that
 * local verification just saved.
 *
 * A key set is public data — no secret is held here.
 */
const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache: { keys: JWK[] } | null = null;
let jwksFetchedAt = 0;
let jwksInFlight: Promise<{ keys: JWK[] } | null> | null = null;

async function getJwks(): Promise<{ keys: JWK[] } | null> {
  const now = Date.now();
  if (jwksCache && now - jwksFetchedAt < JWKS_TTL_MS) return jwksCache;

  // Collapse concurrent misses onto one fetch: on a cold server every request
  // in the first burst would otherwise issue its own.
  jwksInFlight ??= (async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
        { cache: "no-store" }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { keys?: JWK[] };
      if (!data.keys?.length) return null;
      jwksCache = { keys: data.keys };
      jwksFetchedAt = Date.now();
      return jwksCache;
    } catch {
      return null;
    } finally {
      jwksInFlight = null;
    }
  })();

  return jwksInFlight;
}

/**
 * The signed-in user's claims, or null.
 *
 * Wrapped in React's `cache()` so the layout, the page and OrgGuard share one
 * verification per request.
 *
 * Falls back to `getUser()` whenever local verification isn't possible — the
 * JWKS endpoint is unreachable, or the project is signing with a symmetric key
 * so there is nothing to verify against locally. The fallback is a real network
 * check, so behaviour is correct either way; it is only slower.
 */
export const getClaims = cache(async (): Promise<Claims | null> => {
  const t = perf("getClaims");
  const supabase = await createClient();
  const jwks = await t.step("jwks", () => getJwks());

  const { data, error } = await t.step("verify", () =>
    // Passing the key set keeps the verification local. Without it supabase-js
    // fetches it itself — per client instance, so per request.
    supabase.auth.getClaims(undefined, jwks ? { jwks } : undefined)
  );

  t.end();

  if (error || !data?.claims?.sub) return null;
  return { sub: data.claims.sub, email: data.claims.email as string | undefined };
});
