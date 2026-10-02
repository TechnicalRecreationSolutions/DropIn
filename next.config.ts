import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/security/csp";

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

// Content-Security-Policy is built in src/lib/security/csp.ts, shared with
// proxy.ts, which sets the widget route’s per-organization frame-ancestors.

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

  /**
   * The settings consolidation (2026-09-22).
   *
   * Staff, Billing and Data sources became siblings under `/dashboard/settings`
   * rather than three top-level rows beneath a heading of the same name. These
   * three paths are not dead: they are in browser histories, in bookmarks, in
   * the invitation emails already sent, and — until this shipped — in Stripe's
   * stored checkout return URLs.
   *
   * `permanent: true` is a 308, which preserves the method. That matters for
   * Billing specifically: Stripe returns from checkout with a GET, but a 307/308
   * distinction is the difference between a redirect that keeps a POST body and
   * one that silently drops it, and the general rule for a route that MOVED is
   * the permanent one.
   *
   * Handled here rather than by a `page.tsx` calling `redirect()` at each old
   * path: those would be nine real route segments rendering a shell in order to
   * throw it away, and each would keep its folder alive in the app directory
   * long after anyone remembered why.
   */
  async redirects() {
    return [
      { source: "/dashboard/staff", destination: "/dashboard/settings/staff", permanent: true },
      { source: "/dashboard/billing", destination: "/dashboard/settings/billing", permanent: true },
      {
        source: "/dashboard/data-sources",
        destination: "/dashboard/settings/data-sources",
        permanent: true,
      },
      // Head counts became the "People here" section of the status page
      // (2026-09-29). Not permanent: a browser caches a 308 forever, and this
      // is the newest of these moves. `?facility=` rides along, harmlessly.
      {
        source: "/dashboard/counts",
        has: [{ type: "query", key: "facility", value: "(?<facility>[0-9a-fA-F-]{36})" }],
        destination: "/dashboard/facilities/:facility/status",
        permanent: false,
      },
      { source: "/dashboard/counts", destination: "/dashboard/status", permanent: false },
    ];
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
      // Widget iframe route — framed by each organization's own website.
      //
      // Its Content-Security-Policy is NOT set here. Which sites may frame
      // the widget is per organization (Settings › Embedding, migration 067),
      // so proxy.ts builds the whole policy per request with that org's
      // `frame-ancestors`. Setting a second CSP here as well would make the
      // browser enforce both, and a static one cannot know the org.
      //
      // X-Frame-Options is deliberately absent rather than set to "ALLOWALL":
      // that is not a value in the spec (only DENY and SAMEORIGIN are), so
      // browsers ignored it and it merely looked like a control. It also
      // cannot list several sites; `frame-ancestors` is the control.
      // ---------------------------------------------------------------
      {
        source: "/widget/:path*",
        headers: [
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
