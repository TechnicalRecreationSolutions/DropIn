import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * HSTS lifetime, in seconds.
 *
 * **Currently set to the rollout value (1 hour), not the production value.**
 *
 * HSTS is close to irreversible by design: once a browser sees this header for
 * a host, it refuses plain HTTP for that host — and with `includeSubDomains`,
 * for every subdomain — until the max-age expires. There is no way to recall
 * that instruction from browsers that already have it. A two-year policy
 * published against a domain whose subdomains are not all HTTPS yet takes two
 * years to age out, per visitor.
 *
 * So the long value is deliberately withheld until the domain is settled. One
 * hour is long enough to be a real policy and short enough that a mistake ages
 * out over lunch.
 *
 * **Raise this to 63072000 (two years) once:** the production domain is
 * attached, and every subdomain you intend to use — including any marketing,
 * docs or staging host — serves HTTPS. Only consider `preload` after that has
 * been true and stable for a while; preloading bakes the domain into browser
 * binaries and removal takes months.
 */
const HSTS_MAX_AGE = 3600;

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
function contentSecurityPolicy(frameAncestors: string): string {
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
    // The only iframe is the widget preview in /dashboard/widget, which builds
    // its src from NEXT_PUBLIC_APP_URL. 'self' therefore holds only while that
    // variable matches the origin actually serving the page — on a preview
    // deployment pointed at the production domain it does not, and the preview
    // pane silently goes blank. Add that origin here if that setup is wanted.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    // Omitted in dev: it would rewrite http://localhost subresources to https.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const nextConfig: NextConfig = {
  // Normally `.next`. Overridable so a production build can be made and served
  // while `next dev` is still running against the default directory — the two
  // would otherwise fight over the same build output. Used by
  // `scripts/verify/perf-nav.mjs`, which has to measure `next start` because
  // dev-mode timings include Turbopack work that production never does.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  // Partial Prerendering by default: each route ships a prerendered static
  // shell immediately, and per-user data streams in behind its Suspense
  // boundaries. The dashboard's data is all cookie-scoped and cannot be shared
  // between users, so the win here is the shell — not caching the data itself.
  cacheComponents: true,

  // `partialPrefetching: true` was tried here and removed again. It is the
  // framework's recommended direction — one shared App Shell per route rather
  // than a prefetch per link — but measured against this app it bought
  // nothing, because the shell was never the slow part: click-to-heading was
  // already 63ms and the shell is prefetched under the old model too. In
  // `next dev` it was actively worse (settled 490ms -> 730ms), since every
  // sidebar link visible on a page asks the single dev server to render
  // another shell, and the navigation then queues behind that work.
  // Numbers in docs/PERFORMANCE.md. Worth revisiting if the sidebar ever
  // links to far more routes than it does now.

  images: {
    remotePatterns: [
      {
        // Supabase Storage — org logos, facility photos, program images
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  async headers() {
    return [
      // ---------------------------------------------------------------
      // HSTS — applies to every response, including /widget and /embed.
      // Kept in its own catch-all block because it is the one header that is
      // host-wide rather than route-specific. Nothing else goes here: two
      // matching blocks that both set Content-Security-Policy would emit the
      // header twice, and browsers enforce the *intersection* of duplicates,
      // which silently produces a policy nobody wrote.
      //
      // `max-age` is currently the short rollout value — see HSTS_MAX_AGE above
      // for what it is and when to raise it. No `preload`.
      // ---------------------------------------------------------------
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: `max-age=${HSTS_MAX_AGE}; includeSubDomains`,
          },
        ],
      },
      // ---------------------------------------------------------------
      // Widget iframe route — must allow framing from any origin so orgs
      // can embed the widget on their own websites.
      //
      // X-Frame-Options is deliberately absent rather than set to "ALLOWALL":
      // that is not a value in the spec (only DENY and SAMEORIGIN are), so
      // browsers ignored it and it merely looked like a control. Omitting the
      // header is what actually permits framing; `frame-ancestors *` below is
      // the directive carrying the intent.
      // ---------------------------------------------------------------
      {
        source: "/widget/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy("*"),
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
      // ---------------------------------------------------------------
      // Embed script — served from /embed/widget.js, needs public access
      // ---------------------------------------------------------------
      {
        source: "/embed/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // ---------------------------------------------------------------
      // All other routes — strict security headers
      // ---------------------------------------------------------------
      {
        source: "/((?!widget|embed).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy("'self'"),
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
