import Providers from "@/components/layout/Providers";

/**
 * The layout for printable staff pages.
 *
 * It exists so the deck sheet can live at `/dashboard/schedule/deck` — inside the
 * path the proxy protects (`src/proxy.ts` redirects any unauthenticated
 * `/dashboard/*` request to /login) — **without** inheriting the dashboard's
 * sidebar, topbar and bottom nav. Route groups do not appear in the URL, so
 * `(print)/dashboard/...` and `(dashboard)/dashboard/...` produce the same URL
 * prefix while rendering different chrome; the only rule is that no two groups
 * define the same path, and the deck route exists once.
 *
 * The alternative — keeping the page under `(dashboard)` and hiding the chrome
 * with `@media print` — means fighting a shared flex layout from a child route,
 * and one missed rule prints a sidebar down the side of a sheet that gets posted
 * on a pool deck.
 *
 * Auth is still checked in the page itself: the proxy is documented as an
 * optimistic check, and this page renders holder names from `session_internal`.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers devtools={false}>
      <div className="min-h-screen bg-background">{children}</div>
    </Providers>
  );
}
