/**
 * Next calls register() once per server instance, and it must complete before
 * any request is served — which makes it the right place to refuse to start on
 * a misconfigured environment.
 *
 * The alternative, validating lazily at the call site, means a missing variable
 * surfaces as one broken feature much later: an "upgrade" button that 500s, or
 * worse, analytics quietly hashing IPs with a public salt. Failing at boot turns
 * that into a failed deployment, which is visible immediately and rolls back.
 */
export async function register() {
  // Node runtime only. The Proxy runs on Edge, where these server secrets are
  // neither present nor needed, so validating there would fail spuriously.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateServerEnv } = await import("@/lib/env");
  validateServerEnv();
}
