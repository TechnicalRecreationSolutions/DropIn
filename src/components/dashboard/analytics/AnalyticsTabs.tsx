"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The strip above the three analytics pages.
 *
 * ## The period travels with you
 *
 * Every link carries the current `?range`/`?from`/`?to`/`?facility`. Switching
 * from "Engagement, last 90 days, Aquatic Centre" to Utilization and landing
 * on a default 30-day org-wide view is the single most annoying thing a tab
 * strip can do — you came to compare, and the comparison is gone. The
 * toolbar's own state lives entirely in the URL, so forwarding the query
 * string is the whole implementation.
 *
 * ## Links, not buttons
 *
 * Each page is a real route with its own data. Middle-click, bookmark and
 * back all work, and a coordinator handed a URL lands where the sender was.
 */

export interface AnalyticsTab {
  href: string;
  label: string;
  /** The index tab, which every other path starts with. */
  exact?: boolean;
}

export default function AnalyticsTabs({ tabs }: { tabs: AnalyticsTab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  return (
    <nav
      aria-label="Analytics views"
      // Scrolls sideways at phone width rather than wrapping — three tabs and
      // a heading stacked two-high pushes the first number below the fold.
      className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
    >
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={query ? `${tab.href}?${query}` : tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
