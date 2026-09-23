"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { SettingsNavGroup, SettingsNavItem } from "@/lib/settings/nav";

/**
 * The rail down the left of every settings page, and the tab strip that
 * replaces it at phone width.
 *
 * ## Two renderings, one list
 *
 * The rail carries group headings and a line of explanation per item; the tab
 * strip carries labels only. That is not a simplification for its own sake —
 * a phone has room for about three words per tab, and a strip that wrapped to
 * three lines would push the first field of every settings page below the
 * fold. Both read the same `groups` prop, so a page can never appear in one
 * and not the other.
 *
 * ## Links, not buttons
 *
 * Each settings page is a real route with its own data and its own permission
 * check. Middle-click, bookmark and back all work, and a manager handed
 * `/dashboard/settings/staff` lands on Staff rather than on a shell that then
 * navigates.
 */
export default function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  const isActive = (item: SettingsNavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const flat = groups.flatMap((g) => g.items);

  return (
    <>
      {/* ── Phone and tablet: a horizontal strip ───────────────────────────
          Negative margins let it bleed to the screen edge, so the last tab is
          visibly cut off rather than ending flush — the affordance that tells
          somebody it scrolls. */}
      <nav
        aria-label="Settings sections"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0 lg:hidden"
      >
        {flat.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* ── Desktop: the rail ──────────────────────────────────────────────
          Sticky under the 56px topbar so the section you are in stays on
          screen while a long page (Staff, Billing) scrolls past it. */}
      <nav
        aria-label="Settings sections"
        className="hidden lg:block lg:w-60 lg:shrink-0 lg:self-start lg:sticky lg:top-20"
      >
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-3 py-2 transition-colors",
                        active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground/80">
                        {item.blurb}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
