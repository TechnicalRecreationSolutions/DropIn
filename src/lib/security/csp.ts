const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy.
 *
 * `script-src` carries 'unsafe-inline' rather than a nonce, and that is a
 * deliberate trade, not an oversight. Nonces must be minted per request, so
 * Next can only apply them to dynamically rendered pages — the framework's own
 * docs state that "Partial Prerendering (PPR) is incompatible with nonce-based
 * CSP since static shell scripts won't have access to the nonce". This app runs
 * `cacheComponents: true` (PPR) precisely so every route ships a prerendered
 * shell (see PERFORMANCE.md / commit aad5c3f). Adopting nonces would force every
 * page dynamic and undo that work.
 *
 * So the XSS ceiling here is set by 'unsafe-inline'. What the policy still buys:
 * scripts cannot be loaded from an origin we did not list, `object-src 'none'`
 * kills plugin embeds, `base-uri 'self'` blocks base-tag injection redirecting
 * relative script URLs, and `form-action 'self'` stops an injected form
 * exfiltrating to a third party. Tightening `script-src` further needs either
 * experimental `sri` (hash-based, keeps static rendering) or giving up PPR —
 * both are real options, neither is free.
 *
 * Origins are exactly what the app uses; anything added later must be added
 * here or it fails closed at runtime:
 *   - Supabase   — REST + realtime websocket, and Storage for org/facility images
 *   - fonts      — none external; next/font/google self-hosts at build time
 *   - Stripe     — none; checkout is a server-side redirect, no Stripe.js loads
 *
 * Mapbox and `blob:` were both removed when the cross-org search page went.
 * Mapbox was the only third-party origin the browser ever contacted, and
 * mapbox-gl compiling its tile worker from a blob URL was the only reason
 * worker-src/child-src allowed blob: at all. Nothing else in the app creates a
 * worker or an object URL — `ImageUpload` uploads first and previews from the
 * returned Supabase URL — so both allowances now have no user and the policy is
 * narrower than it was.
 */
export function contentSecurityPolicy(frameAncestors: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.supabase.co",
    "font-src 'self' data:",
    // ws: in dev only — the HMR socket. Shipping it in prod would let an
    // injected script open a plaintext socket to anywhere.
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${isDev ? " ws: http://localhost:*" : ""}`,
    "worker-src 'self'",
    "child-src 'self'",
    // The only iframe is the widget preview in /dashboard/widget, whose src is
    // a relative path (WidgetStudio's previewSrc) so it is always 'self'. It
    // used to be built from NEXT_PUBLIC_APP_URL and was blocked on every origin
    // other than that one — keep it relative.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    // Omitted in dev: it would rewrite http://localhost subresources to https.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
