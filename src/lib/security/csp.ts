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
 *   - Mapbox     — the map on /dashboard/facilities (FacilityMapCanvas). Map
 *                  tiles and the GL renderer only; geocoding stays on
 *                  Nominatim, server-side (src/lib/geo/geocode.ts), so the
 *                  browser never sends Mapbox an address.
 *
 * Mapbox was removed in ef0a035 and came back for display only. Its origins,
 * each for one reason:
 *   - connect-src https://api.mapbox.com — the style JSON, sprites, glyphs and
 *     vector tiles (v3 fetches all of these, images included, with fetch()).
 *   - connect-src https://*.tiles.mapbox.com — tiles from styles that still
 *     name the older tile hosts.
 *   - connect-src https://events.mapbox.com — the map-load event Mapbox bills
 *     by. Blocking it is a breach of their terms, not a privacy win.
 *
 * These are on every page, not only the facilities page, on purpose: a CSP
 * belongs to the document, and moving between dashboard pages is a client
 * navigation that keeps the document — a policy set only on the facilities
 * URL would apply only when that page is the first one loaded.
 *
 * What did NOT come back is `blob:` in worker-src/child-src. mapbox-gl's
 * default build compiles its worker from a blob URL; the page loads the CSP
 * build instead (`mapbox-gl/dist/mapbox-gl-csp`), whose worker is a plain file
 * served from this origin (`/mapbox-gl-csp-worker.js`, copied out of
 * node_modules by scripts/copy-mapbox-worker.mjs), so 'self' covers it.
 * Nothing else in the app creates a worker or an object URL — `ImageUpload`
 * uploads first and previews from the returned Supabase URL.
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
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com${isDev ? " ws: http://localhost:*" : ""}`,
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
